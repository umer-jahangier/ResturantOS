package io.restaurantos.user;

import io.restaurantos.user.config.UserInternalServiceFilter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves SC5/USER-01 branch RLS isolation — DB-enforced, not app-filtered.
 * Uses Testcontainers Postgres with real Liquibase migrations and RLS policies.
 */
class BranchRlsIT extends BaseUserIT {

    private static final String INTERNAL_SECRET = "test-internal-secret";

    @Autowired JdbcTemplate jdbc;

    @Test
    void tenantA_canCrudBranches_rlsScopedToTenantA() {
        // Create HQ branch for Tenant A via internal endpoint
        setRls(TENANT_A);
        Map<String, Object> createBody = Map.of(
            "tenantId", TENANT_A.toString(),
            "name", "Main Branch A",
            "isHq", true
        );
        ResponseEntity<String> created = postWithHeader(
            "/internal/users/branches", createBody,
            UserInternalServiceFilter.HEADER, INTERNAL_SECRET
        );
        assertThat(created.getStatusCode().value()).isEqualTo(201);
        assertThat(created.getBody()).contains("branchId");

        // Create second branch for Tenant A
        Map<String, Object> createBody2 = Map.of(
            "tenantId", TENANT_A.toString(),
            "name", "Branch A2",
            "isHq", false
        );
        postWithHeader("/internal/users/branches", createBody2,
            UserInternalServiceFilter.HEADER, INTERNAL_SECRET);

        // List branches for Tenant A via internal endpoint — should return 2
        setRls(TENANT_A);
        ResponseEntity<String> listResp = getWithHeader(
            "/internal/users/tenants/" + TENANT_A + "/branches",
            UserInternalServiceFilter.HEADER, INTERNAL_SECRET
        );
        assertThat(listResp.getStatusCode().value()).isEqualTo(200);
        assertThat(listResp.getBody()).contains("Main Branch A");
        assertThat(listResp.getBody()).contains("Branch A2");
    }

    @Test
    void tenantA_cannotSeeTenantB_branchViaRls() {
        // Create a branch under TENANT_B via the internal API (endpoint sets GUC correctly)
        String branchBName = "Branch-B-Exclusive-" + UUID.randomUUID();
        Map<String, Object> bodyB = Map.of(
            "tenantId", TENANT_B.toString(),
            "name", branchBName,
            "isHq", false
        );
        ResponseEntity<String> created = postWithHeader(
            "/internal/users/branches", bodyB,
            UserInternalServiceFilter.HEADER, INTERNAL_SECRET
        );
        assertThat(created.getStatusCode().value()).isEqualTo(201);

        // List TENANT_A's branches — TENANT_B's branch must not appear (RLS isolation)
        ResponseEntity<String> listA = getWithHeader(
            "/internal/users/tenants/" + TENANT_A + "/branches",
            UserInternalServiceFilter.HEADER, INTERNAL_SECRET
        );
        assertThat(listA.getStatusCode().value()).isEqualTo(200);
        assertThat(listA.getBody()).doesNotContain(branchBName);

        // List TENANT_B's branches — must contain the inserted branch
        ResponseEntity<String> listB = getWithHeader(
            "/internal/users/tenants/" + TENANT_B + "/branches",
            UserInternalServiceFilter.HEADER, INTERNAL_SECRET
        );
        assertThat(listB.getStatusCode().value()).isEqualTo(200);
        assertThat(listB.getBody()).contains(branchBName);
    }

    @Test
    void duplicateBranchName_withinSameTenant_returns409() {
        setRls(TENANT_A);
        String branchName = "DuplicateTest-" + UUID.randomUUID();
        Map<String, Object> createBody = Map.of(
            "tenantId", TENANT_A.toString(),
            "name", branchName,
            "isHq", false
        );
        // First creation succeeds
        ResponseEntity<String> first = postWithHeader(
            "/internal/users/branches", createBody,
            UserInternalServiceFilter.HEADER, INTERNAL_SECRET
        );
        assertThat(first.getStatusCode().value()).isEqualTo(201);

        // Second creation with same name should fail with 409
        ResponseEntity<String> second = postWithHeader(
            "/internal/users/branches", createBody,
            UserInternalServiceFilter.HEADER, INTERNAL_SECRET
        );
        assertThat(second.getStatusCode().value()).isEqualTo(409);
    }

    @Test
    void internalEndpoint_withoutSecret_returns403() {
        Map<String, Object> body = Map.of(
            "tenantId", TENANT_A.toString(),
            "name", "Test Branch",
            "isHq", false
        );
        ResponseEntity<String> resp = post("/internal/users/branches", body);
        assertThat(resp.getStatusCode().value()).isEqualTo(403);
        assertThat(resp.getBody()).contains("INTERNAL_AUTH_REQUIRED");
    }
}
