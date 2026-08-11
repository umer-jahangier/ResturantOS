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

    /**
     * The endpoint answers for the tenant it is told about, and for no one else.
     *
     * <p>This assertion used to read {@code isIn(200, 400)} above a comment saying the response
     * "may be 200 or 400 depending on whether X-Tenant-Id is required" — a test written without
     * knowing what the endpoint does, and which could not have found out: the harness connected
     * to PostgreSQL as a SUPERUSER, so RLS never applied and the branch came back whatever tenant
     * was named. The foreign-tenant leg below is the one that matters. Restore the superuser
     * connection in {@link BaseUserIT} and it fails, because nothing else in the request path
     * scopes this read — {@code /internal/users/**} is not covered by
     * {@code UserWebMvcConfig}'s {@code /api/v1/**} interceptor, so the Hibernate tenantFilter is
     * never enabled on it either.
     *
     * <p>Not asserted here, and deliberately: what an internal call that names NO tenant returns.
     * It is not a fixed value — see the report on {@code JwtAuthenticationFilter}'s no-token early
     * return, which skips the {@code tenantContext.clear()} that its {@code finally} performs on
     * the token path, leaving the previous request's tenant on the worker thread.
     */
    @Test
    void getBranch_byId_needsATenant_andHonoursTheOneItIsGiven() throws Exception {
        setRls(TENANT_A);
        String name = "DetailBranch-" + UUID.randomUUID();
        UUID branchId = createBranch(name, false);

        ResponseEntity<String> owningTenant = rest.get()
            .uri("/internal/users/branches/" + branchId)
            .header(UserInternalServiceFilter.HEADER, INTERNAL_SECRET)
            .header("X-Tenant-Id", TENANT_A.toString())
            .exchange((req, res) -> toEntity(res), false);
        assertThat(owningTenant.getStatusCode().value()).isEqualTo(200);
        assertThat(owningTenant.getBody()).contains(name);

        ResponseEntity<String> foreignTenant = rest.get()
            .uri("/internal/users/branches/" + branchId)
            .header(UserInternalServiceFilter.HEADER, INTERNAL_SECRET)
            .header("X-Tenant-Id", TENANT_B.toString())
            .exchange((req, res) -> toEntity(res), false);
        assertThat(foreignTenant.getStatusCode().value())
            .as("tenant B asked for tenant A's branch by id and must not get it")
            .isEqualTo(404);
        assertThat(foreignTenant.getBody()).doesNotContain(name);
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
