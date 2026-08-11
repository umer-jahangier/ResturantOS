package io.restaurantos.hr;

import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.idempotency.IdempotencyKeyRepository;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.shared.tenant.ThreadLocalTenantContext;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.BindMode;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.DockerImageName;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Base class for hr-service integration tests.
 *
 * <p>Static singleton Postgres container shared across all subclasses in the same JVM run
 * (mirrors Crm/Finance/InventoryTestBase — avoids Spring context-cache conflicts pointing at a
 * stopped container's port). Unlike finance/inventory it wires <b>Liquibase</b> (the hr-service
 * migration engine), not Flyway: Spring Liquibase runs the full master changelog on context
 * startup with {@code contexts=""} (schema only, skip seed data), so a subclass whose Spring
 * context loads has proven the migration.
 *
 * <p>Kept entity-independent on purpose: later HR plans add {@code @Entity} classes onto the
 * tables created here, and each extends this base. It operates at the migration/JDBC level.
 *
 * <h2>A real OPA, and a real principal</h2>
 *
 * <p>hr-service now enforces {@code hr.rego} (phase 18b). Two things follow for every test here.
 *
 * <p>First, OPA is a <b>real container running the repository's own {@code policies/} bundle</b>,
 * not a mock. Stubbing {@code OpaClient} to return allow would have made the whole HR suite prove
 * that HR calls <em>something</em>, which is the state the phase exists to end — the policy was
 * always correct in isolation; what was missing was the wiring. Every HR test now round-trips a
 * genuine decision through the same rego the deployed bundle ships.
 *
 * <p>Second, these tests drive the service layer directly, with no HTTP request and therefore no
 * {@code JwtAuthenticationFilter} to populate the security context. {@code AuthorizationService}
 * reads the caller's identity from {@code SecurityContextHolder}, so a test that sets only
 * {@code TenantContext} would fail on a missing principal rather than on a policy decision. The
 * {@link TenantContext} bean below is therefore decorated so {@code set(...)} also installs the
 * matching {@link JwtClaims} — exactly the identity the filter would have derived from that
 * caller's token, holding every {@code hr.*} permission so that the RBAC half is satisfied and
 * <b>tenant and branch isolation is the only thing under test</b>. Subclasses call
 * {@code tenantContext.set(...)} exactly as before.
 */
@SpringBootTest
@Import(HrTestBase.TestPrincipalConfig.class)
public abstract class HrTestBase {

    /** Every hr.* code in the catalog, so a deny can only ever come from tenant/branch scoping. */
    static final List<String> ALL_HR_PERMISSIONS = List.of(
            "hr.employee.view", "hr.employee.manage",
            "hr.attendance.view", "hr.attendance.manage",
            "hr.leave.view", "hr.leave.approve",
            "hr.payroll.view", "hr.payroll.run", "hr.payroll.approve");

    /**
     * Publish a container's ports on {@code 127.0.0.1}, at a host port this JVM has claimed for itself
     * first, instead of letting Docker pick one from its own automatic range.
     *
     * <h3>Why the binding is loopback-only</h3>
     *
     * <p>Correct on its own merits: a Testcontainers Postgres publishes a database whose username and
     * password are written a few lines below, and there is no reason for it to be reachable from the
     * LAN for the ninety seconds it exists. Loopback is the binding a test fixture should have had.
     *
     * <h3>Why the port is chosen here rather than by Docker</h3>
     *
     * <p>This is the fix for a failure that costs an hour to diagnose and produces two symptoms that
     * look unrelated. Anything on the machine that watches for new listeners and forwards them — an
     * IDE's automatic port forwarding is the usual culprit — will grab a published container port, and
     * it commonly keeps that listener alive long after the container is gone. Docker allocates its
     * automatic host ports sequentially from the low end of a fixed range, so the forwarder's leftover
     * listeners accumulate exactly where the next container is about to land. The forwarder is then
     * already bound when Docker tries, Docker's listener loses, and the port behaves as follows: it is
     * open, {@code docker ps} shows the mapping, the container's own log shows a healthy server, and
     * every connection from the test JVM hangs until it times out. Measured on this machine as
     *
     * <pre>
     * Timed out waiting for URL to be accessible (http://localhost:32780/health)     [one run]
     * PSQLException: The connection attempt failed                                   [the next]
     * </pre>
     *
     * <p>— one cause, two faces, neither of them in this repository, and both of them looking like a
     * broken test.
     *
     * <p>Claiming the port here inverts the race. We bind a socket on {@code 127.0.0.1:0}, let the OS
     * pick from the ephemeral range (49152+ on macOS, well clear of Docker's automatic range and so of
     * the forwarder's accumulated leftovers), close it, and hand that number to Docker immediately.
     * Docker binds first, and a forwarder that notices afterwards cannot displace a listener that is
     * already there. The close-then-bind window is real but is microseconds wide and is in a range
     * nothing else on the machine is competing for.
     *
     * <p>If this ever regresses, the diagnostic is one command:
     * {@code lsof -nP -iTCP:<port> -sTCP:LISTEN} — if the owner is not a Docker process, this is what
     * happened again.
     */
    private static <T extends GenericContainer<?>> T publishedOnClaimedLoopbackPorts(T container,
                                                                                     int... containerPorts) {
        container.withCreateContainerCmdModifier(cmd -> cmd.getHostConfig().withPortBindings(
                java.util.Arrays.stream(containerPorts)
                        .mapToObj(p -> new com.github.dockerjava.api.model.PortBinding(
                                com.github.dockerjava.api.model.Ports.Binding.bindIpAndPort(
                                        "127.0.0.1", claimEphemeralPort()),
                                com.github.dockerjava.api.model.ExposedPort.tcp(p)))
                        .toList()));
        return container;
    }

    /** A currently-free port on the loopback interface, from the OS ephemeral range. */
    private static int claimEphemeralPort() {
        try (java.net.ServerSocket probe =
                     new java.net.ServerSocket(0, 1, java.net.InetAddress.getByName("127.0.0.1"))) {
            return probe.getLocalPort();
        } catch (java.io.IOException e) {
            throw new IllegalStateException("Could not claim a loopback port for a test container", e);
        }
    }

    @SuppressWarnings("resource")
    static final GenericContainer<?> OPA = publishedOnClaimedLoopbackPorts(
            new GenericContainer<>(DockerImageName.parse("openpolicyagent/opa:1.17.1"))
                    .withCommand("run", "--server", "--addr=0.0.0.0:8181", "/policies")
                    .withExposedPorts(8181)
                    .withFileSystemBind(policiesDir().toString(), "/policies", BindMode.READ_ONLY)
                    .waitingFor(Wait.forHttp("/health").forPort(8181)),
            8181);

    private static Path policiesDir() {
        Path cwd = Path.of(System.getProperty("user.dir")).toAbsolutePath();
        for (Path candidate : List.of(
                cwd.resolve("../../policies").normalize(),
                cwd.resolve("policies").normalize(),
                cwd.resolve("../../../policies").normalize())) {
            if (candidate.resolve("restaurantos/hr.rego").toFile().exists()) {
                return candidate;
            }
        }
        throw new IllegalStateException("Could not locate policies/ from " + cwd);
    }

    // protected, not package-private: phase 25's ADMS tests live in io.restaurantos.hr.adms and read
    // this container's JDBC coordinates to verify what the service wrote. A subclass in another
    // package can reach a protected static member of its superclass; a package-private one it cannot.
    protected static final PostgreSQLContainer<?> postgres = publishedOnClaimedLoopbackPorts(
            new PostgreSQLContainer<>("postgres:16")
                    .withDatabaseName("hr_db")
                    .withUsername("hr_user")
                    .withPassword("hr_pass"),
            5432);

    static {
        System.setProperty("TESTCONTAINERS_RYUK_DISABLED", "true");
        postgres.start();
        OPA.start();
    }

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        // "validate", not "none" — deliberately matching the deployed configuration
        // (services/hr-service/src/main/resources/application.yml sets ddl-auto: validate).
        //
        // This used to be "none", which switched off the only check that compares the JPA mappings
        // to the schema Liquibase just built. The cost of that was concrete: tax_config's three
        // rate columns are NUMERIC(6,3) while TaxConfigEntity mapped them as `double` (float8), so
        // hr-service could not start against any real migrated database — and all 18 integration
        // tests passed anyway, because this line meant no test ever booted the service the way
        // production boots it. A green suite reported a service that could not start.
        //
        // Keeping this at "validate" means entity/schema drift fails here, in seconds, instead of
        // at deployment. If a future changelog and entity disagree, that is the bug — do not switch
        // this back to "none" to make the suite green.
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "validate");
        // Spring Liquibase runs the master changelog against the container; contexts="" skips seed.
        registry.add("spring.liquibase.contexts", () -> "");
        registry.add("eureka.client.enabled", () -> "false");
        registry.add("spring.cloud.config.enabled", () -> "false");
        // @EnableRabbit registers listener infrastructure that dials the broker at startup even with
        // RabbitTemplate mocked. Point it at a dead port (connection-refused, retried, non-fatal)
        // rather than whatever broker the developer happens to be running (ACCESS_REFUSED is fatal).
        registry.add("spring.rabbitmq.listener.simple.auto-startup", () -> "false");
        registry.add("spring.rabbitmq.listener.simple.missing-queues-fatal", () -> "false");
        registry.add("spring.rabbitmq.host", () -> "127.0.0.1");
        registry.add("spring.rabbitmq.port", () -> "1");
        // Field-encryption key must be present so EncryptionAutoConfiguration
        // (@ConditionalOnProperty) activates for the encrypted PII columns later plans add.
        // 32 zero-bytes, Base64 — a valid AES-256 test key (same shape as PurchasingTestBase).
        registry.add("restaurantos.encryption.key", () -> "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
        registry.add("TESTCONTAINERS_RYUK_DISABLED", () -> "true");
        // Activates SharedAutoConfiguration's OpaClient + AuthorizationService beans, which
        // HrAuthorizationService requires. Without it the context fails to start — deliberately:
        // a deployment that forgets OPA_URL must not come up silently unenforced.
        registry.add("restaurantos.opa.url",
                () -> "http://" + OPA.getHost() + ":" + OPA.getMappedPort(8181));
    }

    /**
     * A {@link TenantContext} that keeps the security context in step with the tenant context.
     *
     * <p>See the class javadoc: service-layer tests have no HTTP filter, so without this every call
     * that reaches OPA would fail on a null principal instead of returning a policy decision.
     */
    @TestConfiguration
    static class TestPrincipalConfig {

        @Bean
        @Primary
        TenantContext principalInstallingTenantContext() {
            return new PrincipalInstallingTenantContext();
        }
    }

    static class PrincipalInstallingTenantContext implements TenantContext {

        private final TenantContext delegate = new ThreadLocalTenantContext();

        @Override
        public void set(UUID tenantId, UUID branchId, UUID userId, UUID impersonatedBy) {
            delegate.set(tenantId, branchId, userId, impersonatedBy);
            UUID subject = userId != null ? userId : UUID.randomUUID();
            JwtClaims claims = new JwtClaims(subject, tenantId, branchId,
                    List.of("MANAGER"), ALL_HR_PERMISSIONS, Map.of(), impersonatedBy);
            SecurityContextHolder.getContext().setAuthentication(
                    new UsernamePasswordAuthenticationToken(claims, null, List.of()));
        }

        @Override
        public void clear() {
            delegate.clear();
            SecurityContextHolder.clearContext();
        }

        @Override
        public Optional<UUID> getTenantId() {
            return delegate.getTenantId();
        }

        @Override
        public Optional<UUID> getBranchId() {
            return delegate.getBranchId();
        }

        @Override
        public Optional<UUID> getUserId() {
            return delegate.getUserId();
        }

        @Override
        public Optional<UUID> getImpersonatedBy() {
            return delegate.getImpersonatedBy();
        }

        @Override
        public UUID requireTenantId() {
            return delegate.requireTenantId();
        }

        @Override
        public TenantSnapshot snapshot() {
            return delegate.snapshot();
        }

        @Override
        public void restore(TenantSnapshot snapshot) {
            // A null snapshot means "there was no tenant on the originating thread" —
            // TenantTaskDecorator hands one to every scheduled task, and the accrual scheduler
            // starts before any test sets a context. Clearing is the correct restore; delegating a
            // null to set() dereferences it.
            if (snapshot == null) {
                clear();
                return;
            }
            // Route through set() so the principal is restored alongside the tenant, rather than
            // leaving a thread carrying one caller's identity and another's tenant.
            set(snapshot.tenantId(), snapshot.branchId(), snapshot.userId(), snapshot.impersonatedBy());
        }
    }

    // Shared-lib infrastructure beans hr-service scans but does not exercise in these tests.
    @MockitoBean
    protected StringRedisTemplate stringRedisTemplate;

    @MockitoBean
    protected RabbitTemplate rabbitTemplate;

    @MockitoBean
    protected IdempotencyKeyRepository idempotencyKeyRepository;

    @MockitoBean
    protected OutboxRepository outboxRepository;
}
