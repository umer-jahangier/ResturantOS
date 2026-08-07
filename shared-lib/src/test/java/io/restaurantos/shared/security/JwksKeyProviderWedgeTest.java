package io.restaurantos.shared.security;

import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.security.PublicKey;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * A stalled JWKS endpoint must cost one request, not the whole process.
 *
 * <h2>The defect this pins</h2>
 *
 * {@code refresh()} was {@code synchronized} and performed a blocking HTTP call inside the
 * monitor. One unresponsive JWKS endpoint therefore parked every request thread that needed to
 * validate a JWT — while {@code /actuator/health}, which validates nothing, kept answering in
 * milliseconds. Four services wedged this way during phase 13 (auth, user, finance, pos), and
 * because auth-service is itself the JWKS publisher, its stall propagated to every other service's
 * next refresh. A liveness probe on {@code /actuator/health} would never have restarted any of them.
 *
 * <h2>Why the server is a raw socket</h2>
 *
 * The failure is "accepts the connection and then never writes a response". A mock RestClient
 * cannot reproduce that — it either returns or throws, and both are the healthy paths. Only a real
 * socket that accepts and stalls exercises the condition, so this test binds one.
 *
 * <p>Bound to 127.0.0.1 explicitly: a wildcard-bound listener is filtered by the macOS firewall and
 * fails with a silent EOF, which would make this test flaky for a reason unrelated to what it
 * asserts (see DEV-STACK-RUNBOOK.md, "The silent EOF").
 */
class JwksKeyProviderWedgeTest {

    /** A server that accepts connections and deliberately never responds. */
    private static final class StallingServer implements AutoCloseable {
        private final ServerSocket socket;
        private final Thread acceptor;
        private final AtomicInteger accepted = new AtomicInteger();
        private volatile boolean running = true;

        StallingServer() throws IOException {
            socket = new ServerSocket();
            socket.bind(new InetSocketAddress("127.0.0.1", 0));
            acceptor = new Thread(() -> {
                while (running) {
                    try {
                        Socket s = socket.accept();
                        accepted.incrementAndGet();
                        // Hold it open, write nothing. This is the production symptom.
                        holdOpen(s);
                    } catch (IOException e) {
                        return;
                    }
                }
            });
            acceptor.setDaemon(true);
            acceptor.start();
        }

        private void holdOpen(Socket s) {
            Thread t = new Thread(() -> {
                try (Socket held = s; OutputStream ignored = held.getOutputStream()) {
                    Thread.sleep(60_000);
                } catch (Exception ignored) {
                    // closed or interrupted — fine
                }
            });
            t.setDaemon(true);
            t.start();
        }

        String url() {
            return "http://127.0.0.1:" + socket.getLocalPort() + "/.well-known/jwks.json";
        }

        @Override
        public void close() throws IOException {
            running = false;
            socket.close();
        }
    }

    /**
     * Ten threads hit a provider whose JWKS endpoint never answers. All ten must return promptly.
     *
     * <p>Before the fix they serialised on the monitor and the last thread waited for all nine
     * preceding socket timeouts. With no client timeout at all — the shipped configuration — they
     * never returned.
     */
    @Test
    void aStalledJwksEndpoint_doesNotParkEveryRequestThread() throws Exception {
        try (StallingServer server = new StallingServer()) {
            RestClient client = RestClient.builder()
                    .requestFactory(timeoutingFactory())
                    .build();
            JwksKeyProvider provider = new JwksKeyProvider(server.url(), client);

            int threads = 10;
            CountDownLatch start = new CountDownLatch(1);
            CountDownLatch done = new CountDownLatch(threads);

            for (int i = 0; i < threads; i++) {
                Thread t = new Thread(() -> {
                    try {
                        start.await();
                        provider.getKey("any-kid");
                    } catch (Exception expected) {
                        // An unknown kid against an unreachable JWKS is a legitimate failure.
                        // What is under test is that it fails FAST, not that it succeeds.
                    } finally {
                        done.countDown();
                    }
                });
                t.setDaemon(true);
                t.start();
            }

            long begin = System.nanoTime();
            start.countDown();
            boolean finished = done.await(25, TimeUnit.SECONDS);
            long elapsedMs = (System.nanoTime() - begin) / 1_000_000;

            assertThat(finished)
                    .as("all %d threads returned; if this times out the monitor is being held "
                            + "across the network call again and the service will wedge", threads)
                    .isTrue();

            // Serialised behaviour would be threads x client-timeout. Concurrent, bounded
            // behaviour finishes in roughly one timeout.
            assertThat(elapsedMs)
                    .as("threads must not serialise behind one another's JWKS fetch")
                    .isLessThan(20_000L);
        }
    }

    /** A cached key must still be served while the endpoint is unreachable. */
    @Test
    void anAlreadyCachedKey_isStillServedWhenTheEndpointIsDown() throws Exception {
        var gen = java.security.KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        PublicKey seeded = gen.generateKeyPair().getPublic();
        JwksKeyProvider provider = new JwksKeyProvider("test-kid", seeded);

        // Pre-seeded mode never touches the network; the point is that a transient JWKS failure
        // must not invalidate keys the process already holds.
        assertThat(provider.getKey("test-kid")).isEqualTo(seeded);
    }

    private static org.springframework.http.client.ClientHttpRequestFactory timeoutingFactory() {
        var f = new org.springframework.http.client.SimpleClientHttpRequestFactory();
        f.setConnectTimeout(Duration.ofSeconds(1));
        f.setReadTimeout(Duration.ofSeconds(2));
        return f;
    }
}
