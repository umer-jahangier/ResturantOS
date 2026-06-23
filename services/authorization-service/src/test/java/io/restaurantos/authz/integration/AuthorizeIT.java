package io.restaurantos.authz.integration;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class AuthorizeIT extends BaseIntegrationTest {

    @Test
    void allowWhenPermissionTenantAndBranchMatch() throws Exception {
        String jwt = TestFixtures.mintJwt(
            TestFixtures.cashierUserId(),
            TestFixtures.demoTenantId(),
            TestFixtures.mainBranchId(),
            List.of("CASHIER"),
            List.of("pos.order.void.any"),
            Map.of());

        var response = postAuthorize(
            jwt,
            authorizeBody("pos", "void", resource(TestFixtures.demoTenantId(), TestFixtures.mainBranchId())),
            INTERNAL_SECRET);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(readAllow(response.getBody())).as(response.getBody()).isTrue();
    }

    @Test
    void denyCrossTenant() throws Exception {
        String jwt = TestFixtures.mintJwt(
            TestFixtures.cashierUserId(),
            TestFixtures.demoTenantId(),
            TestFixtures.mainBranchId(),
            List.of("CASHIER"),
            List.of("pos.order.void.any"),
            Map.of());

        var response = postAuthorize(
            jwt,
            authorizeBody("pos", "void", resource(TestFixtures.otherTenantId(), TestFixtures.mainBranchId())),
            INTERNAL_SECRET);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(readAllow(response.getBody())).isFalse();
    }

    @Test
    void denyCrossBranch() throws Exception {
        String jwt = TestFixtures.mintJwt(
            TestFixtures.cashierUserId(),
            TestFixtures.demoTenantId(),
            TestFixtures.mainBranchId(),
            List.of("CASHIER"),
            List.of("pos.order.void.any"),
            Map.of());

        var response = postAuthorize(
            jwt,
            authorizeBody("pos", "void", resource(TestFixtures.demoTenantId(), TestFixtures.branch2Id())),
            INTERNAL_SECRET);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(readAllow(response.getBody())).isFalse();
    }

    @Test
    void financeClosePeriodAllowsCrossBranchSameTenant() throws Exception {
        String jwt = TestFixtures.mintJwt(
            TestFixtures.ownerUserId(),
            TestFixtures.demoTenantId(),
            TestFixtures.mainBranchId(),
            List.of("OWNER"),
            List.of("finance.period.close"),
            Map.of());

        var response = postAuthorize(
            jwt,
            authorizeBody("finance", "close_period",
                resource(TestFixtures.demoTenantId(), TestFixtures.branch2Id())),
            INTERNAL_SECRET);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(readAllow(response.getBody())).isTrue();
    }

    @Test
    void financeClosePeriodDeniesCrossTenant() throws Exception {
        String jwt = TestFixtures.mintJwt(
            TestFixtures.ownerUserId(),
            TestFixtures.demoTenantId(),
            TestFixtures.mainBranchId(),
            List.of("OWNER"),
            List.of("finance.period.close"),
            Map.of());

        var response = postAuthorize(
            jwt,
            authorizeBody("finance", "close_period",
                resource(TestFixtures.otherTenantId(), TestFixtures.branch2Id())),
            INTERNAL_SECRET);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(readAllow(response.getBody())).isFalse();
    }

    @Test
    void missingInternalServiceSecretReturns403() {
        String jwt = TestFixtures.mintJwt(
            TestFixtures.cashierUserId(),
            TestFixtures.demoTenantId(),
            TestFixtures.mainBranchId(),
            List.of("CASHIER"),
            List.of("pos.order.void.any"),
            Map.of());

        var response = postAuthorize(
            jwt,
            authorizeBody("pos", "void", resource(TestFixtures.demoTenantId(), TestFixtures.mainBranchId())),
            null);

        assertThat(response.getStatusCode().value()).isEqualTo(403);
    }
}
