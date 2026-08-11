package io.restaurantos.auth.integration;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.JWKSet;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.restaurantos.auth.entity.UserBranchRoleEntity;
import io.restaurantos.auth.entity.UserStationAssignmentEntity;
import io.restaurantos.auth.repository.UserBranchRoleRepository;
import io.restaurantos.auth.repository.UserStationAssignmentRepository;
import io.restaurantos.auth.service.PermissionResolver;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.transaction.support.TransactionTemplate;

import java.security.PublicKey;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * A user's stations are part of who they are, on every path that mints an identity (D-28-02).
 *
 * <p>The claim is asserted by driving the REAL endpoints — login, refresh, switch-branch — rather
 * than by calling {@link PermissionResolver} directly. Calling the resolver would prove the
 * resolver and nothing else: what actually has to stay true is that {@code AuthServiceImpl}'s login
 * mint, its refresh mint, and {@code BranchSwitchService} each pass {@code resolved.attributes()}
 * through to the signer. All three do today. This test is what keeps that true, because a mint path
 * that quietly stopped forwarding attributes would not fail to compile and would not throw — it
 * would simply un-scope every cook who has a scope.
 *
 * <p>The central assertion of the whole plan is
 * {@link #unassignedUser_hasNoStationKeyAtAll_notAnEmptyList()}. Absent is the only encoding of
 * "unrestricted", and every user in the product today is in that state.
 */
class StationAssignmentClaimIT extends BaseIntegrationTest {

    private static final UUID BAR = UUID.fromString("e0000001-0000-4000-8000-000000000001");
    private static final UUID PASS = UUID.fromString("e0000002-0000-4000-8000-000000000002");
    private static final UUID OTHER_BRANCH_ROW = UUID.fromString("e0000003-0000-4000-8000-000000000003");
    private static final UUID RETIRED_ROW = UUID.fromString("e0000004-0000-4000-8000-000000000004");
    private static final UUID BRANCH2_ROW = UUID.fromString("e0000005-0000-4000-8000-000000000005");
    private static final UUID LATE_ROW = UUID.fromString("e0000006-0000-4000-8000-000000000006");

    @Autowired private UserStationAssignmentRepository stationAssignmentRepository;
    @Autowired private UserBranchRoleRepository userBranchRoleRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void cleanAssignmentsAndEnsureBranchTwo() {
        inTenantTx(() -> {
            stationAssignmentRepository.deleteAll(
                stationAssignmentRepository.findByTenantIdAndUserIdAndBranchId(
                    TestFixtures.demoTenantId(), TestFixtures.cashierUserId(), TestFixtures.mainBranchId()));
            stationAssignmentRepository.deleteAll(
                stationAssignmentRepository.findByTenantIdAndUserIdAndBranchId(
                    TestFixtures.demoTenantId(), TestFixtures.cashierUserId(), TestFixtures.branch2Id()));

            if (userBranchRoleRepository.findByUserIdAndBranchIdAndActiveTrue(
                    TestFixtures.cashierUserId(), TestFixtures.branch2Id()).isEmpty()) {
                UserBranchRoleEntity assignment = new UserBranchRoleEntity();
                assignment.setId(UUID.fromString("d0000007-0000-4000-8000-000000000007"));
                assignment.setTenantId(TestFixtures.demoTenantId());
                assignment.setUserId(TestFixtures.cashierUserId());
                assignment.setBranchId(TestFixtures.branch2Id());
                assignment.setRoleCode("CASHIER");
                assignment.setActive(true);
                userBranchRoleRepository.save(assignment);
            }
            return null;
        });
    }

    // ── Behaviour 1 ──────────────────────────────────────────────────────────────────────────

    @Test
    void twoActiveAssignments_appearAsTheirCodes_sorted() throws Exception {
        givenStation(PASS, TestFixtures.mainBranchId(), "PASS", true);
        givenStation(BAR, TestFixtures.mainBranchId(), "BAR", true);

        assertThat(stationsIn(loginAsCashier())).containsExactly("BAR", "PASS");
    }

    // ── Behaviour 2 — the one every existing user depends on ─────────────────────────────────

    @Test
    void unassignedUser_hasNoStationKeyAtAll_notAnEmptyList() throws Exception {
        Claims claims = parseJwt(loginAsCashier());

        Map<String, Object> attributes = attributesOf(claims);
        assertThat(attributes)
            .as("An unassigned user must produce NO station key. An empty list is a second spelling "
                + "of 'unrestricted', and the first downstream reader to take it for an empty "
                + "allow-list blacks out every kitchen screen in the product.")
            .doesNotContainKey(PermissionResolver.STATION_SCOPE_CLAIM);
    }

    // ── Behaviour 3 ──────────────────────────────────────────────────────────────────────────

    @Test
    void assignmentAtAnotherBranch_doesNotLeakIntoThisBranchesToken() throws Exception {
        givenStation(OTHER_BRANCH_ROW, TestFixtures.branch2Id(), "BAR", true);

        assertThat(attributesOf(parseJwt(loginAsCashier())))
            .doesNotContainKey(PermissionResolver.STATION_SCOPE_CLAIM);
    }

    // ── Behaviour 4 ──────────────────────────────────────────────────────────────────────────

    @Test
    void inactiveAssignment_isExcluded() throws Exception {
        givenStation(BAR, TestFixtures.mainBranchId(), "BAR", true);
        givenStation(RETIRED_ROW, TestFixtures.mainBranchId(), "GRILL", false);

        assertThat(stationsIn(loginAsCashier())).containsExactly("BAR");
    }

    // ── Behaviour 5 ──────────────────────────────────────────────────────────────────────────

    @Test
    void loginMintsTheAttribute() throws Exception {
        givenStation(BAR, TestFixtures.mainBranchId(), "BAR", true);

        assertThat(stationsIn(loginAsCashier())).containsExactly("BAR");
    }

    // ── Behaviour 6 ──────────────────────────────────────────────────────────────────────────

    @Test
    void refreshRereadsFromTheDatabase_ratherThanCopyingThePreviousToken() throws Exception {
        givenStation(BAR, TestFixtures.mainBranchId(), "BAR", true);

        var login = postLogin();
        assertThat(stationsIn(accessTokenOf(login))).containsExactly("BAR");
        String refreshCookie = login.getHeaders().get("Set-Cookie").getFirst();

        // The admin adds a station AFTER the token was minted. A refresh that copied claims off the
        // old token would still say BAR only.
        givenStation(PASS, TestFixtures.mainBranchId(), "PASS", true);

        var refreshed = rest.post()
            .uri("/api/v1/auth/refresh")
            .header("Cookie", refreshCookie.substring(0, refreshCookie.indexOf(';')))
            .retrieve()
            .toEntity(String.class);
        assertThat(refreshed.getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(stationsIn(accessTokenOf(refreshed))).containsExactly("BAR", "PASS");
    }

    // ── Behaviour 7 ──────────────────────────────────────────────────────────────────────────

    @Test
    void branchSwitchMintsForTheTargetBranch_notTheOneTheCallerCameFrom() throws Exception {
        givenStation(BAR, TestFixtures.mainBranchId(), "BAR", true);
        givenStation(BRANCH2_ROW, TestFixtures.branch2Id(), "GRILL", true);

        String accessToken = loginAsCashier();
        assertThat(stationsIn(accessToken)).containsExactly("BAR");

        var switched = rest.post()
            .uri("/api/v1/auth/switch-branch")
            .header("Authorization", "Bearer " + accessToken)
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("branchId", TestFixtures.branch2Id().toString()))
            .retrieve()
            .toEntity(String.class);
        assertThat(switched.getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(stationsIn(accessTokenOf(switched)))
            .as("the target branch's stations, not the origin branch's")
            .containsExactly("GRILL");
    }

    // ── Behaviour 8 ──────────────────────────────────────────────────────────────────────────

    @Test
    void approvalLimitAttribute_survivesAlongsideTheStationList() throws Exception {
        givenStation(BAR, TestFixtures.mainBranchId(), "BAR", true);
        inTenantTx(() -> {
            UserBranchRoleEntity role = userBranchRoleRepository
                .findByUserIdAndBranchIdAndActiveTrue(
                    TestFixtures.cashierUserId(), TestFixtures.mainBranchId())
                .getFirst();
            role.setApprovalLimitPaisa(2_500_00L);
            return userBranchRoleRepository.save(role);
        });

        Map<String, Object> attributes = attributesOf(parseJwt(loginAsCashier()));
        assertThat(attributes).containsEntry("approval_limit_paisa", 250000);
        assertThat(attributes).containsKey(PermissionResolver.STATION_SCOPE_CLAIM);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    /**
     * Writes an assignment row with the tenant GUC set on the SAME connection the write uses.
     *
     * <p>{@code user_station_assignments} is FORCE ROW LEVEL SECURITY. {@code setRls} in the base
     * class sets a session GUC on whatever connection the caller happens to hold, which is not
     * necessarily the one a repository write will pick up — so the GUC is set inside the transaction
     * that does the write, the same shape {@code BranchRoleAdminService.setTenantGuc} uses in
     * production for the same reason.
     */
    private void givenStation(UUID id, UUID branchId, String code, boolean active) {
        inTenantTx(() -> {
            UserStationAssignmentEntity row = new UserStationAssignmentEntity();
            row.setId(id);
            row.setTenantId(TestFixtures.demoTenantId());
            row.setUserId(TestFixtures.cashierUserId());
            row.setBranchId(branchId);
            row.setStationCode(code);
            row.setActive(active);
            return stationAssignmentRepository.save(row);
        });
    }

    private <T> T inTenantTx(java.util.function.Supplier<T> work) {
        return new TransactionTemplate(transactionManager).execute(status -> {
            entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
                .setParameter("tid", TestFixtures.demoTenantId().toString())
                .getSingleResult();
            return work.get();
        });
    }

    private org.springframework.http.ResponseEntity<String> postLogin() {
        var login = rest.post()
            .uri("/api/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .body(TestFixtures.loginBody(
                TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, TestFixtures.DEMO_SLUG))
            .retrieve()
            .toEntity(String.class);
        assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);
        return login;
    }

    private String loginAsCashier() {
        return accessTokenOf(postLogin());
    }

    private String accessTokenOf(org.springframework.http.ResponseEntity<String> response) {
        try {
            return objectMapper.readTree(response.getBody()).path("data").path("accessToken").asText();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> attributesOf(Claims claims) {
        Map<String, Object> attributes = claims.get("attributes", Map.class);
        return attributes == null ? Map.of() : attributes;
    }

    @SuppressWarnings("unchecked")
    private List<String> stationsIn(String accessToken) throws Exception {
        Object value = attributesOf(parseJwt(accessToken)).get(PermissionResolver.STATION_SCOPE_CLAIM);
        assertThat(value).as("station scope claim").isInstanceOf(List.class);
        return (List<String>) value;
    }

    private Claims parseJwt(String accessToken) throws Exception {
        String jwksBody = rest.get().uri("/.well-known/jwks.json").retrieve().body(String.class);
        JWKSet jwkSet = JWKSet.parse(jwksBody);
        PublicKey publicKey = jwkSet.getKeys().getFirst().toRSAKey().toPublicKey();
        return Jwts.parser().verifyWith(publicKey).build().parseSignedClaims(accessToken).getPayload();
    }
}
