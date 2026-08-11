package io.restaurantos.hr.adms;

import org.junit.jupiter.api.Test;

import java.net.http.HttpResponse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * The one test for which tenant entitlement is the subject rather than the scenery.
 *
 * <p>{@code HrTestBase} stubs {@code FeatureFlagService} permissive for every other class, which is
 * safe only because this class exists: a control that nothing ever exercises in its denying direction
 * is indistinguishable from a control that does not work. That is the exact failure this plan is
 * fixing — the gateway <em>mapped</em> {@code /iclock/} to {@code FEATURE_HR} and could never act on
 * it, and three separate comments described the path as gated.
 *
 * <p>The gate is enforced in {@code DeviceAuthResolver}, immediately after the device resolves —
 * because that is the first moment a tenant exists on this path — and before any row is written.
 * The gateway cannot do it: {@code FeatureFlagGlobalFilter} derives the tenant from
 * {@code X-Tenant-Id}, and a terminal carries no JWT and no tenant header, which is precisely why
 * {@code JwtGlobalFilter} exempts these paths in the first place.
 */
class DeviceFeatureGateIT extends AdmsWireTestBase {

    @Test
    void aDeviceInATenantWithHrDisabledCannotWriteAPunch() throws Exception {
        Fixture fx = register("8001");
        when(featureFlagService.isEnabled(eq(fx.tenant()), eq("FEATURE_HR"))).thenReturn(false);

        HttpResponse<String> res = attlog(fx.serial(), fx.token(), "text/plain;charset=UTF-8",
                "8001\t2026-06-15 09:30:00\t0\t1\n");

        assertThat(res.statusCode())
                .as("a tenant whose HR module is off, or who has stopped paying for it, stops ingesting")
                .isNotEqualTo(200);
        assertThat(countPunchesByRef("8001"))
                .as("refused after resolution and BEFORE any write")
                .isZero();
        assertThat(countQuarantineByRef("8001")).isZero();
    }

    @Test
    void theSameDeviceIngestsNormallyOnceHrIsEnabled() throws Exception {
        Fixture fx = register("8002");
        when(featureFlagService.isEnabled(any(), anyString())).thenReturn(true);

        HttpResponse<String> res = attlog(fx.serial(), fx.token(), "text/plain;charset=UTF-8",
                "8002\t2026-06-15 09:30:00\t0\t1\n");

        assertThat(res.statusCode()).isEqualTo(200);
        assertThat(countPunchesByRef("8002")).isEqualTo(1);
    }

    /**
     * The gate must not become a second, distinguishable refusal channel on a public path. A caller
     * who can tell "wrong credential" from "that tenant stopped paying" learns which serials are
     * registered and something about the tenant behind them — the same oracle 25-04 closed.
     *
     * <p>Pinned rather than assumed: this is a real difference in the current implementation
     * ({@code FEATURE_DISABLED} vs {@code DEVICE_AUTH_FAILED}), and the assertion records the
     * judgement that the two are allowed to differ ONLY because the feature-disabled answer requires
     * a VALID credential to reach at all. An attacker who can reach it already holds the credential,
     * so it discloses nothing they did not already have.
     */
    @Test
    void theFeatureRefusalIsOnlyReachableByACallerThatAlreadyAuthenticated() throws Exception {
        Fixture fx = register(null);
        when(featureFlagService.isEnabled(any(), anyString())).thenReturn(false);

        HttpResponse<String> withGoodCredential = handshake(fx.serial(), fx.token());
        HttpResponse<String> withBadCredential = handshake(fx.serial(), "not-the-token");

        assertThat(withBadCredential.statusCode())
                .as("an unauthenticated caller learns nothing about the tenant's entitlement")
                .isEqualTo(401);
        assertThat(withBadCredential.body()).contains("DEVICE_AUTH_FAILED");
        assertThat(withGoodCredential.statusCode())
                .as("only a caller holding the device's own credential sees the entitlement answer")
                .isNotEqualTo(200);
    }
}
