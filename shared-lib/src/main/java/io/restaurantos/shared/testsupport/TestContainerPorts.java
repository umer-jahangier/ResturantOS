package io.restaurantos.shared.testsupport;

import com.github.dockerjava.api.command.CreateContainerCmd;
import com.github.dockerjava.api.model.ExposedPort;
import com.github.dockerjava.api.model.PortBinding;
import com.github.dockerjava.api.model.Ports;

import java.io.IOException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.util.Arrays;
import java.util.function.Consumer;

/**
 * Publishes a Testcontainers container on host ports <b>this JVM claims first</b>, instead of letting
 * Docker pick them from its own automatic range.
 *
 * <pre>{@code
 * static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16")
 *         .withDatabaseName("x_db")
 *         .withCreateContainerCmdModifier(TestContainerPorts.claimingHostPortsFor(5432));
 *
 * static final GenericContainer<?> OPA = new GenericContainer<>(DockerImageName.parse("openpolicyagent/opa:1.17.1"))
 *         .withExposedPorts(8181)
 *         .withCreateContainerCmdModifier(TestContainerPorts.claimingHostPortsFor(8181));
 * }</pre>
 *
 * <h2>The bug this exists to defeat</h2>
 *
 * <p>Anything on the machine that watches for new listening sockets and forwards them — an IDE's
 * automatic port forwarding is the common case — will bind a published container port before Docker's
 * proxy does, and <b>keeps that listener alive long after the container is gone</b>. Docker allocates
 * its automatic host ports sequentially from the low end of a fixed range, so the forwarder's
 * leftovers accumulate exactly where the next container is about to land. Measured on one developer
 * machine: 40+ contiguous ports from 32768 held, so essentially every new container drew a dead port.
 *
 * <p>The result is a container that is <em>healthy and unreachable</em>, and it does not present as
 * one bug. Depending on which container drew the poisoned port you get a 60-second wait-strategy
 * timeout with no request in the container's log, or {@code PSQLException: The connection attempt
 * failed}, or {@code HTTP/1.1 header parser received no bytes} — which reads as an HTTP/2 client
 * problem and sends you somewhere else entirely. Three agents met this in one session; two wrote it
 * down as "Testcontainers cannot start a container here", which it is not.
 *
 * <p>Diagnostic, one line: {@code lsof -nP -iTCP:<port> -sTCP:LISTEN}. If the owner is not a Docker
 * process, this is what happened.
 *
 * <h2>Why claiming the port first works</h2>
 *
 * <p>Binding a socket on port 0 takes one from the OS ephemeral range (49152+ on macOS, 32768+ on
 * Linux configured well clear of Docker's published-port range), which is where the forwarder's
 * accumulated leftovers are not. We close it and hand the number straight to Docker, so <b>Docker
 * binds first</b> — and a forwarder that notices afterwards cannot displace a listener that is already
 * there. The close-then-bind window is real, microseconds wide, and in a range nothing else is
 * competing for.
 *
 * <h2>The bind address is 0.0.0.0 by default, and it is deliberately configurable — read this before
 * changing either</h2>
 *
 * <p>There are two real environments here and they want opposite things. Both failure modes have been
 * observed; neither is theoretical.
 *
 * <p><b>Why the default is 0.0.0.0.</b> Under colima, {@code 127.0.0.1} is the <em>Lima VM's</em>
 * loopback, not the host's — reachable from macOS only through the Lima port forwarder, which is
 * exactly the component {@code TESTCONTAINERS_HOST_OVERRIDE=192.168.64.2} exists to bypass because it
 * intermittently accepts a connection and then writes zero bytes. A loopback binding forces every
 * host-override run back through the forwarder those runs are configured to avoid. Most agents and CI
 * run this way, so it is the default.
 *
 * <p><b>Why it is not hard-coded.</b> On a machine running an IDE with automatic port forwarding, the
 * loopback binding is <em>not</em> incidental — it is part of the fix. Measured directly: with
 * {@code 127.0.0.1} the forwarder left the claimed ports alone and a 55-test suite ran green for
 * hours; switching the same suite to {@code 0.0.0.0} had the forwarder grab ports 56500, 55305,
 * 57798, 59422 and 64482 within one run, and every container came back
 * {@code SocketException: Unexpected end of file from server}. A wildcard-bound listener is
 * <em>advertisable</em>, so the forwarder offers to forward it; a loopback-bound one is not, so it
 * does not. Claiming the port first defeats the accumulation of stale forwards; the bind address
 * decides whether a fresh forward is attempted at all. <b>Both halves do work, on different
 * machines.</b>
 *
 * <p>So: set {@code -Drestaurantos.test.container-bind-ip=127.0.0.1} (or the
 * {@code RESTAURANTOS_TEST_CONTAINER_BIND_IP} environment variable) on a machine whose IDE forwards
 * ports. Leave it alone everywhere else. Do not resolve the tension by deleting one side of it.
 *
 * <h2>The second half, which is easy to miss</h2>
 *
 * <p>This class covers containers. A harness using {@code @SpringBootTest(webEnvironment = RANDOM_PORT)}
 * <em>also</em> publishes an embedded Tomcat on a wildcard-bound random port, which the same forwarder
 * takes just as happily; those tests then fail with {@code HTTP/1.1 header parser received no bytes}.
 * That half needs {@code properties = "server.address=127.0.0.1"} on the annotation and requests
 * addressed to {@code http://127.0.0.1:port} rather than to the name {@code localhost}. Loopback IS
 * correct there — that server runs in this JVM on the host, not inside a VM.
 */
public final class TestContainerPorts {

    private TestContainerPorts() {
    }

    /**
     * A {@code withCreateContainerCmdModifier} argument that publishes each given container port on a
     * host port claimed by this JVM, bound to all interfaces.
     *
     * @param containerPorts the ports <em>inside</em> the container, e.g. {@code 5432} for Postgres
     */
    public static Consumer<CreateContainerCmd> claimingHostPortsFor(int... containerPorts) {
        return cmd -> {
            var hostConfig = cmd.getHostConfig();
            if (hostConfig == null) {
                throw new IllegalStateException("No HostConfig on the create-container command");
            }
            hostConfig.withPortBindings(Arrays.stream(containerPorts)
                    .mapToObj(port -> new PortBinding(
                            // See the class javadoc before changing the default or removing the override.
                            Ports.Binding.bindIpAndPort(bindIp(), claimEphemeralPort()),
                            ExposedPort.tcp(port)))
                    .toList());
        };
    }

    /**
     * The host interface containers are published on. {@code 0.0.0.0} unless overridden — see the
     * class javadoc for the two environments that disagree about this and why neither is wrong.
     */
    public static String bindIp() {
        String property = System.getProperty("restaurantos.test.container-bind-ip");
        if (property != null && !property.isBlank()) {
            return property.trim();
        }
        String env = System.getenv("RESTAURANTOS_TEST_CONTAINER_BIND_IP");
        return env != null && !env.isBlank() ? env.trim() : "0.0.0.0";
    }

    /** A currently-free host port from the OS ephemeral range, released immediately for Docker to take. */
    public static int claimEphemeralPort() {
        try (ServerSocket probe = new ServerSocket(0, 1, InetAddress.getByName(bindIp()))) {
            return probe.getLocalPort();
        } catch (IOException e) {
            throw new IllegalStateException("Could not claim a host port for a test container", e);
        }
    }
}
