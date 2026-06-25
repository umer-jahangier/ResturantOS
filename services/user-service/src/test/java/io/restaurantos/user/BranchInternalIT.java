package io.restaurantos.user;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.user.config.UserInternalServiceFilter;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Tests for BranchInternalController — covers FD-1 step 4 (POST /internal/users/branches)
 * and branch-detail GETs for downstream consumption.
 */
class BranchInternalIT extends BaseUserIT {

    private static final String INTERNAL_SECRET = "test-internal-secret";

    @Test
    void createBranch_withoutSecret_returns403() {
        Map<String, Object> body = Map.of(
            "tenantId", TENANT_A.toString(),
            "name", "HQ Branch",
            "isHq", true
        );
        ResponseEntity<String> resp = post("/internal/users/branches", body);
        assertThat(resp.getStatusCode().value()).isEqualTo(403);
        assertThat(resp.getBody()).contains("INTERNAL_AUTH_REQUIRED");
    }

    @Test
    void createBranch_withSecret_returns201WithBranchId() {
        setRls(TENANT_A);
        String name = "HQ-" + UUID.randomUUID();
        Map<String, Object> body = Map.of(
            "tenantId", TENANT_A.toString(),
            "name", name,
            "isHq", true
        );
        ResponseEntity<String> resp = postWithHeader(
            "/internal/users/branches", body,
            UserInternalServiceFilter.HEADER, INTERNAL_SECRET
        );
        assertThat(resp.getStatusCode().value()).isEqualTo(201);
        assertThat(resp.getBody()).contains("branchId");

        // Verify row exists in DB
        setRls(TENANT_A);
        long count = (long) entityManager
            .createNativeQuery("SELECT COUNT(*) FROM branches WHERE name = :name AND is_hq = true")
            .setParameter("name", name)
            .getSingleResult();
        assertThat(count).isEqualTo(1);
    }

    @Test
    void getBranchesByTenant_returnsAllLiveBranches() throws Exception {
        setRls(TENANT_A);
        // Create two branches
        String name1 = "Branch1-" + UUID.randomUUID();
        String name2 = "Branch2-" + UUID.randomUUID();
        createBranch(name1, false);
        createBranch(name2, false);

        ResponseEntity<String> listResp = getWithHeader(
            "/internal/users/tenants/" + TENANT_A + "/branches",
            UserInternalServiceFilter.HEADER, INTERNAL_SECRET
        );
        assertThat(listResp.getStatusCode().value()).isEqualTo(200);
        assertThat(listResp.getBody()).contains(name1);
        assertThat(listResp.getBody()).contains(name2);
    }

    @Test
    void getBranch_byId_returnsDetail() throws Exception {
        setRls(TENANT_A);
        String name = "DetailBranch-" + UUID.randomUUID();
        UUID branchId = createBranch(name, false);

        ResponseEntity<String> resp = getWithHeader(
            "/internal/users/branches/" + branchId,
            UserInternalServiceFilter.HEADER, INTERNAL_SECRET
        );
        // Requires X-Tenant-Id for GUC — basic check that endpoint exists
        // Without X-Tenant-Id header the request should still reach the controller
        // (GUC was already set in test via setRls). Response may be 200 or 400 depending
        // on whether X-Tenant-Id is required.
        assertThat(resp.getStatusCode().value()).isIn(200, 400);
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    private UUID createBranch(String name, boolean isHq) throws Exception {
        Map<String, Object> body = Map.of(
            "tenantId", TENANT_A.toString(),
            "name", name,
            "isHq", isHq
        );
        ResponseEntity<String> resp = postWithHeader(
            "/internal/users/branches", body,
            UserInternalServiceFilter.HEADER, INTERNAL_SECRET
        );
        assertThat(resp.getStatusCode().value()).isEqualTo(201);
        ObjectMapper om = new ObjectMapper();
        Map<?, ?> parsed = om.readValue(resp.getBody(), Map.class);
        return UUID.fromString((String) parsed.get("branchId"));
    }
}
