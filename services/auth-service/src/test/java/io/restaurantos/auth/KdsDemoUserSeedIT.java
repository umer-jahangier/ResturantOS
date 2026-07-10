package io.restaurantos.auth;

import io.restaurantos.auth.config.InternalServiceFilter;
import io.restaurantos.auth.integration.BaseIntegrationTest;
import io.restaurantos.auth.integration.TestFixtures;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration test for the KDS demo-user seed data (chef@demo.local / manager@demo.local),
 * proving both new users resolve the expected role-scoped permissions at the auth-service
 * API boundary — not just at the seed-data level.
 */
class KdsDemoUserSeedIT extends BaseIntegrationTest {

    private static final String INTERNAL_SECRET = "dev-internal-secret";

    @Test
    void chefUser_resolvesKitchenStaffPermissionsOnly() {
        UUID userId = TestFixtures.KITCHEN_STAFF_USER_ID;
        UUID branchId = TestFixtures.MAIN_BRANCH_ID;

        ResponseEntity<String> response = exchangeGet(
            "/internal/auth/users/" + userId + "/permissions?branchId=" + branchId,
            INTERNAL_SECRET
        );
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).contains("pos.kds.view");
        assertThat(response.getBody()).contains("pos.kds.update");
        assertThat(response.getBody()).doesNotContain("pos.order.void");
    }

    @Test
    void managerUser_resolvesKdsViewButNotUpdate() {
        UUID userId = TestFixtures.MANAGER_USER_ID;
        UUID branchId = TestFixtures.MAIN_BRANCH_ID;

        ResponseEntity<String> response = exchangeGet(
            "/internal/auth/users/" + userId + "/permissions?branchId=" + branchId,
            INTERNAL_SECRET
        );
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).contains("pos.kds.view");
        assertThat(response.getBody()).doesNotContain("pos.kds.update");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private ResponseEntity<String> exchangeGet(String uri, String internalSecret) {
        return rest.get()
            .uri(uri)
            .header(InternalServiceFilter.HEADER, internalSecret)
            .exchange((request, response) -> toResponseEntity(response));
    }

    private static ResponseEntity<String> toResponseEntity(org.springframework.http.client.ClientHttpResponse response)
            throws java.io.IOException {
        byte[] bytes = response.getBody() != null ? response.getBody().readAllBytes() : new byte[0];
        return ResponseEntity.status(response.getStatusCode())
            .headers(response.getHeaders())
            .body(new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
    }
}
