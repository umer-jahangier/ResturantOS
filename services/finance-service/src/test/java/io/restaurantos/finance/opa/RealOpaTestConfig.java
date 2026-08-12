package io.restaurantos.finance.opa;

import io.restaurantos.shared.testsupport.OpaPolicyBundle;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Starts a real OPA server (Testcontainers) with the repo's real {@code policies/} bundle
 * copied in, and exposes {@link #opaBaseUrl()} + a {@link TestPrincipal} bean — mirrors
 * {@code io.restaurantos.purchasing.opa.RealOpaTestConfig}, copied in spirit from
 * {@code authorization-service}'s {@code BaseIntegrationTest} (policiesDir() walker + OPA
 * container declaration).
 *
 * <p>Deliberately does NOT expose an {@code AuthorizationClient}-typed {@code @Bean}: Spring
 * Cloud OpenFeign registers {@code @FeignClient} proxies as {@code primary} by default, so even
 * with no {@code @MockitoBean} in play, a second {@code @Primary} bean of an assignable type
 * still causes {@code NoUniqueBeanDefinitionException} at context refresh (confirmed
 * empirically — see 10-08-SUMMARY.md; the same failure mode purchasing-service's
 * {@code RealOpaTestConfig} hits via its inherited {@code @MockitoBean}). Instead
 * {@code ExpenseOpaPolicyIT} declares its own {@code @MockitoBean AuthorizationClient} (as
 * {@code ExpenseApprovalIT} already does) and wires it in {@code setUp()} to delegate every call
 * to a manually-constructed {@link OpaBackedAuthorizationClient} — the mock is never stubbed
 * with a canned answer, so every call still round-trips to the real OPA container.
 */
@TestConfiguration
public class RealOpaTestConfig {

    /**
     * The bundle is <b>copied</b> into the container, never bind-mounted. A bind mount resolves to an
     * empty {@code /policies} from any host path the Docker VM does not share, and an OPA holding no
     * policy denies everything while answering {@code /health} with 200 — which would turn this
     * suite's deny assertions green for the wrong reason. See {@link OpaPolicyBundle}.
     */
    @SuppressWarnings("resource")
    static final GenericContainer<?> OPA =
        new GenericContainer<>(DockerImageName.parse("openpolicyagent/opa:1.17.1"))
            .withCommand("run", "--server", "--addr=0.0.0.0:8181", "/policies")
            .withExposedPorts(8181)
            .withCopyFileToContainer(MountableFile.forHostPath(policiesDir()), "/policies")
            .waitingFor(Wait.forHttp("/health").forPort(8181));

    static {
        OPA.start();
        // Positive control. Proves the engine actually holds the bundle before any test is allowed to
        // trust a decision from it; here rather than in an IT so it cannot be forgotten by one added later.
        OpaPolicyBundle.assertActuallyLoaded(opaBaseUrl(), policiesDir(), "restaurantos/finance.rego");
    }

    private static Path policiesDir() {
        Path cwd = Path.of(System.getProperty("user.dir")).toAbsolutePath();
        for (Path candidate : List.of(
                cwd.resolve("../../policies").normalize(),
                cwd.resolve("policies").normalize(),
                cwd.resolve("../../../policies").normalize())) {
            if (candidate.resolve("restaurantos/finance.rego").toFile().exists()) {
                return candidate;
            }
        }
        throw new IllegalStateException("Could not locate policies/ from " + cwd);
    }

    public static String opaBaseUrl() {
        return "http://" + OPA.getHost() + ":" + OPA.getMappedPort(8181);
    }

    @Bean
    public TestPrincipal testPrincipal() {
        return new TestPrincipal(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                List.of(), Map.of());
    }
}
