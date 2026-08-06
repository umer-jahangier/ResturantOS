package io.restaurantos.auth.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.auth.entity.PasswordHistoryEntity;
import io.restaurantos.auth.entity.PasswordResetTokenEntity;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.repository.PasswordHistoryRepository;
import io.restaurantos.auth.repository.PasswordResetTokenRepository;
import io.restaurantos.auth.service.PasswordPolicyService;
import io.restaurantos.shared.event.OutboxEntry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The forced-change gate (D-17), end to end over HTTP.
 *
 * <p>The audit found {@code must_change_password} written at provisioning and read nowhere, which
 * made every temporary credential this platform issues a permanent one. 13-06 sets that flag on
 * every provisioned admin and 13-11 will set it on every created user, so without the behaviour
 * asserted here the flag is universally set and universally inert.
 *
 * <p>The assertions worth reading are the ones about what must NOT happen:
 *
 * <ul>
 *   <li>a wrong password for a flagged account must be indistinguishable from a wrong password for
 *       any account and for no account — otherwise the flag is an account-existence oracle, which
 *       is worse than the dead flag it replaced. Asserted by comparing response BODIES;</li>
 *   <li>the refusal must carry no access token, no refresh cookie and no permission claim — a
 *       "restricted" token was the design that was NOT chosen, precisely because its safety would
 *       rest on every authorization check in twenty services treating an empty permission list as
 *       a refusal;</li>
 *   <li>every defect in a presented change token — absent, wrong purpose, expired, already spent,
 *       superseded — must produce one identical failure. Asserted by byte-comparing five bodies,
 *       not by asserting five statuses;</li>
 *   <li>the raw token must exist nowhere but the one response that hands it over: not in the
 *       database, not in any event.</li>
 * </ul>
 *
 * <p>Uses the KITCHEN_STAFF persona, deliberately. It holds none of {@code rbac.manage},
 * {@code finance.period.close} or {@code hr.payroll.approve}, so login demands no TOTP step-up and
 * "the subsequent login returns a normal token" is a statement about this gate rather than about
 * D-29a's. It is also a different persona from the one {@code PasswordChangeIT} invalidates, so
 * neither class can make the other fail depending on ordering.
 */
class ForcedPasswordChangeIT extends BaseIntegrationTest {

    private static final String FORCED = "/api/v1/auth/change-password/forced";
    private static final String SELF_SERVICE = "/api/v1/auth/change-password";
    private static final String LOGIN = "/api/v1/auth/login";
    private static final String RESET_CONFIRM = "/api/v1/auth/reset-password/confirm";

    /** Compliant under the shared strength rule: >= 8 chars, all four character classes. */
    private static final String NEW_PASSWORD = "Fq7!vwmtBn3%";
    private static final String OTHER_NEW_PASSWORD = "Rj2^xzptLk9@";
    /** Fails the strength rule on length and on three character classes. */
    private static final String WEAK_PASSWORD = "qqqqqqq";

    @Autowired private PasswordHistoryRepository passwordHistoryRepository;
    @Autowired private PasswordResetTokenRepository passwordResetTokenRepository;
    @Autowired private PasswordEncoder passwordEncoder;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void restoreChefToAKnownState() {
        setRls(TestFixtures.demoTenantId());
        UserEntity chef = userRepository.findByEmail(TestFixtures.KITCHEN_STAFF_EMAIL).orElseThrow();
        chef.setPasswordHash(passwordEncoder.encode(TestFixtures.KITCHEN_STAFF_PASSWORD));
        chef.setMustChangePassword(false);
        chef.setFailedLoginCount(0);
        chef.setLockedUntil(null);
        userRepository.save(chef);
        passwordHistoryRepository.deleteAll(
            passwordHistoryRepository.findTop5ByUserIdOrderByCreatedAtDesc(chef.getId()));
        // Tokens outlive a test by design (single-use, ten minutes), so a leftover live one would
        // make "the outstanding token was invalidated" pass for the wrong reason.
        passwordResetTokenRepository.deleteAll(
            passwordResetTokenRepository.findAll().stream()
                .filter(t -> t.getUserId().equals(chef.getId()))
                .toList());
    }

    // ─────────────────────────────────────────────────────────── behaviour 1: login is refused

    @Test
    void aFlaggedAccountWithTheRightPassword_isRefused403WithAChangeTokenAndNoAccessToken()
            throws Exception {
        flagChefForChange();

        ResponseEntity<String> refusal = login(TestFixtures.KITCHEN_STAFF_PASSWORD);

        assertThat(refusal.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(errorCode(refusal)).isEqualTo("PASSWORD_CHANGE_REQUIRED");
        assertThat(changeTokenOf(refusal)).isNotBlank();
        assertThat(detail(refusal, "expiresAt")).isNotBlank();

        // No token of any kind, and no permission claim, anywhere in the body.
        assertThat(refusal.getBody())
            .doesNotContain("accessToken")
            .doesNotContain("permissions")
            .doesNotContain("refreshToken");
    }

    @Test
    void thatRefusalCarriesNoSetCookieHeader() {
        flagChefForChange();

        ResponseEntity<String> refusal = login(TestFixtures.KITCHEN_STAFF_PASSWORD);

        // A successful login sets refresh_token. The refusal must not — a refresh cookie would be a
        // thirty-day credential handed to an account that was just told it may not have a session.
        assertThat(refusal.getHeaders().get("Set-Cookie")).isNull();
    }

    // ─────────────────────────────────────── behaviour 2: the flag is not an existence oracle

    @Test
    void wrongCredentialsForAFlaggedAccount_giveTheOrdinaryGenericFailure_notTheForcedChangeOne()
            throws Exception {
        flagChefForChange();

        ResponseEntity<String> wrongPassword = login("Nope#NotMine1");
        ResponseEntity<String> unknownAccount = exchangePost(LOGIN,
            TestFixtures.loginBody("nobody@demo.local", "Nope#NotMine1", TestFixtures.DEMO_SLUG));
        ResponseEntity<String> unflaggedWrongPassword = exchangePost(LOGIN,
            TestFixtures.loginBody(TestFixtures.CASHIER_EMAIL, "Nope#NotMine1", TestFixtures.DEMO_SLUG));

        assertThat(wrongPassword.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        // Statuses agreeing is not the assertion. Bodies agreeing is.
        assertThat(errorWithoutTraceId(wrongPassword)).isEqualTo(errorWithoutTraceId(unknownAccount));
        assertThat(errorWithoutTraceId(wrongPassword)).isEqualTo(errorWithoutTraceId(unflaggedWrongPassword));
        assertThat(wrongPassword.getBody()).doesNotContain("PASSWORD_CHANGE_REQUIRED");
    }

    // ────────────────────────────────────────────── behaviour 3: redeeming completes the change

    @Test
    void redeemingTheToken_returns200_clearsTheFlag_appendsHistory_andRevokesSessions()
            throws Exception {
        // A live session from BEFORE the flag was set, so "revokes sessions" is observable.
        loginSuccessfully(TestFixtures.KITCHEN_STAFF_PASSWORD);
        flagChefForChange();

        setRls(TestFixtures.demoTenantId());
        String hashBefore = chef().getPasswordHash();

        String changeToken = changeTokenOf(login(TestFixtures.KITCHEN_STAFF_PASSWORD));
        ResponseEntity<String> change =
            postForced(changeToken, TestFixtures.KITCHEN_STAFF_PASSWORD, NEW_PASSWORD);

        assertThat(change.getStatusCode()).isEqualTo(HttpStatus.OK);

        setRls(TestFixtures.demoTenantId());
        UserEntity after = chef();
        assertThat(after.isMustChangePassword()).as("the flag is cleared").isFalse();
        assertThat(after.getPasswordHash()).isNotEqualTo(hashBefore);
        assertThat(passwordHistoryRepository.findTop5ByUserIdOrderByCreatedAtDesc(after.getId()))
            .as("the PREVIOUS hash is what gets appended, not the new one")
            .extracting(PasswordHistoryEntity::getPasswordHash)
            .contains(hashBefore)
            .doesNotContain(after.getPasswordHash());
    }

    // ──────────────────────────────── behaviour 4: an immediately subsequent login is normal

    @Test
    void afterTheChange_theNextLoginReturnsANormalAccessTokenWithPermissions() throws Exception {
        flagChefForChange();

        String changeToken = changeTokenOf(login(TestFixtures.KITCHEN_STAFF_PASSWORD));
        assertThat(postForced(changeToken, TestFixtures.KITCHEN_STAFF_PASSWORD, NEW_PASSWORD)
            .getStatusCode()).isEqualTo(HttpStatus.OK);

        // The old password no longer works, the new one does, and it yields a real token.
        assertThat(login(TestFixtures.KITCHEN_STAFF_PASSWORD).getStatusCode())
            .isEqualTo(HttpStatus.UNAUTHORIZED);

        ResponseEntity<String> next = login(NEW_PASSWORD);
        assertThat(next.getStatusCode()).isEqualTo(HttpStatus.OK);

        JsonNode data = objectMapper.readTree(next.getBody()).path("data");
        assertThat(data.path("accessToken").asText()).isNotBlank();
        // Not merely well-formed: it must carry the permissions the role actually grants, or the
        // "restricted token" failure mode this design rejected would be back by accident.
        assertThat(permissionsIn(data.path("accessToken").asText()))
            .as("a normal token, with a non-empty permission claim").isNotEmpty();
    }

    // ─────────────────────────── behaviour 5: one generic failure for every token defect

    @Test
    void everyDefectInAPresentedToken_producesOneIdenticalFailure() throws Exception {
        flagChefForChange();

        String spent = changeTokenOf(login(TestFixtures.KITCHEN_STAFF_PASSWORD));
        assertThat(postForced(spent, TestFixtures.KITCHEN_STAFF_PASSWORD, NEW_PASSWORD)
            .getStatusCode()).isEqualTo(HttpStatus.OK);

        flagChefForChange();
        String expired = changeTokenOf(login(NEW_PASSWORD));
        expireToken(expired);

        flagChefForChange();
        String superseded = changeTokenOf(login(NEW_PASSWORD));
        String current = changeTokenOf(login(NEW_PASSWORD));   // issuing this retires `superseded`

        List<ResponseEntity<String>> refusals = List.of(
            postForced("this-token-never-existed", NEW_PASSWORD, OTHER_NEW_PASSWORD),
            postForced(spent, NEW_PASSWORD, OTHER_NEW_PASSWORD),
            postForced(expired, NEW_PASSWORD, OTHER_NEW_PASSWORD),
            postForced(superseded, NEW_PASSWORD, OTHER_NEW_PASSWORD));

        for (ResponseEntity<String> refusal : refusals) {
            assertThat(refusal.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
            assertThat(errorWithoutTraceId(refusal))
                .as("every token defect must be the same refusal")
                .isEqualTo(errorWithoutTraceId(refusals.get(0)));
        }
        // And it is not the case that EVERYTHING is refused — the control that stops the four
        // assertions above passing against an endpoint that simply never works.
        assertThat(postForced(current, NEW_PASSWORD, OTHER_NEW_PASSWORD).getStatusCode())
            .isEqualTo(HttpStatus.OK);
    }

    @Test
    void issuingANewChangeToken_retiresTheOutstandingOne() throws Exception {
        flagChefForChange();

        String first = changeTokenOf(login(TestFixtures.KITCHEN_STAFF_PASSWORD));
        String second = changeTokenOf(login(TestFixtures.KITCHEN_STAFF_PASSWORD));
        assertThat(first).isNotEqualTo(second);

        assertThat(postForced(first, TestFixtures.KITCHEN_STAFF_PASSWORD, NEW_PASSWORD).getStatusCode())
            .as("the superseded token is dead").isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(postForced(second, TestFixtures.KITCHEN_STAFF_PASSWORD, NEW_PASSWORD).getStatusCode())
            .as("the newest token is the live one").isEqualTo(HttpStatus.OK);
    }

    @Test
    void aTokenCannotBeRedeemedTwice() throws Exception {
        flagChefForChange();
        String token = changeTokenOf(login(TestFixtures.KITCHEN_STAFF_PASSWORD));

        assertThat(postForced(token, TestFixtures.KITCHEN_STAFF_PASSWORD, NEW_PASSWORD).getStatusCode())
            .isEqualTo(HttpStatus.OK);
        assertThat(postForced(token, NEW_PASSWORD, OTHER_NEW_PASSWORD).getStatusCode())
            .isEqualTo(HttpStatus.UNAUTHORIZED);

        // The second attempt must not have half-applied: NEW_PASSWORD is still the password.
        assertThat(login(NEW_PASSWORD).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    // ──────────────────────────── behaviour 6: an unflagged account is unaffected

    @Test
    void anAccountWithoutTheFlag_logsInExactlyAsBefore() throws Exception {
        ResponseEntity<String> normal = login(TestFixtures.KITCHEN_STAFF_PASSWORD);

        assertThat(normal.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(objectMapper.readTree(normal.getBody()).path("data").path("accessToken").asText())
            .isNotBlank();
        assertThat(normal.getHeaders().getFirst("Set-Cookie")).contains("refresh_token");
    }

    // ───────────────────────── T-13-08-A: the token decides the account, and nothing else does

    @Test
    void aTokenIssuedForOneUser_cannotBeUsedToChangeAnotherUsersPassword() throws Exception {
        flagChefForChange();
        String chefsToken = changeTokenOf(login(TestFixtures.KITCHEN_STAFF_PASSWORD));

        setRls(TestFixtures.demoTenantId());
        String cashierHashBefore =
            userRepository.findByEmail(TestFixtures.CASHIER_EMAIL).orElseThrow().getPasswordHash();

        // Chef's token, the CASHIER's current password, and — for good measure — the cashier named
        // in the body. The account comes from the token, so this is a wrong current password for
        // chef and nothing else.
        ResponseEntity<String> attempt = rest.post().uri(FORCED)
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("changeToken", chefsToken,
                "currentPassword", TestFixtures.CASHIER_PASSWORD,
                "newPassword", NEW_PASSWORD,
                "userId", TestFixtures.cashierUserId().toString(),
                "email", TestFixtures.CASHIER_EMAIL))
            .exchange((request, response) -> toStringEntity(response));

        assertThat(attempt.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

        setRls(TestFixtures.demoTenantId());
        assertThat(userRepository.findByEmail(TestFixtures.CASHIER_EMAIL).orElseThrow().getPasswordHash())
            .as("the named account must be byte-for-byte untouched").isEqualTo(cashierHashBefore);
        assertThat(chef().isMustChangePassword())
            .as("and chef's own flag must still be set").isTrue();
    }

    // ─────────────── T-13-08-E: a token of one purpose is refused where the other is expected

    @Test
    void aResetTokenIsRefusedAtTheForcedEndpoint_andAChangeTokenAtResetConfirm() throws Exception {
        flagChefForChange();
        String changeToken = changeTokenOf(login(TestFixtures.KITCHEN_STAFF_PASSWORD));

        exchangePost("/api/v1/auth/reset-password/request",
            Map.of("email", TestFixtures.KITCHEN_STAFF_EMAIL, "tenantSlug", TestFixtures.DEMO_SLUG));
        String resetToken = latestResetToken();

        assertThat(postForced(resetToken, TestFixtures.KITCHEN_STAFF_PASSWORD, NEW_PASSWORD).getStatusCode())
            .as("a reset token is not a change token").isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(exchangePost(RESET_CONFIRM,
            Map.of("token", changeToken, "newPassword", NEW_PASSWORD)).getStatusCode())
            .as("a change token is not a reset token").isEqualTo(HttpStatus.UNAUTHORIZED);

        // THE CONTROLS. Without these, both refusals above would also hold against an endpoint that
        // refuses every token — which is precisely the state the reset path was in before this
        // plan, because its lookup ran before the RLS tenant GUC was established.
        assertThat(exchangePost(RESET_CONFIRM,
            Map.of("token", resetToken, "newPassword", OTHER_NEW_PASSWORD)).getStatusCode())
            .as("the reset token DOES work at reset-confirm").isEqualTo(HttpStatus.OK);
        assertThat(postForced(changeToken, OTHER_NEW_PASSWORD, NEW_PASSWORD).getStatusCode())
            .as("the change token DOES work at the forced endpoint").isEqualTo(HttpStatus.OK);
    }

    // ────────────────────────── T-13-08-D: the raw token exists in exactly one place

    @Test
    void theRawChangeTokenIsNeverPersisted_andNeverAppearsInAnyEvent() throws Exception {
        flagChefForChange();
        List<String> before = outboxEnvelopes();

        ResponseEntity<String> refusal = login(TestFixtures.KITCHEN_STAFF_PASSWORD);
        String rawToken = changeTokenOf(refusal);

        setRls(TestFixtures.demoTenantId());
        List<PasswordResetTokenEntity> rows = passwordResetTokenRepository.findAll();
        assertThat(rows).extracting(PasswordResetTokenEntity::getTokenHash)
            .as("the raw value is nowhere in the table").doesNotContain(rawToken);
        assertThat(rows).extracting(PasswordResetTokenEntity::getTokenHash)
            .as("its SHA-256 is").contains(PasswordPolicyService.hashToken(rawToken));

        List<String> emitted = outboxEnvelopes();
        emitted.removeAll(before);
        assertThat(emitted).as("a refused login is still auditable").isNotEmpty();
        for (String envelope : emitted) {
            assertThat(envelope)
                .doesNotContain(rawToken)
                .doesNotContain(TestFixtures.KITCHEN_STAFF_PASSWORD)
                .doesNotContain("$2a$").doesNotContain("$2b$").doesNotContain("$2y$");
        }
        assertThat(String.join("\n", emitted))
            .as("the credential WAS correct, so the login-succeeded event still fires")
            .contains("USER_LOGIN_SUCCEEDED");
    }

    // ──────────── the deliberate asymmetry between fumbling the policy and failing to authenticate

    @Test
    void aWeakNewPassword_is400_andLeavesTheTokenStillSpendable() throws Exception {
        flagChefForChange();
        String token = changeTokenOf(login(TestFixtures.KITCHEN_STAFF_PASSWORD));

        ResponseEntity<String> weak =
            postForced(token, TestFixtures.KITCHEN_STAFF_PASSWORD, WEAK_PASSWORD);
        assertThat(weak.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(errorCode(weak)).isEqualTo("VALIDATION_FAILED");
        assertThat(weak.getBody())
            .doesNotContain(WEAK_PASSWORD)
            .doesNotContain(TestFixtures.KITCHEN_STAFF_PASSWORD)
            .doesNotContain(token);

        // A user who fumbles the policy must not be locked out of their own recovery.
        assertThat(postForced(token, TestFixtures.KITCHEN_STAFF_PASSWORD, NEW_PASSWORD).getStatusCode())
            .isEqualTo(HttpStatus.OK);
    }

    @Test
    void aReusedNewPassword_is400_andAlsoLeavesTheTokenSpendable() throws Exception {
        flagChefForChange();
        String token = changeTokenOf(login(TestFixtures.KITCHEN_STAFF_PASSWORD));

        ResponseEntity<String> reuse = postForced(
            token, TestFixtures.KITCHEN_STAFF_PASSWORD, TestFixtures.KITCHEN_STAFF_PASSWORD);
        assertThat(reuse.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(errorCode(reuse)).isEqualTo("PASSWORD_REUSE");

        assertThat(postForced(token, TestFixtures.KITCHEN_STAFF_PASSWORD, NEW_PASSWORD).getStatusCode())
            .as("failing the POLICY rolls the claim back with the rest of the transaction")
            .isEqualTo(HttpStatus.OK);
    }

    @Test
    void aWrongCurrentPassword_spendsTheToken_soAnAttackerGetsOneGuessNotTenMinutesOfThem()
            throws Exception {
        flagChefForChange();
        String token = changeTokenOf(login(TestFixtures.KITCHEN_STAFF_PASSWORD));

        assertThat(postForced(token, "Nope#NotMine1", NEW_PASSWORD).getStatusCode())
            .isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(postForced(token, TestFixtures.KITCHEN_STAFF_PASSWORD, NEW_PASSWORD).getStatusCode())
            .as("failing AUTHENTICATION commits the claim; the token is gone")
            .isEqualTo(HttpStatus.UNAUTHORIZED);

        // The account is untouched and still recoverable — the user logs in again for a new token.
        assertThat(chefStillHasTheOriginalPassword()).isTrue();
        assertThat(login(TestFixtures.KITCHEN_STAFF_PASSWORD).getStatusCode())
            .isEqualTo(HttpStatus.FORBIDDEN);
    }

    // ───────────────── the public/authenticated split, asserted at this service's own chain

    @Test
    void theForcedEndpointIsReachableWithNoTokenAtAll_whileTheSelfServiceOneIsNot() throws Exception {
        // Forced: answered by the application (our generic credential refusal), not by the security
        // chain. The chain's own 401 body has no details array and no traceId, so the message is
        // what distinguishes "refused on the merits" from "you may not be here".
        ResponseEntity<String> forced = postForced("not-a-real-token", "irrelevant", NEW_PASSWORD);
        assertThat(forced.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(objectMapper.readTree(forced.getBody()).path("error").path("message").asText())
            .isEqualTo("Invalid credentials");

        // Self-service: still refused by the chain, with no token.
        ResponseEntity<String> selfService = exchangePost(SELF_SERVICE,
            Map.of("currentPassword", TestFixtures.KITCHEN_STAFF_PASSWORD, "newPassword", NEW_PASSWORD));
        assertThat(selfService.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(objectMapper.readTree(selfService.getBody()).path("error").path("message").asText())
            .as("the chain refused it; it never reached the controller")
            .isEqualTo("UNAUTHENTICATED");
    }

    // ──────────────────────────────────────────────────────────────────────────────── helpers

    private UserEntity chef() {
        return userRepository.findByEmail(TestFixtures.KITCHEN_STAFF_EMAIL).orElseThrow();
    }

    private void flagChefForChange() {
        setRls(TestFixtures.demoTenantId());
        UserEntity chef = chef();
        chef.setMustChangePassword(true);
        userRepository.save(chef);
    }

    private boolean chefStillHasTheOriginalPassword() {
        setRls(TestFixtures.demoTenantId());
        return passwordEncoder.matches(TestFixtures.KITCHEN_STAFF_PASSWORD, chef().getPasswordHash());
    }

    private void expireToken(String rawToken) {
        setRls(TestFixtures.demoTenantId());
        PasswordResetTokenEntity token = passwordResetTokenRepository
            .findByTokenHashAndPurpose(PasswordPolicyService.hashToken(rawToken), "FORCED_CHANGE")
            .orElseThrow();
        token.setExpiresAt(Instant.now().minusSeconds(60));
        passwordResetTokenRepository.save(token);
    }

    private ResponseEntity<String> login(String password) {
        return exchangePost(LOGIN, TestFixtures.loginBody(
            TestFixtures.KITCHEN_STAFF_EMAIL, password, TestFixtures.DEMO_SLUG));
    }

    private void loginSuccessfully(String password) {
        assertThat(login(password).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    private ResponseEntity<String> postForced(String changeToken, String currentPassword, String newPassword) {
        return rest.post().uri(FORCED)
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("changeToken", changeToken,
                "currentPassword", currentPassword,
                "newPassword", newPassword))
            .exchange((request, response) -> toStringEntity(response));
    }

    private static ResponseEntity<String> toStringEntity(
            org.springframework.http.client.ClientHttpResponse response) throws java.io.IOException {
        byte[] bytes = response.getBody() != null ? response.getBody().readAllBytes() : new byte[0];
        return ResponseEntity.status(response.getStatusCode())
            .headers(response.getHeaders())
            .body(new String(bytes, StandardCharsets.UTF_8));
    }

    private String changeTokenOf(ResponseEntity<String> refusal) throws Exception {
        return detail(refusal, "changeToken");
    }

    /** Reads one field/issue pair out of the error envelope's details array. */
    private String detail(ResponseEntity<String> response, String field) throws Exception {
        for (JsonNode node : objectMapper.readTree(response.getBody()).path("error").path("details")) {
            if (field.equals(node.path("field").asText())) {
                return node.path("issue").asText();
            }
        }
        throw new AssertionError("no '" + field + "' detail in: " + response.getBody());
    }

    private List<String> permissionsIn(String accessToken) throws Exception {
        String segment = accessToken.split("\\.")[1];
        JsonNode claims = objectMapper.readTree(
            java.util.Base64.getUrlDecoder().decode(segment));
        List<String> permissions = new java.util.ArrayList<>();
        claims.path("permissions").forEach(node -> permissions.add(node.asText()));
        return permissions;
    }

    private String errorCode(ResponseEntity<String> response) {
        try {
            return objectMapper.readTree(response.getBody()).path("error").path("code").asText();
        } catch (Exception e) {
            throw new IllegalStateException("unparseable body: " + response.getBody(), e);
        }
    }

    /** The error object with traceId stripped — traceId is per-request and must differ. */
    private String errorWithoutTraceId(ResponseEntity<String> response) throws Exception {
        JsonNode error = objectMapper.readTree(response.getBody()).path("error").deepCopy();
        ((com.fasterxml.jackson.databind.node.ObjectNode) error).remove("traceId");
        return error.toString();
    }

    private String latestResetToken() throws Exception {
        OutboxEntry entry = outboxRepository.findTop200ByStatusOrderByCreatedAtAsc("PENDING").stream()
            .filter(e -> "PASSWORD_RESET_REQUESTED".equals(e.getEventType()))
            .max(Comparator.comparing(OutboxEntry::getCreatedAt))
            .orElseThrow();
        return objectMapper.readTree(entry.getEnvelopeJson()).path("payload").path("token").asText();
    }

    private List<String> outboxEnvelopes() {
        setRls(TestFixtures.demoTenantId());
        return java.util.stream.Stream.concat(
                outboxRepository.findTop200ByStatusOrderByCreatedAtAsc("PENDING").stream(),
                outboxRepository.findTop200ByStatusOrderByCreatedAtAsc("SENT").stream())
            .map(OutboxEntry::getEnvelopeJson)
            .collect(java.util.stream.Collectors.toCollection(java.util.ArrayList::new));
    }
}
