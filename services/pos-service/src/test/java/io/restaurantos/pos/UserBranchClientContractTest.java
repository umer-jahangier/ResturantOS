package io.restaurantos.pos;

import io.restaurantos.pos.feign.UserBranchClient;
import org.junit.jupiter.api.Test;
import org.springframework.cloud.openfeign.support.SpringMvcContract;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves that {@link UserBranchClient} is a Feign interface Spring can actually build.
 *
 * <h3>Why this exists as its own test</h3>
 *
 * <p>{@code UserBranchClient} is {@code @MockitoBean} in every integration test in this module —
 * it has to be, since Eureka is off and there is nothing to dial. A mocked bean means the Feign
 * contract for this interface is <b>never parsed</b> anywhere in the suite. So the whole module can
 * be green while the real application context fails to start, and the first thing to find out would
 * be a service that will not boot.
 *
 * <p>That is not hypothetical here. {@code getBranchStatus} was added as a SECOND method mapped to
 * the same {@code GET /internal/users/branches/{branchId}} as {@code getBranch}, deliberately, so
 * that the fail-soft receipt read and the fail-closed liveness read cannot be changed into each
 * other by editing one record. Whether Feign's contract tolerates two methods on one path is a
 * property of the framework, not of this code, and the only honest way to know is to ask it.
 *
 * <p>A plain unit test, not an {@code IT}: it needs no container, no context and no database, so it
 * runs on every build rather than only when someone runs the integration suite.
 */
class UserBranchClientContractTest {

    @Test
    void bothMethodsParse_soTheApplicationContextCanStart() {
        List<feign.MethodMetadata> metadata =
                new SpringMvcContract().parseAndValidateMetadata(UserBranchClient.class);

        assertThat(metadata)
                .as("every method on the interface must yield metadata")
                .hasSize(UserBranchClient.class.getDeclaredMethods().length);

        assertThat(metadata)
                .extracting(m -> m.template().method() + " " + m.template().url())
                .as("both reads hit the same internal endpoint on purpose")
                .containsExactlyInAnyOrder(
                        "GET /internal/users/branches/{branchId}",
                        "GET /internal/users/branches/{branchId}");
    }

    /**
     * The tenant header is not decoration: {@code branches} is FORCE ROW LEVEL SECURITY on
     * {@code app.current_tenant_id} and {@code /internal/**} carries no JWT, so a request without it
     * matches zero rows. user-service renders that as a 404, which {@code ActiveBranchGuard} reads
     * as "not a live branch" — turning a missing header into a fleet-wide refusal to take orders.
     */
    @Test
    void theLivenessReadSendsTheTenantHeader() {
        feign.MethodMetadata status = new SpringMvcContract()
                .parseAndValidateMetadata(UserBranchClient.class).stream()
                .filter(m -> m.configKey().startsWith("UserBranchClient#getBranchStatus"))
                .findFirst()
                .orElseThrow(() -> new AssertionError("getBranchStatus produced no Feign metadata"));

        assertThat(status.template().headers()).containsKey("X-Tenant-Id");
    }
}
