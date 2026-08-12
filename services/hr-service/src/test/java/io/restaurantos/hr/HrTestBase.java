package io.restaurantos.hr;

import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.feature.FeatureFlagService;
import io.restaurantos.shared.idempotency.IdempotencyKeyRepository;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.testsupport.OpaPolicyBundle;
import io.restaurantos.shared.testsupport.TestContainerPorts;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.shared.tenant.ThreadLocalTenantContext;
import org.junit.jupiter.api.BeforeEach;
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
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;

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
            "hr.payroll.view", "hr.payroll.run", "hr.payroll.approve",
            // 35-03. Present here for the same reason as the other nine: this list exists so that a
            // deny can only ever come from tenant/branch SCOPING, never from a missing permission,
            // which is what makes an isolation test's red mean what it claims.
            "hr.config.view", "hr.config.manage");

    // Container host ports are claimed by this JVM before Docker binds them — see
    // io.restaurantos.shared.testsupport.TestContainerPorts for the full reasoning. Short version: an
    // IDE's automatic port forwarding grabs published ports and keeps them after the container dies,
    // so containers come up healthy and unreachable and the failure wears four different faces. This
    // suite went 45 errors -> 45 green, 62s -> 13s. The shared helper binds 0.0.0.0 deliberately;
    // do not "tidy" it to loopback, which breaks colima host-override runs.

    /**
     * The bundle is <b>copied</b> into the container, never bind-mounted. A bind mount resolves to an
     * empty {@code /policies} from any host path the Docker VM does not share, and an OPA holding no
     * policy denies everything while answering {@code /health} with 200. That would quietly invert
     * this class's central invariant — see {@link #ALL_HR_PERMISSIONS}: every {@code hr.*} code is
     * granted precisely so a deny can only come from tenant/branch scoping, and an empty bundle makes
     * every deny come from the absence of any rule instead, while the suite stays green. See
     * {@link OpaPolicyBundle}.
     */
    @SuppressWarnings("resource")
    static final GenericContainer<?> OPA =
            new GenericContainer<>(DockerImageName.parse("openpolicyagent/opa:1.17.1"))
                    .withCommand("run", "--server", "--addr=0.0.0.0:8181", "/policies")
                    .withExposedPorts(8181)
                    .withCopyFileToContainer(MountableFile.forHostPath(policiesDir()), "/policies")
                    .withCreateContainerCmdModifier(TestContainerPorts.claimingHostPortsFor(8181))
                    .waitingFor(Wait.forHttp("/health").forPort(8181));

    static String opaBaseUrl() {
        return "http://" + OPA.getHost() + ":" + OPA.getMappedPort(8181);
    }

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
    protected static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
            .withDatabaseName("hr_db")
            .withUsername("hr_user")
            .withPassword("hr_pass")
            .withCreateContainerCmdModifier(TestContainerPorts.claimingHostPortsFor(5432));

    static {
        System.setProperty("TESTCONTAINERS_RYUK_DISABLED", "true");
        postgres.start();
        OPA.start();
        // Positive control. Proves the engine actually holds the bundle before any test is allowed to
        // trust a decision from it; here rather than in an IT so it cannot be forgotten by one added later.
        OpaPolicyBundle.assertActuallyLoaded(opaBaseUrl(), "restaurantos/hr.rego");
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
        registry.add("restaurantos.opa.url", HrTestBase::opaBaseUrl);
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

    /**
     * Tenant entitlement, made a non-variable for every test that is not about entitlement.
     *
     * <p>25-08 added a real {@code FEATURE_HR} check to {@code DeviceAuthResolver} — enforced there
     * because that is the first moment a tenant is known on the device path, the gateway having no
     * way to derive one. Every HR test now traverses it, and the production implementation is
     * Redis-backed against a {@code StringRedisTemplate} that is mocked two fields above, so
     * {@code opsForValue()} returns null and the check would throw for reasons that have nothing to
     * do with what any of these tests assert.
     *
     * <p>Stubbed permissive by default, matching the per-class convention inventory-service already
     * uses ({@code IngredientMasterDataIT}, {@code StockCountAccessControlIT}, {@code OpeningBalanceIT}),
     * hoisted here because the device path is traversed by nearly every class rather than by three.
     *
     * <p><b>This is a declaration, not a weakening.</b> A test that IS about the gate overrides the
     * stub for itself — {@code DeviceFeatureGateIT} does exactly that and asserts a disabled tenant
     * is refused and writes no row. Entitlement being uninteresting to the other tests is only safe
     * because one test finds it interesting.
     */
    @MockitoBean
    protected FeatureFlagService featureFlagService;

    @BeforeEach
    void featureFlagsEnabledByDefault() {
        org.mockito.Mockito.when(featureFlagService.isEnabled(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.anyString())).thenReturn(true);
    }
}
