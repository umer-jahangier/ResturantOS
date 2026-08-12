package io.restaurantos.auth.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.jwk.JWKSet;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.restaurantos.auth.entity.RefreshSessionEntity;
import io.restaurantos.auth.entity.UserBranchRoleEntity;
import io.restaurantos.auth.repository.RefreshSessionRepository;
import io.restaurantos.auth.repository.UserBranchRoleRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class BranchSwitchIT extends BaseIntegrationTest {

    @Autowired private UserBranchRoleRepository userBranchRoleRepository;
    @Autowired private RefreshSessionRepository refreshSessionRepository;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void ensureCashierOnBranchTwo() {
        setRls(TestFixtures.demoTenantId());
        if (userBranchRoleRepository.findByUserIdAndBranchIdAndActiveTrue(
                TestFixtures.cashierUserId(), TestFixtures.branch2Id()).isEmpty()) {
            UserBranchRoleEntity assignment = new UserBranchRoleEntity();
            // A row id this class OWNS. It used to be d0000006, which is not free: the seed gives
            // that id to c0000004's FINANCE_VIEWER role at the MAIN branch (changeset
            // 903-seed-auth-dev-data). save() on a hand-stamped id is a MERGE, not an insert, so
            // this block quietly rewrote that seeded row into "the cashier, at branch two" and left
            // the accountant with no role at the main branch.
            //
            // It has been dormant, and only by luck: StationAssignmentClaimIT ran earlier and
            // created the cashier's branch-two role (by committing the same crime against
            // d0000007, the chef's role — that one was NOT dormant and caused five of the six
            // order-dependent failures). With that satisfied, the isEmpty() guard above skipped
            // this branch. Giving StationAssignmentClaimIT its own user removes that accident and
            // would have armed this one on the very next run.
            assignment.setId(UUID.fromString("d0000053-0000-4000-8000-000000000053"));
            assignment.setTenantId(TestFixtures.demoTenantId());
            assignment.setUserId(TestFixtures.cashierUserId());
            assignment.setBranchId(TestFixtures.branch2Id());
            assignment.setRoleCode("CASHIER");
            assignment.setApprovalLimitPaisa(5_000_000L);
            assignment.setActive(true);
            userBranchRoleRepository.save(assignment);
        }
    }

    @Test
    void switchBranch_reissuesJwtAndKeepsRefreshSession() throws Exception {
        var login = rest.post()
            .uri("/api/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .body(TestFixtures.loginBody(
                TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, TestFixtures.DEMO_SLUG))
            .retrieve()
            .toEntity(String.class);
        assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);

        String accessToken = objectMapper.readTree(login.getBody()).path("data").path("accessToken").asText();
        String refreshCookie = login.getHeaders().get("Set-Cookie").getFirst();
        Claims initialClaims = parseJwt(accessToken);
        assertThat(initialClaims.get("branch_id", String.class))
            .isEqualTo(TestFixtures.mainBranchId().toString());

        var switched = rest.post()
            .uri("/api/v1/auth/switch-branch")
            .header("Authorization", "Bearer " + accessToken)
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("branchId", TestFixtures.branch2Id().toString()))
            .retrieve()
            .toEntity(String.class);
        assertThat(switched.getStatusCode()).isEqualTo(HttpStatus.OK);

        String newAccessToken = objectMapper.readTree(switched.getBody()).path("data").path("accessToken").asText();
        Claims newClaims = parseJwt(newAccessToken);
        assertThat(newClaims.get("branch_id", String.class))
            .isEqualTo(TestFixtures.branch2Id().toString());

        var refresh = rest.post()
            .uri("/api/v1/auth/refresh")
            .header("Cookie", refreshCookie.substring(0, refreshCookie.indexOf(';')))
            .retrieve()
            .toEntity(String.class);
        assertThat(refresh.getStatusCode()).isEqualTo(HttpStatus.OK);

        setRls(TestFixtures.demoTenantId());
        String tokenHash = sha256Hex(extractCookieValue(refreshCookie));
        RefreshSessionEntity session = refreshSessionRepository.findByTokenHash(tokenHash).orElseThrow();
        assertThat(session.getRevokedAt()).isNull();
    }

    /**
     * S1-16: the switched branch must survive a page reload.
     *
     * <h3>What this test does that {@link #switchBranch_reissuesJwtAndKeepsRefreshSession} did not</h3>
     *
     * <p>That test switches, refreshes, and then asserts only that the refresh session is still
     * alive. It never looks at the branch on the token the refresh returned — which was the login
     * branch — so it stayed green for the entire life of the defect. This one asserts the thing a
     * manager actually experiences: reload, and still be on the branch you chose.
     *
     * <p>It also sends the {@code refresh_token} cookie ON THE SWITCH, which is what a browser does
     * (the cookie's {@code Path=/api/v1/auth} covers {@code /api/v1/auth/switch-branch}) and what
     * the old test omitted. Sending it is the difference between exercising the SPA's path and
     * exercising a path no user is on.
     *
     * <p>Three separate assertions, because any one of them alone can pass while the feature is
     * broken: the stored session row moved; the token minted by a refresh carries the new branch;
     * and switching BACK survives too (a fix that only ever wrote "not the login branch" would fail
     * the last one).
     */
    @Test
    void switchedBranchSurvivesRefresh_andSoDoesSwitchingBack() throws Exception {
        var login = rest.post()
            .uri("/api/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .body(TestFixtures.loginBody(
                TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, TestFixtures.DEMO_SLUG))
            .retrieve()
            .toEntity(String.class);
        assertThat(login.getStatusCode()).isEqualTo(HttpStatus.OK);

        String accessToken = objectMapper.readTree(login.getBody()).path("data").path("accessToken").asText();
        String setCookie = login.getHeaders().get("Set-Cookie").getFirst();
        String cookieHeader = setCookie.substring(0, setCookie.indexOf(';'));
        String tokenHash = sha256Hex(extractCookieValue(setCookie));

        assertThat(parseJwt(accessToken).get("branch_id", String.class))
            .isEqualTo(TestFixtures.mainBranchId().toString());

        // --- switch to branch 2, exactly as the browser does: bearer AND refresh cookie ---
        String switchedToken = switchBranch(accessToken, cookieHeader, TestFixtures.branch2Id());
        assertThat(parseJwt(switchedToken).get("branch_id", String.class))
            .isEqualTo(TestFixtures.branch2Id().toString());

        setRls(TestFixtures.demoTenantId());
        RefreshSessionEntity moved = refreshSessionRepository.findByTokenHash(tokenHash).orElseThrow();
        assertThat(moved.getBranchId())
            .as("the refresh session is the only record of the active branch a reload can read")
            .isEqualTo(TestFixtures.branch2Id());
        assertThat(moved.getRevokedAt())
            .as("persisting the branch must not cost the session its life")
            .isNull();

        // --- the reload: a new access token derived from the cookie alone ---
        String afterReload = refreshWithCookie(cookieHeader);
        assertThat(parseJwt(afterReload).get("branch_id", String.class))
            .as("F5 must not put the manager back on the branch they logged in on")
            .isEqualTo(TestFixtures.branch2Id().toString());

        // --- and switching BACK must survive a reload just as well ---
        String backToken = switchBranch(afterReload, cookieHeader, TestFixtures.mainBranchId());
        assertThat(parseJwt(backToken).get("branch_id", String.class))
            .isEqualTo(TestFixtures.mainBranchId().toString());

        String afterSecondReload = refreshWithCookie(cookieHeader);
        assertThat(parseJwt(afterSecondReload).get("branch_id", String.class))
            .as("switching back is a switch too")
            .isEqualTo(TestFixtures.mainBranchId().toString());
    }

    /**
     * A denied switch must leave the session where it was.
     *
     * <p>The persistence write sits after the assignment check, so this can only regress by someone
     * moving it — which is precisely the mistake that would turn "you may not work on that branch"
     * into "you now work on that branch after a reload".
     */
    @Test
    void deniedSwitchDoesNotMoveTheSession() throws Exception {
        var login = rest.post()
            .uri("/api/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .body(TestFixtures.loginBody(
                TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, TestFixtures.DEMO_SLUG))
            .retrieve()
            .toEntity(String.class);
        String accessToken = objectMapper.readTree(login.getBody()).path("data").path("accessToken").asText();
        String setCookie = login.getHeaders().get("Set-Cookie").getFirst();
        String cookieHeader = setCookie.substring(0, setCookie.indexOf(';'));
        String tokenHash = sha256Hex(extractCookieValue(setCookie));

        UUID unassignedBranch = UUID.fromString("b0000003-0000-4000-8000-000000000003");
        var denied = rest.post()
            .uri("/api/v1/auth/switch-branch")
            .header("Authorization", "Bearer " + accessToken)
            .header("Cookie", cookieHeader)
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("branchId", unassignedBranch.toString()))
            .exchange((request, httpResponse) -> httpResponse.getStatusCode());
        assertThat(denied).isEqualTo(HttpStatus.FORBIDDEN);

        setRls(TestFixtures.demoTenantId());
        RefreshSessionEntity session = refreshSessionRepository.findByTokenHash(tokenHash).orElseThrow();
        assertThat(session.getBranchId()).isEqualTo(TestFixtures.mainBranchId());

        String afterReload = refreshWithCookie(cookieHeader);
        assertThat(parseJwt(afterReload).get("branch_id", String.class))
            .isEqualTo(TestFixtures.mainBranchId().toString());
    }

    /**
     * A session parked on a branch whose assignment is later revoked must be refused, not explode.
     *
     * <h3>Why this test exists at all</h3>
     *
     * <p>Persisting the switched branch means a refresh session can now point somewhere other than
     * the login branch, so "the active branch was revoked underneath me" became reachable by a
     * second route. Measured against the live stack before the fix: grant a second branch, switch
     * to it, revoke it, reload → {@code 500 INTERNAL_ERROR} on {@code POST /auth/refresh}, i.e. on
     * every page load. {@code PermissionResolver.resolveAtBranch} throws {@link
     * IllegalStateException} for an unassigned branch, and nothing on the refresh path caught it.
     *
     * <p>401 is the honest answer and the one every client already handles. The test asserts it is
     * NOT 500 as well as being 401, because "some 4xx/5xx came back" is the assertion that would
     * have let the original behaviour through.
     */
    @Test
    void refreshIsRefused_notCrashed_whenTheSessionsBranchIsNoLongerAssigned() throws Exception {
        var login = rest.post()
            .uri("/api/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .body(TestFixtures.loginBody(
                TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, TestFixtures.DEMO_SLUG))
            .retrieve()
            .toEntity(String.class);
        String accessToken = objectMapper.readTree(login.getBody()).path("data").path("accessToken").asText();
        String setCookie = login.getHeaders().get("Set-Cookie").getFirst();
        String cookieHeader = setCookie.substring(0, setCookie.indexOf(';'));

        switchBranch(accessToken, cookieHeader, TestFixtures.branch2Id());

        // Revoke the assignment the session is now parked on.
        setRls(TestFixtures.demoTenantId());
        UserBranchRoleEntity assignment = userBranchRoleRepository
            .findByUserIdAndBranchIdAndActiveTrue(TestFixtures.cashierUserId(), TestFixtures.branch2Id())
            .getFirst();
        assignment.setActive(false);
        userBranchRoleRepository.saveAndFlush(assignment);
        try {
            var status = rest.post()
                .uri("/api/v1/auth/refresh")
                .header("Cookie", cookieHeader)
                .exchange((request, httpResponse) -> httpResponse.getStatusCode());
            assertThat(status)
                .as("a revoked branch is an authentication outcome, never an internal error")
                .isNotEqualTo(HttpStatus.INTERNAL_SERVER_ERROR)
                .isEqualTo(HttpStatus.UNAUTHORIZED);
        } finally {
            // @BeforeEach only recreates the row when none is ACTIVE; reactivate explicitly so the
            // next test in this class does not inherit a revoked cashier.
            assignment.setActive(true);
            userBranchRoleRepository.saveAndFlush(assignment);
        }
    }

    private String switchBranch(String accessToken, String cookieHeader, UUID branchId) throws Exception {
        var response = rest.post()
            .uri("/api/v1/auth/switch-branch")
            .header("Authorization", "Bearer " + accessToken)
            .header("Cookie", cookieHeader)
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("branchId", branchId.toString()))
            .retrieve()
            .toEntity(String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        return objectMapper.readTree(response.getBody()).path("data").path("accessToken").asText();
    }

    /** What the SPA's bootstrap does on every full page load: exchange the cookie for a token. */
    private String refreshWithCookie(String cookieHeader) throws Exception {
        var response = rest.post()
            .uri("/api/v1/auth/refresh")
            .header("Cookie", cookieHeader)
            .retrieve()
            .toEntity(String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        return objectMapper.readTree(response.getBody()).path("data").path("accessToken").asText();
    }

    @Test
    void switchBranch_unassignedBranchReturns403() throws Exception {
        var login = rest.post()
            .uri("/api/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .body(TestFixtures.loginBody(
                TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, TestFixtures.DEMO_SLUG))
            .retrieve()
            .toEntity(String.class);
        String accessToken = objectMapper.readTree(login.getBody()).path("data").path("accessToken").asText();

        UUID unassignedBranch = UUID.fromString("b0000003-0000-4000-8000-000000000003");
        var response = rest.post()
            .uri("/api/v1/auth/switch-branch")
            .header("Authorization", "Bearer " + accessToken)
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("branchId", unassignedBranch.toString()))
            .exchange((request, httpResponse) -> {
                byte[] bytes = httpResponse.getBody() != null ? httpResponse.getBody().readAllBytes() : new byte[0];
                return org.springframework.http.ResponseEntity.status(httpResponse.getStatusCode())
                    .body(new String(bytes, StandardCharsets.UTF_8));
            });
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    /**
     * A DEACTIVATED branch is not somewhere you may go, even though your role there is untouched.
     *
     * <h3>The defect</h3>
     *
     * <p>{@code switchBranch} gated on
     * {@code userBranchRoleRepository.findByUserIdAndBranchIdAndActiveTrue} and stopped. That
     * column is the ROLE row being live. Deactivating a branch sets {@code branches.is_active} in
     * user-service's database and deliberately leaves every {@code user_branch_roles} row alone, so
     * reactivating a branch restores everyone's access rather than requiring it to be granted
     * again — which meant the assignment stayed "active" for a branch that no longer existed as a
     * workplace, and this endpoint minted a token for it on request.
     *
     * <p>Measured against the running fleet on 2026-08-12 as {@code owner@terrace.local}, before
     * the check existed: deactivate branch {@code f6fe89db-…}, then
     * {@code POST /api/v1/auth/switch-branch} with its id → <b>HTTP 200</b>, and the returned JWT's
     * {@code branch_id} was the dead branch.
     *
     * <h3>Why this test can fail</h3>
     *
     * <p>{@link #switchBranch_reissuesJwtAndKeepsRefreshSession} is its control: it performs the
     * SAME switch, to the SAME branch, for the SAME user, under the base class's default of "every
     * branch is active", and asserts 200 with the new branch on the token. So a refusal here cannot
     * be explained by the user, the branch, the fixture or the endpoint — only by the one stubbed
     * fact this test changes. The assertion is on the CODE and not just the status, because
     * {@code switchBranch_unassignedBranchReturns403} already produces a 403 from this endpoint and
     * a status-only assertion could not tell the two refusals apart.
     */
    @Test
    void switchBranch_deactivatedBranchIsRefusedWithItsOwnCode() throws Exception {
        var login = rest.post()
            .uri("/api/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .body(TestFixtures.loginBody(
                TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, TestFixtures.DEMO_SLUG))
            .retrieve()
            .toEntity(String.class);
        String accessToken = objectMapper.readTree(login.getBody()).path("data").path("accessToken").asText();

        // The one fact this test changes: user-service says branch 2 has been deactivated.
        org.mockito.Mockito.when(branchLivenessClient.isLiveAndActive(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.eq(TestFixtures.branch2Id())))
            .thenReturn(false);

        var response = rest.post()
            .uri("/api/v1/auth/switch-branch")
            .header("Authorization", "Bearer " + accessToken)
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("branchId", TestFixtures.branch2Id().toString()))
            .exchange((request, httpResponse) -> {
                byte[] bytes = httpResponse.getBody() != null ? httpResponse.getBody().readAllBytes() : new byte[0];
                return org.springframework.http.ResponseEntity.status(httpResponse.getStatusCode())
                    .body(new String(bytes, StandardCharsets.UTF_8));
            });

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        JsonNode error = objectMapper.readTree(response.getBody()).path("error");
        assertThat(error.path("code").asText()).isEqualTo("BRANCH_DEACTIVATED");
        assertThat(error.path("message").asText()).contains("deactivated");
    }

    /**
     * FAIL CLOSED: a branch whose state cannot be established is not switched to.
     *
     * <p>{@code BranchLivenessClient} converts every transport failure into {@code false} rather
     * than propagating, so this test stubs the same {@code false} the outage path produces. It
     * exists to make the DIRECTION of that decision breakable: a future "robustness" change that
     * allows the switch when the lookup fails has to delete this assertion to go green.
     */
    @Test
    void switchBranch_isRefusedWhenBranchStateCannotBeEstablished() throws Exception {
        var login = rest.post()
            .uri("/api/v1/auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .body(TestFixtures.loginBody(
                TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, TestFixtures.DEMO_SLUG))
            .retrieve()
            .toEntity(String.class);
        String accessToken = objectMapper.readTree(login.getBody()).path("data").path("accessToken").asText();

        org.mockito.Mockito.when(branchLivenessClient.isLiveAndActive(
                org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any()))
            .thenReturn(false);

        var response = rest.post()
            .uri("/api/v1/auth/switch-branch")
            .header("Authorization", "Bearer " + accessToken)
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("branchId", TestFixtures.branch2Id().toString()))
            .exchange((request, httpResponse) -> {
                byte[] bytes = httpResponse.getBody() != null ? httpResponse.getBody().readAllBytes() : new byte[0];
                return org.springframework.http.ResponseEntity.status(httpResponse.getStatusCode())
                    .body(new String(bytes, StandardCharsets.UTF_8));
            });

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    private Claims parseJwt(String accessToken) throws Exception {
        String jwksBody = rest.get().uri("/.well-known/jwks.json").retrieve().body(String.class);
        JWKSet jwkSet = JWKSet.parse(jwksBody);
        PublicKey publicKey = jwkSet.getKeys().getFirst().toRSAKey().toPublicKey();
        return Jwts.parser().verifyWith(publicKey).build()
            .parseSignedClaims(accessToken).getPayload();
    }

    private static String extractCookieValue(String cookieHeader) {
        int start = cookieHeader.indexOf('=') + 1;
        int end = cookieHeader.indexOf(';');
        return end > start ? cookieHeader.substring(start, end) : cookieHeader.substring(start);
    }

    private static String sha256Hex(String raw) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                .digest(raw.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
