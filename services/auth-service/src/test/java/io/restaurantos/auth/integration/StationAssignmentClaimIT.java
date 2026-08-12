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

    /** /internal/auth/** is gated by InternalServiceFilter; the dev secret is what the test stack uses. */
    private static final String INTERNAL_HEADER = "X-Internal-Service";
    private static final String INTERNAL_SECRET = "dev-internal-secret";

    private static final UUID BAR = UUID.fromString("e0000001-0000-4000-8000-000000000001");
    private static final UUID PASS = UUID.fromString("e0000002-0000-4000-8000-000000000002");
    private static final UUID OTHER_BRANCH_ROW = UUID.fromString("e0000003-0000-4000-8000-000000000003");
    private static final UUID RETIRED_ROW = UUID.fromString("e0000004-0000-4000-8000-000000000004");
    private static final UUID BRANCH2_ROW = UUID.fromString("e0000005-0000-4000-8000-000000000005");
    private static final UUID LATE_ROW = UUID.fromString("e0000006-0000-4000-8000-000000000006");

    /**
     * The cook this class OWNS, rather than the seeded cashier it used to borrow.
     *
     * <h2>Why this class stopped using {@code COOK_ID}</h2>
     *
     * <p>Every test here writes to its subject: it assigns stations, clears them, and one of them
     * ({@link #approvalLimitAttribute_survivesAlongsideTheStationList()}) rewrites the subject's
     * approval limit. Pointed at the shared seeded cashier, all of that outlived the class. The
     * {@code @BeforeEach} below cleaned the station rows, which protected THIS class from whatever
     * ran before it and protected nobody from this class — cleanup that runs before each test
     * leaves the last test's writes standing for every class that follows.
     *
     * <p>Measured: {@code AuthLoginIT.loginSuccess_issuesJwtRefreshCookieAndLoginEvent} nine
     * classes later read the cashier's attributes as
     * {@code {"approval_limit_paisa"=250000, "stations"=["BAR","PASS"]}} where the seed says
     * {@code 5000000} and no stations at all. Both halves of that are this class's leftovers. It
     * passed when the classes happened to run the other way round, which is not a gate.
     *
     * <p>The rule this restores is the one the suite needs generally: <b>no IT class mutates a row
     * it did not create</b>. Owning the user is what makes the writes above safe, and it costs
     * nothing in coverage — none of these behaviours are about the cashier specifically, only about
     * a user who has stations.
     */
    private static final UUID COOK_ID = UUID.fromString("c0000051-0000-4000-8000-000000000051");
    private static final UUID COOK_MAIN_ROLE_ID = UUID.fromString("d0000051-0000-4000-8000-000000000051");
    private static final UUID COOK_BRANCH2_ROLE_ID = UUID.fromString("d0000052-0000-4000-8000-000000000052");
    private static final String COOK_EMAIL = "station-cook@demo.local";
    private static final String COOK_PASSWORD = "Sc7!vwmtBn3%";

    @Autowired private UserStationAssignmentRepository stationAssignmentRepository;
    @Autowired private UserBranchRoleRepository userBranchRoleRepository;
    @Autowired private org.springframework.security.crypto.password.PasswordEncoder passwordEncoder;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void seedTheCookThisClassOwns() {
        inTenantTx(() -> {
            // ON CONFLICT DO NOTHING: the row survives between tests in the same fork, and the
            // password hash minted on the first pass stays valid for every later login.
            entityManager.createNativeQuery("""
                    INSERT INTO users (id, tenant_id, email, password_hash, full_name, totp_enabled,
                                       is_active, failed_login_count, created_at, updated_at, version,
                                       must_change_password)
                    VALUES (:id, :tid, :email, :hash, 'Station Cook', false, true, 0, now(), now(), 0, false)
                    ON CONFLICT (id) DO NOTHING
                    """)
                .setParameter("id", COOK_ID)
                .setParameter("tid", TestFixtures.demoTenantId())
                .setParameter("email", COOK_EMAIL)
                .setParameter("hash", passwordEncoder.encode(COOK_PASSWORD))
                .executeUpdate();

            // CASHIER at both branches: the role code only has to be one that logs in and carries
            // no station scope of its own, so that what these tests assert about the claim is
            // produced by the station rows below and nothing else.
            ensureActiveRole(COOK_MAIN_ROLE_ID, TestFixtures.mainBranchId());
            ensureActiveRole(COOK_BRANCH2_ROLE_ID, TestFixtures.branch2Id());

            // Still cleaned per-test, because these tests assert exact station sets against each
            // other. The difference from before is that the rows belong to this class.
            stationAssignmentRepository.deleteAll(
                stationAssignmentRepository.findByTenantIdAndUserIdAndBranchId(
                    TestFixtures.demoTenantId(), COOK_ID, TestFixtures.mainBranchId()));
            stationAssignmentRepository.deleteAll(
                stationAssignmentRepository.findByTenantIdAndUserIdAndBranchId(
                    TestFixtures.demoTenantId(), COOK_ID, TestFixtures.branch2Id()));
            return null;
        });
    }

    /**
     * Restores the cook's role at one branch to a known state — active, CASHIER, no approval limit
     * — creating it the first time. Re-asserted every test because
     * {@link #approvalLimitAttribute_survivesAlongsideTheStationList()} writes a limit onto it and
     * the tests that follow must not inherit that.
     */
    private void ensureActiveRole(UUID roleRowId, UUID branchId) {
        UserBranchRoleEntity assignment = userBranchRoleRepository.findById(roleRowId)
            .orElseGet(UserBranchRoleEntity::new);
        assignment.setId(roleRowId);
        assignment.setTenantId(TestFixtures.demoTenantId());
        assignment.setUserId(COOK_ID);
        assignment.setBranchId(branchId);
        assignment.setRoleCode("CASHIER");
        assignment.setActive(true);
        assignment.setApprovalLimitPaisa(null);
        userBranchRoleRepository.save(assignment);
    }

    // ── Behaviour 1 ──────────────────────────────────────────────────────────────────────────

    @Test
    void twoActiveAssignments_appearAsTheirCodes_sorted() throws Exception {
        givenStation(PASS, TestFixtures.mainBranchId(), "PASS", true);
        givenStation(BAR, TestFixtures.mainBranchId(), "BAR", true);

        assertThat(stationsIn(loginAsTheCook())).containsExactly("BAR", "PASS");
    }

    // ── Behaviour 2 — the one every existing user depends on ─────────────────────────────────

    @Test
    void unassignedUser_hasNoStationKeyAtAll_notAnEmptyList() throws Exception {
        Claims claims = parseJwt(loginAsTheCook());

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

        assertThat(attributesOf(parseJwt(loginAsTheCook())))
            .doesNotContainKey(PermissionResolver.STATION_SCOPE_CLAIM);
    }

    // ── Behaviour 4 ──────────────────────────────────────────────────────────────────────────

    @Test
    void inactiveAssignment_isExcluded() throws Exception {
        givenStation(BAR, TestFixtures.mainBranchId(), "BAR", true);
        givenStation(RETIRED_ROW, TestFixtures.mainBranchId(), "GRILL", false);

        assertThat(stationsIn(loginAsTheCook())).containsExactly("BAR");
    }

    // ── Behaviour 5 ──────────────────────────────────────────────────────────────────────────

    @Test
    void loginMintsTheAttribute() throws Exception {
        givenStation(BAR, TestFixtures.mainBranchId(), "BAR", true);

        assertThat(stationsIn(loginAsTheCook())).containsExactly("BAR");
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

        String accessToken = loginAsTheCook();
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
                    COOK_ID, TestFixtures.mainBranchId())
                .getFirst();
            role.setApprovalLimitPaisa(2_500_00L);
            return userBranchRoleRepository.save(role);
        });

        Map<String, Object> attributes = attributesOf(parseJwt(loginAsTheCook()));
        assertThat(attributes).containsEntry("approval_limit_paisa", 250000);
        assertThat(attributes).containsKey(PermissionResolver.STATION_SCOPE_CLAIM);
    }

    // ── The write path (task 3) ──────────────────────────────────────────────────────────────
    //
    // Deliberately in the SAME class as the claim behaviours above. The write and the claim it
    // produces are one story: split across two files it becomes possible for the write to pass
    // while the claim regresses, which is precisely the failure that leaves an administrator
    // configuring a bartender who then sees everything.

    @Test
    void replacingStations_leavesExactlyThatSet() {
        putStations(TestFixtures.mainBranchId(), List.of("BAR", "PASS"));
        assertThat(activeCodesAtMainBranch()).containsExactly("BAR", "PASS");

        putStations(TestFixtures.mainBranchId(), List.of("GRILL"));
        assertThat(activeCodesAtMainBranch())
            .as("replace, not merge — unchecking a box has no additive spelling")
            .containsExactly("GRILL");
    }

    @Test
    void replacingWithAnEmptySet_returnsTheUserToUnrestricted() throws Exception {
        putStations(TestFixtures.mainBranchId(), List.of("BAR"));
        assertThat(stationsIn(loginAsTheCook())).containsExactly("BAR");

        putStations(TestFixtures.mainBranchId(), List.of());

        assertThat(activeCodesAtMainBranch()).isEmpty();
        assertThat(attributesOf(parseJwt(loginAsTheCook())))
            .as("cleared means unrestricted, and unrestricted means no key")
            .doesNotContainKey(PermissionResolver.STATION_SCOPE_CLAIM);
    }

    @Test
    void replacingIsIdempotent_andDoesNotAccumulateRows() {
        putStations(TestFixtures.mainBranchId(), List.of("BAR", "PASS"));
        putStations(TestFixtures.mainBranchId(), List.of("BAR", "PASS"));

        List<UserStationAssignmentEntity> rows = inTenantTx(() ->
            stationAssignmentRepository.findByTenantIdAndUserIdAndBranchId(
                TestFixtures.demoTenantId(), COOK_ID, TestFixtures.mainBranchId()));
        assertThat(rows).hasSize(2);
        assertThat(activeCodesAtMainBranch()).containsExactly("BAR", "PASS");
    }

    @Test
    void reAddingAStationThatWasRemoved_reactivatesTheRowRatherThanCollidingWithIt() {
        putStations(TestFixtures.mainBranchId(), List.of("BAR"));
        putStations(TestFixtures.mainBranchId(), List.of());

        // The unique constraint on (tenant, user, branch, code) would reject a second BAR row, so a
        // delete-then-insert implementation passes every test that assigns once and fails the first
        // time an administrator changes their mind back.
        putStations(TestFixtures.mainBranchId(), List.of("BAR"));

        assertThat(activeCodesAtMainBranch()).containsExactly("BAR");
    }

    @Test
    void aUserInAnotherTenant_answersExactlyAsANonexistentOne() {
        UUID foreignUser = UUID.fromString("c000000f-0000-4000-8000-00000000000f");
        UUID nonexistent = UUID.randomUUID();

        var foreign = putStationsRaw(foreignUser, TestFixtures.mainBranchId(), List.of("BAR"));
        var missing = putStationsRaw(nonexistent, TestFixtures.mainBranchId(), List.of("BAR"));

        assertThat(foreign.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(missing.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(foreign.getBody())
            .as("two different refusals are a distinguisher whatever their status codes say")
            .isEqualTo(missing.getBody());
    }

    @Test
    void aRequestWithStationCodesButNoBranch_isRefusedAsAValidationError() {
        var response = rest.put()
            .uri("/internal/auth/users/" + COOK_ID + "/stations")
            .header(INTERNAL_HEADER, INTERNAL_SECRET)
            .header("X-Tenant-Id", TestFixtures.demoTenantId().toString())
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("stationCodes", List.of("BAR")))
            .exchange((req, res) -> org.springframework.http.ResponseEntity
                .status(res.getStatusCode()).body(""));

        assertThat(response.getStatusCode())
            .as("a station code is only unique within a branch, so a branch-less assignment is "
                + "ambiguous by construction and must not be guessed at")
            .isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    void theReadEndpoint_returnsAssignmentsGroupedByBranch() throws Exception {
        putStations(TestFixtures.mainBranchId(), List.of("BAR", "PASS"));
        putStations(TestFixtures.branch2Id(), List.of("GRILL"));

        String body = rest.get()
            .uri("/internal/auth/users/" + COOK_ID + "/stations")
            .header(INTERNAL_HEADER, INTERNAL_SECRET)
            .header("X-Tenant-Id", TestFixtures.demoTenantId().toString())
            .retrieve()
            .body(String.class);

        var tree = objectMapper.readTree(body);
        assertThat(tree).hasSize(2);
        assertThat(tree.get(0).path("branchId").asText()).isEqualTo(TestFixtures.mainBranchId().toString());
        assertThat(tree.get(0).path("stationCodes").toString()).isEqualTo("[\"BAR\",\"PASS\"]");
        assertThat(tree.get(1).path("branchId").asText()).isEqualTo(TestFixtures.branch2Id().toString());
        assertThat(tree.get(1).path("stationCodes").toString()).isEqualTo("[\"GRILL\"]");
    }

    @Test
    void assigningOverHttpThenLoggingIn_yieldsATokenCarryingExactlyThoseCodes() throws Exception {
        putStations(TestFixtures.mainBranchId(), List.of("PASS", "BAR"));

        assertThat(stationsIn(loginAsTheCook())).containsExactly("BAR", "PASS");
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private void putStations(UUID branchId, List<String> codes) {
        var response = putStationsRaw(COOK_ID, branchId, codes);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    private org.springframework.http.ResponseEntity<String> putStationsRaw(
            UUID userId, UUID branchId, List<String> codes) {
        return rest.put()
            .uri("/internal/auth/users/" + userId + "/stations")
            .header(INTERNAL_HEADER, INTERNAL_SECRET)
            .header("X-Tenant-Id", TestFixtures.demoTenantId().toString())
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("branchId", branchId.toString(), "stationCodes", codes))
            .exchange((req, res) -> {
                byte[] bytes = res.getBody() != null ? res.getBody().readAllBytes() : new byte[0];
                return org.springframework.http.ResponseEntity.status(res.getStatusCode())
                    .body(new String(bytes, java.nio.charset.StandardCharsets.UTF_8));
            });
    }

    private List<String> activeCodesAtMainBranch() {
        return inTenantTx(() -> stationAssignmentRepository
            .findByTenantIdAndUserIdAndBranchIdAndActiveTrue(
                TestFixtures.demoTenantId(), COOK_ID, TestFixtures.mainBranchId())
            .stream()
            .map(UserStationAssignmentEntity::getStationCode)
            .sorted()
            .toList());
    }


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
            row.setUserId(COOK_ID);
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
            .body(TestFixtures.loginBody(COOK_EMAIL, COOK_PASSWORD, TestFixtures.DEMO_SLUG))
            .retrieve()
            .toEntity(String.class);
        assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);
        return login;
    }

    private String loginAsTheCook() {
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
