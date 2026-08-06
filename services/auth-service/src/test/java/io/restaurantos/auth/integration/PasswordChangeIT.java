package io.restaurantos.auth.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.auth.entity.PasswordHistoryEntity;
import io.restaurantos.auth.entity.RefreshSessionEntity;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.repository.PasswordHistoryRepository;
import io.restaurantos.auth.repository.RefreshSessionRepository;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Self-service change-password (D-15), end to end over HTTP.
 *
 * <p>The audit found this endpoint did not exist anywhere in the repository, so every assertion
 * here is about a behaviour that has never run. Three of them are about what the endpoint must
 * <i>not</i> do, and those are the ones worth reading:
 *
 * <ul>
 *   <li>a wrong current password must be indistinguishable from a login failure — asserted by
 *       comparing the two response bodies field by field, not by asserting a status;</li>
 *   <li>a user id in the request body must be inert — a change-password endpoint that accepts a
 *       target is a horizontal-privilege-escalation endpoint, and "the DTO has no such field" is
 *       a claim that should be tested rather than inspected;</li>
 *   <li>no password value may reach an event payload — asserted by scanning every outbox row the
 *       request produced for the literal strings, because "we did not put it there" is exactly
 *       the kind of thing that stops being true later.</li>
 * </ul>
 *
 * <p>Uses the MANAGER persona rather than the CASHIER the other auth ITs share, so a test that
 * deliberately invalidates a password cannot make a neighbouring class fail depending on ordering.
 * MANAGER holds none of {@code rbac.manage}, {@code finance.period.close},
 * {@code hr.payroll.approve}, so login does not demand TOTP step-up.
 */
class PasswordChangeIT extends BaseIntegrationTest {

    private static final String CHANGE_PASSWORD = "/api/v1/auth/change-password";

    /** Compliant under the shared strength rule: 12 chars, all four character classes. */
    private static final String NEW_PASSWORD = "Zx9!qwrtBn4%";
    private static final String OTHER_COMPLIANT_PASSWORD = "Vk4^mtzqLp8@";
    /** Fails the strength rule on length and on three character classes. */
    private static final String WEAK_PASSWORD = "qqqqqqq";

    @Autowired private PasswordHistoryRepository passwordHistoryRepository;
    @Autowired private RefreshSessionRepository refreshSessionRepository;
    @Autowired private PasswordEncoder passwordEncoder;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @BeforeEach
    void restoreManagerToAKnownState() {
        setRls(TestFixtures.demoTenantId());
        UserEntity manager = userRepository.findByEmail(TestFixtures.MANAGER_EMAIL).orElseThrow();
        manager.setPasswordHash(passwordEncoder.encode(TestFixtures.MANAGER_PASSWORD));
        manager.setMustChangePassword(false);
        manager.setFailedLoginCount(0);
        manager.setLockedUntil(null);
        userRepository.save(manager);
        // History is what the reuse rule reads; leaving rows from a previous test would make
        // "rejected as reuse" pass for the wrong reason.
        passwordHistoryRepository.deleteAll(
            passwordHistoryRepository.findTop5ByUserIdOrderByCreatedAtDesc(manager.getId()));
    }

    // ------------------------------------------------------------------------------ behaviour 1

    @Test
    void correctCurrentPassword_changesIt_andOnlyTheNewPasswordAuthenticatesAfterwards() throws Exception {
        String token = login(TestFixtures.MANAGER_PASSWORD);

        ResponseEntity<String> change = postChange(token, body(TestFixtures.MANAGER_PASSWORD, NEW_PASSWORD));
        assertThat(change.getStatusCode()).isEqualTo(HttpStatus.OK);

        assertThat(loginStatus(TestFixtures.MANAGER_PASSWORD)).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(loginStatus(NEW_PASSWORD)).isEqualTo(HttpStatus.OK);
    }

    // ------------------------------------------------------------------------------ behaviour 2

    @Test
    void wrongCurrentPassword_returns401_withABodyIdenticalToAnyOtherAuthenticationFailure()
            throws Exception {
        String token = login(TestFixtures.MANAGER_PASSWORD);

        ResponseEntity<String> change = postChange(token, body("Nope#NotMine1", NEW_PASSWORD));
        assertThat(change.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

        ResponseEntity<String> failedLogin = exchangePost("/api/v1/auth/login",
            TestFixtures.loginBody(TestFixtures.MANAGER_EMAIL, "Nope#NotMine1", TestFixtures.DEMO_SLUG));
        assertThat(failedLogin.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);

        // traceId is per-request by design; everything else must match, including the message.
        assertThat(errorWithoutTraceId(change)).isEqualTo(errorWithoutTraceId(failedLogin));

        // And the password must still be the old one — a rejected attempt must not half-apply.
        assertThat(loginStatus(TestFixtures.MANAGER_PASSWORD)).isEqualTo(HttpStatus.OK);
    }

    @Test
    void wrongCurrentPassword_doesNotDiscloseWhetherTheAccountExists() throws Exception {
        String token = login(TestFixtures.MANAGER_PASSWORD);
        ResponseEntity<String> wrongPassword = postChange(token, body("Nope#NotMine1", NEW_PASSWORD));

        ResponseEntity<String> unknownAccount = exchangePost("/api/v1/auth/login",
            TestFixtures.loginBody("nobody@demo.local", "Nope#NotMine1", TestFixtures.DEMO_SLUG));

        assertThat(errorWithoutTraceId(wrongPassword)).isEqualTo(errorWithoutTraceId(unknownAccount));
    }

    // ------------------------------------------------------------------------------ behaviour 3

    @Test
    void aNewPasswordEqualToTheCurrentOne_isRejectedAsReuse() throws Exception {
        String token = login(TestFixtures.MANAGER_PASSWORD);

        ResponseEntity<String> change =
            postChange(token, body(TestFixtures.MANAGER_PASSWORD, TestFixtures.MANAGER_PASSWORD));

        assertThat(change.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(errorCode(change)).isEqualTo("PASSWORD_REUSE");
    }

    // ------------------------------------------------------------------------------ behaviour 4

    @Test
    void aNewPasswordMatchingAnyOfTheLastFiveHistoryEntries_isRejectedAsReuse() throws Exception {
        seedHistory("Hist#Aaaa111", "Hist#Bbbb222", "Hist#Cccc333", "Hist#Dddd444", NEW_PASSWORD);

        String token = login(TestFixtures.MANAGER_PASSWORD);
        ResponseEntity<String> change = postChange(token, body(TestFixtures.MANAGER_PASSWORD, NEW_PASSWORD));

        assertThat(change.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(errorCode(change)).isEqualTo("PASSWORD_REUSE");

        // The rule is "the last five", not "everything ever": a sixth, older entry must not block.
        seedHistory("Older#Push111", "Older#Push222", "Older#Push333",
            "Older#Push444", "Older#Push555");
        ResponseEntity<String> nowAllowed =
            postChange(login(TestFixtures.MANAGER_PASSWORD), body(TestFixtures.MANAGER_PASSWORD, NEW_PASSWORD));
        assertThat(nowAllowed.getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    // ------------------------------------------------------------------------------ behaviour 5

    @Test
    void aWeakNewPassword_returns400_beforeTheCurrentPasswordIsEvenChecked() throws Exception {
        String token = login(TestFixtures.MANAGER_PASSWORD);

        // Both fields are wrong. If validation runs first this is a 400; if the password
        // comparison runs first it is a 401. That difference is the whole assertion.
        ResponseEntity<String> change = postChange(token, body("AlsoWrong#111", WEAK_PASSWORD));

        assertThat(change.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(errorCode(change)).isEqualTo("VALIDATION_FAILED");

        JsonNode details = objectMapper.readTree(change.getBody()).path("error").path("details");
        assertThat(details.toString()).contains("newPassword").contains("must contain");
        // The strength complaint must not carry the value the caller submitted, nor the current
        // password they got wrong.
        assertThat(change.getBody()).doesNotContain(WEAK_PASSWORD).doesNotContain("AlsoWrong");
    }

    // ------------------------------------------------------------------------------ behaviour 6

    @Test
    void aSuccessfulChange_appendsHistory_revokesSessions_andClearsForcedChangeAndLockout()
            throws Exception {
        setRls(TestFixtures.demoTenantId());
        UserEntity before = userRepository.findByEmail(TestFixtures.MANAGER_EMAIL).orElseThrow();
        before.setMustChangePassword(true);
        before.setFailedLoginCount(3);
        before.setLockedUntil(Instant.now().plusSeconds(600));
        userRepository.save(before);
        String hashBeforeChange = before.getPasswordHash();

        // Two logins, so "revokes EVERY session" is distinguishable from "revokes the one used".
        String firstToken = login(TestFixtures.MANAGER_PASSWORD);
        login(TestFixtures.MANAGER_PASSWORD);
        setRls(TestFixtures.demoTenantId());
        assertThat(refreshSessionRepository.findByUserIdAndRevokedAtIsNull(before.getId()))
            .as("precondition: two live sessions").hasSizeGreaterThanOrEqualTo(2);

        assertThat(postChange(firstToken, body(TestFixtures.MANAGER_PASSWORD, NEW_PASSWORD))
            .getStatusCode()).isEqualTo(HttpStatus.OK);

        setRls(TestFixtures.demoTenantId());
        UserEntity after = userRepository.findByEmail(TestFixtures.MANAGER_EMAIL).orElseThrow();
        assertThat(after.isMustChangePassword()).isFalse();
        assertThat(after.getFailedLoginCount()).isZero();
        assertThat(after.getLockedUntil()).isNull();
        assertThat(after.getPasswordHash()).isNotEqualTo(hashBeforeChange);

        assertThat(passwordHistoryRepository.findTop5ByUserIdOrderByCreatedAtDesc(after.getId()))
            .as("the PREVIOUS hash is what gets appended, not the new one")
            .extracting(PasswordHistoryEntity::getPasswordHash)
            .contains(hashBeforeChange)
            .doesNotContain(after.getPasswordHash());

        assertThat(refreshSessionRepository.findByUserIdAndRevokedAtIsNull(after.getId()))
            .as("every refresh session for the user is revoked, not merely the calling one")
            .isEmpty();
        assertThat(refreshSessionRepository.findAll())
            .filteredOn(s -> s.getUserId().equals(after.getId()))
            .allSatisfy(s -> assertThat(s.getRevokedAt()).isNotNull());
    }

    @Test
    void aSuccessfulChangeDoesNotRevokeAnotherUsersSessions() throws Exception {
        String cashierToken = login(TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD);
        assertThat(cashierToken).isNotBlank();

        assertThat(postChange(login(TestFixtures.MANAGER_PASSWORD),
            body(TestFixtures.MANAGER_PASSWORD, NEW_PASSWORD)).getStatusCode()).isEqualTo(HttpStatus.OK);

        setRls(TestFixtures.demoTenantId());
        assertThat(refreshSessionRepository.findByUserIdAndRevokedAtIsNull(TestFixtures.cashierUserId()))
            .isNotEmpty();
    }

    // ------------------------------------------------------------------------------ behaviour 7

    @Test
    void withoutABearerToken_theEndpointReturns401FromTheServicesOwnSecurityChain() {
        ResponseEntity<String> change = postChange(null, body(TestFixtures.MANAGER_PASSWORD, NEW_PASSWORD));

        assertThat(change.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(loginStatus(TestFixtures.MANAGER_PASSWORD)).isEqualTo(HttpStatus.OK);
    }

    @Test
    void withAGarbageBearerToken_theEndpointReturns401() {
        ResponseEntity<String> change =
            postChange("not.a.jwt", body(TestFixtures.MANAGER_PASSWORD, NEW_PASSWORD));

        assertThat(change.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // ---------------------------------------------------------- T-13-04-A: no target selection

    @Test
    void aUserIdInTheRequestBody_isInert_andTheCallersOwnPasswordIsWhatChanges() throws Exception {
        String managerToken = login(TestFixtures.MANAGER_PASSWORD);

        setRls(TestFixtures.demoTenantId());
        String cashierHashBefore =
            userRepository.findByEmail(TestFixtures.CASHIER_EMAIL).orElseThrow().getPasswordHash();

        Map<String, Object> withTarget = new HashMap<>(body(TestFixtures.MANAGER_PASSWORD, NEW_PASSWORD));
        withTarget.put("userId", TestFixtures.cashierUserId().toString());
        withTarget.put("email", TestFixtures.CASHIER_EMAIL);

        assertThat(postChange(managerToken, withTarget).getStatusCode()).isEqualTo(HttpStatus.OK);

        setRls(TestFixtures.demoTenantId());
        assertThat(userRepository.findByEmail(TestFixtures.CASHIER_EMAIL).orElseThrow().getPasswordHash())
            .as("the named account must be untouched")
            .isEqualTo(cashierHashBefore);
        assertThat(loginStatus(NEW_PASSWORD))
            .as("the CALLER's password is what changed").isEqualTo(HttpStatus.OK);
    }

    // ------------------------------------------ T-13-04-D: no password material leaves the service

    @Test
    void noPasswordValueAppearsInAnyEventTheChangeEmits() throws Exception {
        String token = login(TestFixtures.MANAGER_PASSWORD);
        List<String> before = outboxEnvelopes();

        assertThat(postChange(token, body(TestFixtures.MANAGER_PASSWORD, NEW_PASSWORD))
            .getStatusCode()).isEqualTo(HttpStatus.OK);

        List<String> emitted = outboxEnvelopes();
        emitted.removeAll(before);
        assertThat(emitted).as("the change must be auditable at all").isNotEmpty();

        for (String envelope : emitted) {
            assertThat(envelope)
                .doesNotContain(NEW_PASSWORD)
                .doesNotContain(TestFixtures.MANAGER_PASSWORD)
                .doesNotContain("$2a$")   // no bcrypt hash either
                .doesNotContain("$2b$")
                .doesNotContain("$2y$");
        }
        assertThat(String.join("\n", emitted)).contains("PASSWORD_CHANGED");
    }

    @Test
    void theChangeEventCarriesTheUserAndTenantAndNothingElse() throws Exception {
        String token = login(TestFixtures.MANAGER_PASSWORD);
        List<String> before = outboxEnvelopes();

        postChange(token, body(TestFixtures.MANAGER_PASSWORD, NEW_PASSWORD));

        List<String> emitted = outboxEnvelopes();
        emitted.removeAll(before);
        String changeEvent = emitted.stream().filter(e -> e.contains("PASSWORD_CHANGED")).findFirst()
            .orElseThrow(() -> new AssertionError("no PASSWORD_CHANGED event was emitted"));

        JsonNode payload = objectMapper.readTree(changeEvent).path("payload");
        List<String> payloadFields = new java.util.ArrayList<>();
        payload.fieldNames().forEachRemaining(payloadFields::add);
        assertThat(payloadFields).containsExactlyInAnyOrder("userId", "tenantId");
        assertThat(payload.path("userId").asText()).isEqualTo(TestFixtures.MANAGER_USER_ID.toString());
        assertThat(payload.path("tenantId").asText()).isEqualTo(TestFixtures.DEMO_TENANT_ID.toString());
    }

    // ------------------------------------------- the reset path must survive the policy extraction

    @Test
    void theResetPathStillRejectsAWeakNewPassword() {
        ResponseEntity<String> confirm = exchangePost("/api/v1/auth/reset-password/confirm",
            Map.of("token", "irrelevant-the-body-never-gets-that-far", "newPassword", WEAK_PASSWORD));

        assertThat(confirm.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(errorCode(confirm)).isEqualTo("VALIDATION_FAILED");
    }

    // ---------------------------------------------------------------------------------- helpers

    private static Map<String, Object> body(String currentPassword, String newPassword) {
        return Map.of("currentPassword", currentPassword, "newPassword", newPassword);
    }

    private ResponseEntity<String> postChange(String bearerToken, Object body) {
        var spec = rest.post().uri(CHANGE_PASSWORD).contentType(MediaType.APPLICATION_JSON);
        if (bearerToken != null) {
            spec = spec.header("Authorization", "Bearer " + bearerToken);
        }
        return spec.body(body).exchange((request, response) -> {
            byte[] bytes = response.getBody() != null ? response.getBody().readAllBytes() : new byte[0];
            return ResponseEntity.status(response.getStatusCode())
                .body(new String(bytes, StandardCharsets.UTF_8));
        });
    }

    private String login(String password) throws Exception {
        return login(TestFixtures.MANAGER_EMAIL, password);
    }

    private String login(String email, String password) throws Exception {
        ResponseEntity<String> response = exchangePost("/api/v1/auth/login",
            TestFixtures.loginBody(email, password, TestFixtures.DEMO_SLUG));
        assertThat(response.getStatusCode()).as("login as %s", email).isEqualTo(HttpStatus.OK);
        return objectMapper.readTree(response.getBody()).path("data").path("accessToken").asText();
    }

    private HttpStatus loginStatus(String password) {
        return HttpStatus.valueOf(exchangePost("/api/v1/auth/login",
            TestFixtures.loginBody(TestFixtures.MANAGER_EMAIL, password, TestFixtures.DEMO_SLUG))
            .getStatusCode().value());
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

    private void seedHistory(String... passwords) {
        setRls(TestFixtures.demoTenantId());
        UserEntity manager = userRepository.findByEmail(TestFixtures.MANAGER_EMAIL).orElseThrow();
        for (String password : passwords) {
            PasswordHistoryEntity history = new PasswordHistoryEntity();
            history.setTenantId(manager.getTenantId());
            history.setUserId(manager.getId());
            history.setPasswordHash(passwordEncoder.encode(password));
            passwordHistoryRepository.saveAndFlush(history);
        }
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
