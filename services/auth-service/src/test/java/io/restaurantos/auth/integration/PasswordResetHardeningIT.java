package io.restaurantos.auth.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.auth.entity.PasswordResetTokenEntity;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.repository.PasswordHistoryRepository;
import io.restaurantos.auth.repository.PasswordResetTokenRepository;
import io.restaurantos.auth.repository.RefreshSessionRepository;
import io.restaurantos.auth.service.PasswordPolicyService;
import io.restaurantos.shared.event.OutboxEntry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.TestPropertySource;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Plan 13-09, task 1 and the outbox-mode half of task 2: the reset flow's four audited defects.
 *
 * <p><b>Why the payload assertions read the DATABASE and not a mock.</b> The defect being fixed is
 * precisely that the raw token reached a durable, replicated, backed-up table. An assertion that
 * stopped at {@code EventPublisher} would have passed against the broken code — the publisher was
 * called correctly, with the wrong argument. Every payload assertion below therefore loads the
 * persisted {@code event_outbox} row and inspects {@code envelope_json}.
 *
 * <p><b>And why the decisive one is a hash preimage check rather than a string search.</b> The test
 * cannot know the raw token the endpoint minted — that is the whole point of the design. It does
 * not need to: the token row written by the same request holds {@code SHA-256(rawToken)}, so
 * hashing every string in the payload and comparing against that column proves no value in the
 * payload IS the token, without ever holding the token. A {@code assertThat(payload).doesNotContain(
 * "token")} key check alone would pass against a payload that renamed the field to {@code handle}
 * and kept putting the credential in it.
 *
 * <p>The delivery mode is pinned to {@code outbox} for this class. The product default is
 * {@code disabled} (13-09 D-31); {@link PasswordResetDeliveryDisabledIT} covers that side. The
 * property string is repeated verbatim in {@link PasswordResetIT} so the two classes share one
 * Spring context rather than starting a third.
 */
@TestPropertySource(properties = "restaurantos.auth.password-reset.delivery-mode=outbox")
class PasswordResetHardeningIT extends BaseIntegrationTest {

    @Autowired private PasswordResetTokenRepository passwordResetTokenRepository;
    @Autowired private PasswordHistoryRepository passwordHistoryRepository;
    @Autowired private RefreshSessionRepository refreshSessionRepository;
    @Autowired private PasswordEncoder passwordEncoder;

    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * Restored on BOTH sides, and the account's RESET tokens are purged with it.
     *
     * <p>The password restore is order hygiene: a class that leaves the shared demo cashier holding
     * a password of its own choosing hands every later IT class a 401 on a credential the fixture
     * says is correct, and failsafe's default run order is the filesystem's, so which class pays
     * changes when a file is added. This one did exactly that to StepUpLoginIT and RoleCatalogIT.
     *
     * <p>The token purge is not hygiene, it is a precondition. Issuance is now cooldown-limited per
     * account, so a token minted by an earlier test in this class would silently suppress the
     * issuance a later one is asserting on — and the assertion would fail for a reason that has
     * nothing to do with the behaviour under test.
     */
    @BeforeEach
    @AfterEach
    void restoreCashier() {
        setRls(TestFixtures.demoTenantId());
        UserEntity user = userRepository.findByEmail(TestFixtures.CASHIER_EMAIL).orElseThrow();
        user.setPasswordHash(passwordEncoder.encode(TestFixtures.CASHIER_PASSWORD));
        user.setFailedLoginCount(0);
        user.setLockedUntil(null);
        user.setMustChangePassword(false);
        userRepository.save(user);

        new org.springframework.transaction.support.TransactionTemplate(transactionManager)
            .executeWithoutResult(status -> {
                passwordPolicyService.setTenantGuc(TestFixtures.demoTenantId());
                entityManager.createNativeQuery(
                        "DELETE FROM password_reset_tokens WHERE user_id = CAST(:uid AS uuid) AND purpose = 'RESET'")
                    .setParameter("uid", TestFixtures.CASHIER_USER_ID.toString())
                    .executeUpdate();
            });
    }

    // ───────────────────────────── T-13-09-A: the token is not in the event ─────────────────────

    @Test
    @DisplayName("the outbox payload carries identity plus a row handle, and nothing derived from the token")
    void resetRequest_outboxPayload_containsNoTokenMaterial() throws Exception {
        Instant mark = Instant.now();

        assertThat(requestReset(TestFixtures.CASHIER_EMAIL).getStatusCode()).isEqualTo(HttpStatus.OK);

        JsonNode payload = latestResetPayload();
        PasswordResetTokenEntity row = latestResetTokenRow();

        // THE decisive assertion, and it runs FIRST on purpose. If any string anywhere in the
        // payload were the raw token, its SHA-256 would equal the hash the same request persisted —
        // whatever key it happened to be filed under. Ordered ahead of the shape assertions below
        // because those pin each field to an expected value, and after they have passed this loop
        // can no longer fail: it would be a green that proves nothing about itself. Measured in
        // this position against a payload republishing the raw token under the key `tokenId` — it
        // fails, naming the offending value.
        for (String value : everyStringIn(payload)) {
            assertThat(PasswordPolicyService.hashToken(value))
                .as("payload value '%s' hashes to the stored token hash — it IS the raw token", value)
                .isNotEqualTo(row.getTokenHash());
        }

        // And the stored hash itself must not be in the payload either: publishing the hash would
        // let a consumer redeem nothing, but it would let anyone with the event correlate and, with
        // read access to the table, confirm a guess offline.
        assertThat(payload.toString()).doesNotContain(row.getTokenHash());

        // The shape is closed, not merely checked for the absence of one bad key name.
        Set<String> keys = new java.util.HashSet<>();
        payload.fieldNames().forEachRemaining(keys::add);
        assertThat(keys).containsExactlyInAnyOrder("userId", "email", "tokenId");

        assertThat(payload.path("userId").asText()).isEqualTo(TestFixtures.CASHIER_USER_ID.toString());
        assertThat(payload.path("email").asText()).isEqualTo(TestFixtures.CASHIER_EMAIL);
        assertThat(payload.path("tokenId").asText()).isEqualTo(row.getId().toString());

        // Nothing else auth-service emitted around this request may carry it either. The list is
        // asserted non-empty first: an empty loop would pass against a service that wrote no events
        // at all, which is a different bug wearing this test's green.
        List<OutboxEntry> since = outboxSince(mark);
        assertThat(since).isNotEmpty();
        for (OutboxEntry entry : since) {
            for (String value : everyStringIn(objectMapper.readTree(entry.getEnvelopeJson()))) {
                assertThat(PasswordPolicyService.hashToken(value)).isNotEqualTo(row.getTokenHash());
            }
        }
    }

    @Test
    @DisplayName("only the SHA-256 is persisted, and a token minted by the real issuance path still redeems")
    void resetToken_isStoredHashedAndStillRedeemable() {
        String raw = mintResetToken(TestFixtures.demoTenantId(), TestFixtures.CASHIER_USER_ID);

        setRls(TestFixtures.demoTenantId());
        PasswordResetTokenEntity row = latestResetTokenRow();
        assertThat(row.getTokenHash()).isEqualTo(PasswordPolicyService.hashToken(raw));
        assertThat(row.getTokenHash()).hasSize(64).matches("[0-9a-f]{64}");
        assertThat(passwordResetTokenRepository.findAll())
            .noneMatch(t -> raw.equals(t.getTokenHash()));

        String newPassword = "Rq4!vzmtBk8%";
        assertThat(confirmReset(raw, newPassword).getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(login(TestFixtures.CASHIER_EMAIL, newPassword).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    // ───────────────────────────── T-13-09-E: a reset really unlocks ────────────────────────────

    @Test
    @DisplayName("completing a reset clears the failed-login counter and the lockout timestamp")
    void resetConfirm_clearsLockout() {
        setRls(TestFixtures.demoTenantId());
        UserEntity locked = userRepository.findByEmail(TestFixtures.CASHIER_EMAIL).orElseThrow();
        locked.setFailedLoginCount(4);
        locked.setLockedUntil(Instant.now().plusSeconds(900));
        userRepository.save(locked);

        // The premise: the account really is locked out at the wire, not merely flagged in a column.
        assertThat(login(TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD).getStatusCode())
            .isEqualTo(HttpStatus.LOCKED);

        String raw = mintResetToken(TestFixtures.demoTenantId(), TestFixtures.CASHIER_USER_ID);
        String newPassword = "Ty6@wnqrDp2#";
        assertThat(confirmReset(raw, newPassword).getStatusCode()).isEqualTo(HttpStatus.OK);

        setRls(TestFixtures.demoTenantId());
        UserEntity after = userRepository.findByEmail(TestFixtures.CASHIER_EMAIL).orElseThrow();
        assertThat(after.getFailedLoginCount()).isZero();
        assertThat(after.getLockedUntil()).isNull();

        // The behaviour the columns are a proxy for: the user can actually get in, immediately.
        assertThat(login(TestFixtures.CASHIER_EMAIL, newPassword).getStatusCode()).isEqualTo(HttpStatus.OK);
    }

    @Test
    @DisplayName("a reset still revokes refresh sessions and still appends password history")
    void resetConfirm_keepsTheBehaviourItAlreadyHad() {
        var loginResponse = login(TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD);
        assertThat(loginResponse.getStatusCode()).isEqualTo(HttpStatus.OK);

        setRls(TestFixtures.demoTenantId());
        long liveSessionsBefore = refreshSessionRepository
            .findByUserIdAndRevokedAtIsNull(TestFixtures.CASHIER_USER_ID).size();
        assertThat(liveSessionsBefore)
            .as("the login under test must have created a session, or the revocation assertion is vacuous")
            .isPositive();
        long historyBefore =
            passwordHistoryRepository.findTop5ByUserIdOrderByCreatedAtDesc(TestFixtures.CASHIER_USER_ID).size();

        String raw = mintResetToken(TestFixtures.demoTenantId(), TestFixtures.CASHIER_USER_ID);
        assertThat(confirmReset(raw, "Bn3%qwrtFq7!").getStatusCode()).isEqualTo(HttpStatus.OK);

        setRls(TestFixtures.demoTenantId());
        assertThat(refreshSessionRepository.findByUserIdAndRevokedAtIsNull(TestFixtures.CASHIER_USER_ID))
            .isEmpty();
        assertThat(passwordHistoryRepository.findTop5ByUserIdOrderByCreatedAtDesc(TestFixtures.CASHIER_USER_ID))
            .hasSizeGreaterThan((int) Math.min(historyBefore, 4L));
    }

    // ───────────── T-13-09-B / C / D: one live token, a cooldown, and no oracle ─────────────────

    @Test
    @DisplayName("a second request inside the cooldown issues nothing, and says exactly what the first said")
    void resetRequest_insideTheCooldown_issuesNothingAndIsIndistinguishable() {
        var first = requestReset(TestFixtures.CASHIER_EMAIL);
        assertThat(first.getStatusCode()).isEqualTo(HttpStatus.OK);
        long afterFirst = resetTokenCount();
        assertThat(afterFirst).isPositive();

        var second = requestReset(TestFixtures.CASHIER_EMAIL);

        assertThat(second.getStatusCode()).isEqualTo(first.getStatusCode());
        assertThat(second.getBody())
            .as("a cooldown refusal that looks different from an ordinary request IS the oracle")
            .isEqualTo(first.getBody());
        assertThat(resetTokenCount())
            .as("the cooldown is enforced server-side, not by the caller")
            .isEqualTo(afterFirst);
    }

    @Test
    @DisplayName("a request after the cooldown issues, and retires the token the previous one left live")
    void resetRequest_afterTheCooldown_issuesAndRetiresTheOutstandingToken() {
        assertThat(requestReset(TestFixtures.CASHIER_EMAIL).getStatusCode()).isEqualTo(HttpStatus.OK);
        PasswordResetTokenEntity first = latestResetTokenRow();
        assertThat(first.getUsedAt()).isNull();

        // Age the issuance past the window instead of sleeping through it. The predicate under test
        // is "created_at older than the cooldown", and this exercises that predicate rather than a
        // shortened property that would leave the shipped 15-minute default untested.
        ageResetIssuance(java.time.Duration.ofMinutes(20));

        assertThat(requestReset(TestFixtures.CASHIER_EMAIL).getStatusCode()).isEqualTo(HttpStatus.OK);

        setRls(TestFixtures.demoTenantId());
        PasswordResetTokenEntity second = latestResetTokenRow();
        assertThat(second.getId()).isNotEqualTo(first.getId());
        assertThat(second.getUsedAt()).as("the new token is live").isNull();
        assertThat(passwordResetTokenRepository.findById(first.getId()).orElseThrow().getUsedAt())
            .as("and the previous one is not — two concurrently valid reset tokens is T-13-09-D")
            .isNotNull();

        assertThat(liveResetTokenCount())
            .as("exactly one live reset token per account, always")
            .isEqualTo(1L);
    }

    @Test
    @DisplayName("an unknown address gets the same bytes as a known one, and writes nothing")
    void resetRequest_unknownEmail_isIndistinguishableAndInert() {
        long tokensBefore = resetTokenCount();
        long eventsBefore = outboxOfType("PASSWORD_RESET_REQUESTED").size();

        var unknown = requestReset("nobody-" + java.util.UUID.randomUUID() + "@demo.local");
        assertThat(unknown.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(resetTokenCount()).isEqualTo(tokensBefore);
        assertThat(outboxOfType("PASSWORD_RESET_REQUESTED")).hasSize((int) eventsBefore);

        var known = requestReset(TestFixtures.CASHIER_EMAIL);
        assertThat(known.getBody()).isEqualTo(unknown.getBody());
        assertThat(known.getStatusCode()).isEqualTo(unknown.getStatusCode());

        // The control. Without it the equality above would also hold against an endpoint that
        // silently does nothing for everybody, which is a different bug wearing this test's green.
        assertThat(resetTokenCount())
            .as("the KNOWN address really did issue — otherwise this test proves nothing")
            .isEqualTo(tokensBefore + 1);
    }

    // ───────────────────────────── helpers ──────────────────────────────────────────────────────

    private long resetTokenCount() {
        setRls(TestFixtures.demoTenantId());
        return passwordResetTokenRepository.findAll().stream()
            .filter(t -> "RESET".equals(t.getPurpose()))
            .filter(t -> TestFixtures.CASHIER_USER_ID.equals(t.getUserId()))
            .count();
    }

    private long liveResetTokenCount() {
        setRls(TestFixtures.demoTenantId());
        return passwordResetTokenRepository.findAll().stream()
            .filter(t -> "RESET".equals(t.getPurpose()))
            .filter(t -> TestFixtures.CASHIER_USER_ID.equals(t.getUserId()))
            .filter(t -> t.getUsedAt() == null)
            .count();
    }

    private void ageResetIssuance(java.time.Duration by) {
        new org.springframework.transaction.support.TransactionTemplate(transactionManager)
            .executeWithoutResult(status -> {
                passwordPolicyService.setTenantGuc(TestFixtures.demoTenantId());
                entityManager.createNativeQuery("""
                        UPDATE password_reset_tokens
                           SET created_at = created_at - CAST(:shift AS interval)
                         WHERE user_id = CAST(:uid AS uuid) AND purpose = 'RESET'
                        """)
                    .setParameter("shift", by.toMinutes() + " minutes")
                    .setParameter("uid", TestFixtures.CASHIER_USER_ID.toString())
                    .executeUpdate();
            });
    }

    private org.springframework.http.ResponseEntity<String> requestReset(String email) {
        return exchangePost("/api/v1/auth/reset-password/request",
            Map.of("email", email, "tenantSlug", TestFixtures.DEMO_SLUG));
    }

    private org.springframework.http.ResponseEntity<String> confirmReset(String token, String newPassword) {
        return exchangePost("/api/v1/auth/reset-password/confirm",
            Map.of("token", token, "newPassword", newPassword));
    }

    private org.springframework.http.ResponseEntity<String> login(String email, String password) {
        return exchangePost("/api/v1/auth/login",
            TestFixtures.loginBody(email, password, TestFixtures.DEMO_SLUG));
    }

    private JsonNode latestResetPayload() throws Exception {
        OutboxEntry entry = outboxOfType("PASSWORD_RESET_REQUESTED").stream()
            .max(Comparator.comparing(OutboxEntry::getCreatedAt))
            .orElseThrow(() -> new AssertionError("no PASSWORD_RESET_REQUESTED event was written"));
        return objectMapper.readTree(entry.getEnvelopeJson()).path("payload");
    }

    private PasswordResetTokenEntity latestResetTokenRow() {
        setRls(TestFixtures.demoTenantId());
        return passwordResetTokenRepository.findAll().stream()
            .filter(t -> "RESET".equals(t.getPurpose()))
            .filter(t -> TestFixtures.CASHIER_USER_ID.equals(t.getUserId()))
            .max(Comparator.comparing(PasswordResetTokenEntity::getCreatedAt))
            .orElseThrow(() -> new AssertionError("no RESET token row was written"));
    }

    private List<OutboxEntry> outboxOfType(String eventType) {
        List<OutboxEntry> all = new ArrayList<>();
        all.addAll(outboxRepository.findTop200ByStatusOrderByCreatedAtAsc("PENDING"));
        all.addAll(outboxRepository.findTop200ByStatusOrderByCreatedAtAsc("SENT"));
        return all.stream().filter(e -> eventType.equals(e.getEventType())).toList();
    }

    private List<OutboxEntry> outboxSince(Instant mark) {
        List<OutboxEntry> all = new ArrayList<>();
        all.addAll(outboxRepository.findTop200ByStatusOrderByCreatedAtAsc("PENDING"));
        all.addAll(outboxRepository.findTop200ByStatusOrderByCreatedAtAsc("SENT"));
        return all.stream().filter(e -> !e.getCreatedAt().isBefore(mark)).toList();
    }

    /** Every string that appears anywhere in a JSON tree, as a value or as a key. */
    private static List<String> everyStringIn(JsonNode node) {
        List<String> out = new ArrayList<>();
        collectStrings(node, out);
        return out;
    }

    private static void collectStrings(JsonNode node, List<String> out) {
        if (node == null || node.isNull()) {
            return;
        }
        if (node.isValueNode()) {
            out.add(node.asText());
            return;
        }
        if (node.isArray()) {
            node.forEach(child -> collectStrings(child, out));
            return;
        }
        node.fields().forEachRemaining(field -> {
            out.add(field.getKey());
            collectStrings(field.getValue(), out);
        });
    }
}
