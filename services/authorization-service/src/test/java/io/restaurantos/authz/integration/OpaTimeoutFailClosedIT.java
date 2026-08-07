package io.restaurantos.authz.integration;

import com.sun.net.httpserver.HttpServer;
import io.restaurantos.authz.AuthorizationServiceApplication;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.client.RestClient;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * A policy engine that never answers is a policy engine that answered "no" — within 2 seconds.
 *
 * <h2>What this test used to do, and why that was not enough</h2>
 *
 * <p>The previous version pointed {@code restaurantos.opa.url} at {@code http://127.0.0.1:1}: a
 * closed port. That fails with <b>connection refused, instantly</b> — the operating system answers
 * with an RST before any timeout is consulted. It therefore proved fail-closed on <em>connection
 * failure</em>, which was never in doubt ({@code DefaultOpaClient} catches every exception and
 * denies), and said nothing at all about the failure mode that actually hurts: an OPA that accepts
 * the connection and then goes quiet.
 *
 * <p>That gap was not academic. {@code SharedAutoConfiguration.opaClient} built its
 * {@code RestClient} with <b>no timeouts of any kind</b>, so pos, inventory and kitchen would wait
 * on a hung OPA forever, holding a Tomcat worker per request until the pool was exhausted. A test
 * against a closed port cannot detect that, because a closed port produces an exception in
 * microseconds whether a timeout is configured or not.
 *
 * <h2>What it does now</h2>
 *
 * <p>{@link #STALLED_OPA} is a real HTTP server that accepts the connection, holds it, and answers
 * only after {@link #STALL_MILLIS} — five times the budget. The assertions below are two-sided,
 * which is the whole point:
 *
 * <ul>
 *   <li><b>Upper bound</b> — the deny arrives well before the stub would have replied, so the client
 *       gave up rather than waited.</li>
 *   <li><b>Lower bound</b> — it took meaningfully longer than a connection refusal, so what is being
 *       measured is a genuine read timeout and not the old closed-port shortcut. Without this, the
 *       test would pass again if someone reverted the URL to a dead port.</li>
 * </ul>
 *
 * <p>It also asserts the stub was actually <em>reached</em>. A DNS or bind failure would satisfy both
 * timing bounds while testing nothing.
 *
 * <h2>Why this service</h2>
 *
 * <p>authorization-service used to be the one service that configured its own timeout, in a
 * {@code @Primary} {@code OpaConfig} — so the old test exercised the only client that was already
 * correct. That override is gone; the 2-second budget now lives in
 * {@code SharedAutoConfiguration.opaClient}, which is the same bean pos, inventory, kitchen and
 * hr-service resolve. This test therefore covers the shared client every direct-OPA service uses,
 * rather than a per-service copy of it.
 *
 * <p>The stub binds {@code 127.0.0.1} explicitly. A wildcard bind is filtered by the macOS
 * application firewall, which accepts the connection, writes zero bytes and closes — an EOF with
 * nothing logged server-side, which would look exactly like the hang under test. See
 * {@code scripts/DEV-STACK-RUNBOOK.md}, "The silent EOF".
 */
@SpringBootTest(
    classes = AuthorizationServiceApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT
)
@Testcontainers
@Import(TestJwksConfig.class)
class OpaTimeoutFailClosedIT {

    private static final String INTERNAL_SECRET = "test-internal-secret";

    /** Five times the 2 s budget: long enough that "waited it out" and "timed out" cannot be confused. */
    private static final long STALL_MILLIS = 10_000;

    /** Proves the stub was really contacted — timing bounds alone would pass on a bind failure. */
    private static final AtomicInteger STUB_HITS = new AtomicInteger();

    private static final HttpServer STALLED_OPA;

    static {
        try {
            STALLED_OPA = HttpServer.create(
                new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0), 0);
        } catch (IOException e) {
            throw new ExceptionInInitializerError(e);
        }
        STALLED_OPA.createContext("/", exchange -> {
            STUB_HITS.incrementAndGet();
            try {
                // Accept, then go quiet. This is the failure mode a closed port cannot reproduce.
                Thread.sleep(STALL_MILLIS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            byte[] body = "{\"result\":true}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        // A generous pool: the handler blocks, so a single-threaded executor would serialise the
        // stalls and turn one 2 s timeout into several.
        STALLED_OPA.setExecutor(java.util.concurrent.Executors.newCachedThreadPool());
        STALLED_OPA.start();
    }

    static final PostgreSQLContainer<?> POSTGRES =
        new PostgreSQLContainer<>(DockerImageName.parse("postgres:18"))
            .withDatabaseName("auth_db")
            .withUsername("auth_user")
            .withPassword("test-pass");

    @SuppressWarnings("resource")
    static final GenericContainer<?> REDIS =
        new GenericContainer<>(DockerImageName.parse("redis:8"))
            .withExposedPorts(6379);

    static final RabbitMQContainer RABBIT =
        new RabbitMQContainer(DockerImageName.parse("rabbitmq:4.3-management"));

    static {
        POSTGRES.start();
        REDIS.start();
        RABBIT.start();
    }

    @AfterAll
    static void stopStub() {
        STALLED_OPA.stop(0);
    }

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        // Bind the test server to loopback. Spring Boot otherwise binds the wildcard address,
        // and the macOS Application Firewall filters wildcard-bound sockets: it accepts the
        // connection, writes zero bytes and closes, so requests fail with "header parser received
        // no bytes" / PrematureCloseException and NOTHING is logged server-side. Intermittent, and
        // it looks exactly like an application or network bug. See DEV-STACK-RUNBOOK.md.
        r.add("server.address", () -> "127.0.0.1");
        String jdbcUrl = POSTGRES.getJdbcUrl() + "?sslmode=disable&tcpKeepAlive=true";
        r.add("spring.datasource.url", () -> jdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        r.add("spring.liquibase.change-log", () -> "classpath:db/changelog/db.changelog-master.xml");
        r.add("spring.data.redis.host", REDIS::getHost);
        r.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379).toString());
        r.add("spring.rabbitmq.host", RABBIT::getHost);
        r.add("spring.rabbitmq.port", () -> String.valueOf(RABBIT.getAmqpPort()));
        r.add("spring.rabbitmq.username", RABBIT::getAdminUsername);
        r.add("spring.rabbitmq.password", RABBIT::getAdminPassword);
        r.add("eureka.client.enabled", () -> "false");
        // A STALLED responder, not a closed port. See the class javadoc.
        r.add("restaurantos.opa.url",
            () -> "http://127.0.0.1:" + STALLED_OPA.getAddress().getPort());
        r.add("restaurantos.jwt.jwks-url", () -> "http://localhost:8081/.well-known/jwks.json");
        r.add("restaurantos.internal.service-secret", () -> INTERNAL_SECRET);
    }

    @LocalServerPort int port;

    @Test
    void hungOpaDeniesWithinTheTwoSecondBudget() {
        int hitsBefore = STUB_HITS.get();

        long start = System.currentTimeMillis();
        ResponseEntity<String> response = authorize();
        long elapsed = System.currentTimeMillis() - start;

        assertThat(STUB_HITS.get())
            .as("the stalled stub must actually have been contacted — if it was not, this test is "
                + "measuring a bind or DNS failure and proves nothing about timeouts")
            .isGreaterThan(hitsBefore);

        assertThat(elapsed)
            .as("must give up on the 2 s budget rather than wait out the %d ms stall", STALL_MILLIS)
            .isLessThan(5_000);

        assertThat(elapsed)
            .as("must take materially longer than a connection refusal. If this drops to ~0 the URL "
                + "has been pointed at a closed port again, and the read timeout is no longer under "
                + "test — which is exactly how the untimed shared client went unnoticed")
            .isGreaterThan(1_000);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody())
            .as("BLR-5: an unreachable or unresponsive policy engine DENIES. The stub would have "
                + "answered allow:true had the client waited for it — so an allow here means the "
                + "timeout is not being applied at all")
            .contains("\"allow\":false");
    }

    /**
     * Repeat runs must each fail closed within the budget. A client that leaks the stalled
     * connection back into a pool degrades on the second call rather than the first, which a
     * single-request test cannot see.
     */
    @Test
    void repeatedHungCallsEachFailClosedWithinBudget() {
        for (int attempt = 1; attempt <= 3; attempt++) {
            long start = System.currentTimeMillis();
            ResponseEntity<String> response = authorize();
            long elapsed = System.currentTimeMillis() - start;

            assertThat(elapsed).as("attempt %d stayed within the budget", attempt).isLessThan(5_000);
            assertThat(response.getBody()).as("attempt %d denied", attempt).contains("\"allow\":false");
        }
    }

    private ResponseEntity<String> authorize() {
        String jwt = TestFixtures.mintJwt(
            TestFixtures.cashierUserId(),
            TestFixtures.demoTenantId(),
            TestFixtures.mainBranchId(),
            List.of("CASHIER"),
            List.of("pos.order.void.any"),
            Map.of());

        Map<String, Object> body = Map.of(
            "module", "pos",
            "action", "void",
            "resource", Map.of(
                "type", "order",
                "tenantId", TestFixtures.demoTenantId().toString(),
                "branchId", TestFixtures.mainBranchId().toString(),
                "createdBy", TestFixtures.cashierUserId().toString(),
                "status", "OPEN"
            )
        );

        RestClient client = RestClient.builder()
            .requestFactory(new org.springframework.http.client.JdkClientHttpRequestFactory())
            .baseUrl("http://127.0.0.1:" + port)
            .build();

        return client.post()
            .uri("/internal/authorize")
            .contentType(MediaType.APPLICATION_JSON)
            .header("Authorization", "Bearer " + jwt)
            .header("X-Internal-Service", INTERNAL_SECRET)
            .body(body)
            .exchange((request, httpResponse) -> {
                byte[] bytes = httpResponse.getBody() != null
                    ? httpResponse.getBody().readAllBytes() : new byte[0];
                return ResponseEntity.status(httpResponse.getStatusCode())
                    .body(new String(bytes, StandardCharsets.UTF_8));
            });
    }
}
