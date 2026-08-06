package io.restaurantos.auth.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.auth.config.InternalServiceFilter;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Administrator-initiated password reset (13-13, D-16, D-18).
 *
 * <p>This is the ONLY working way to set a user's password in this milestone. 13-09 (D-31) resolved
 * that self-service forgot-password ships disabled because {@code notification-service} has no
 * source files and nothing consumes {@code PASSWORD_RESET_REQUESTED}, so there is no channel that
 * can deliver a token to a user who has forgotten their password. The temporary password minted
 * here crosses back to the calling administrator, once, to be handed over out of band.
 *
 * <h2>What this file can and cannot prove about row-level security</h2>
 *
 * <p>Testcontainers' Postgres user is a SUPERUSER, so {@code users}' {@code tenant_isolation} policy
 * is <b>inert in every test here</b> — six paths this phase shipped green-and-broken that way. The
 * isolation assertion below therefore measures the other, CI-assertable control: the
 * {@code tenant_id} predicate carried in {@code UserRepository.findByIdForTenant}. It writes the
 * neighbouring tenant's row with that tenant's GUC set and asserts the row EXISTS before asserting
 * it is not reachable, so the negative cannot pass by the fixture never having been created. The
 * policy half is asserted by {@code scripts/e2e/phase13-admin-reset-e2e.sh} against the live
 * enforcing database, where {@code auth_user} is {@code NOSUPERUSER NOBYPASSRLS}.
 *
 * <h2>The audit assertion is made on a PERSISTED row</h2>
 *
 * <p>13-14 found {@code ImpersonationService} could never write its audit row at all — an id
 * assigned to a {@code @GeneratedValue} entity made Spring Data call {@code merge()}, so every
 * impersonation 409'd while recording itself. Anything that stopped at the publisher would have
 * been green against that. Every audit assertion here reads {@code event_outbox}.
 */
class AdminPasswordResetIT extends BaseIntegrationTest {

    private static final String INTERNAL_SECRET = "dev-internal-secret";
    private static final String USERS = "/internal/auth/users";
    private static final UUID TENANT = TestFixtures.DEMO_TENANT_ID;
    private static final UUID BRANCH = TestFixtures.MAIN_BRANCH_ID;
    /** The tenant's OWNER: holds the whole catalogue, so its ceiling permits anything. */
    private static final UUID OWNER = TestFixtures.OWNER_USER_ID;
    /** A CASHIER: holds almost nothing, so it is above nobody. */
    private static final UUID CASHIER = TestFixtures.CASHIER_USER_ID;

    private static final ObjectMapper JSON = new ObjectMapper();

    // ── Behaviour 1: the reset does all six things, and they are read back from the database ──

    @Test
    void reset_setsATemporaryPasswordClearsTheLockoutAppendsHistoryAndRevokesSessions() {
        String email = uniqueEmail("resettarget");
        UUID target = createdUserId(create(email, "Reset Target", BRANCH, "CASHIER"));
        String firstPassword = "Reset#Target1x";
        completeForcedChange(email, createdTempPassword, firstPassword);

        // A genuinely locked, genuinely sessioned account. handleFailedPassword ZEROES the counter
        // at the moment it trips the lock, so "0 afterwards" would pass against a reset that did
        // nothing at all — the counter is planted non-zero for exactly that reason (13-09's lesson).
        plantLockout(target, 3);
        insertRefreshSessionDirectly(TENANT, target);
        assertThat(liveRefreshSessions(target)).as("[control] the account has a live session before the reset").isEqualTo(1);
        long historyBefore = passwordHistoryRows(target);
        String hashBefore = passwordHash(target);

        ResponseEntity<String> response = reset(target, OWNER, "TENANT", "Staff member forgot their password");

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        JsonNode data = parse(response).path("data");
        String temp = data.path("tempPassword").asText();
        assertThat(temp).as("the temporary password crosses back once").isNotBlank();
        assertThat(data.path("mustChangePassword").asBoolean()).isTrue();
        assertThat(data.path("userId").asText()).isEqualTo(target.toString());

        assertThat(passwordHash(target)).as("the stored hash changed").isNotEqualTo(hashBefore);
        assertThat(passwordHash(target)).as("and it is a hash, not the password").isNotEqualTo(temp);
        assertThat(passwordHistoryRows(target))
            .as("the PREVIOUS hash was appended to history before being overwritten")
            .isEqualTo(historyBefore + 1);
        assertThat(mustChangePassword(target)).as("the forced-change flag is set (D-16)").isTrue();
        assertThat(failedLoginCount(target)).as("the failed-login counter is cleared (D-18)").isZero();
        assertThat(lockedUntilIsNull(target)).as("and the lockout timestamp with it (D-18)").isTrue();
        assertThat(liveRefreshSessions(target)).as("the target's refresh sessions are revoked").isZero();
    }

    // ── Behaviour 2 + 3: the temp password works, once, and only through the forced-change gate ──

    @Test
    void reset_theTargetsNextLoginIsTheForcedChangeRefusalAndTheTemporaryPasswordRedeemsIt() {
        String email = uniqueEmail("recovers");
        UUID target = createdUserId(create(email, "Recovers", BRANCH, "CASHIER"));
        completeForcedChange(email, createdTempPassword, "Recovers#First1x");
        plantLockout(target, 4);

        // The control that makes the refusal below mean something: the account is LOCKED right now.
        assertThat(login(email, "Recovers#First1x").getStatusCode().value())
            .as("[control] the account is genuinely locked before the reset")
            .isEqualTo(423);

        String temp = parse(reset(target, OWNER, "TENANT", "locked out"))
            .path("data").path("tempPassword").asText();

        ResponseEntity<String> refusal = login(email, temp);
        assertThat(refusal.getStatusCode().value())
            .as("the next login is the FORCED-CHANGE refusal, not the lockout — that single "
                + "assertion is the difference between a reset that works and one that leaves the "
                + "user staring at a 423 with no explanation (D-18)")
            .isEqualTo(403);
        assertThat(refusal.getBody()).contains("PASSWORD_CHANGE_REQUIRED");

        String changeToken = changeTokenOf(refusal);
        assertThat(changeToken).isNotBlank();
        String finalPassword = "Recovers#Final1x";
        ResponseEntity<String> changed = exchangePost("/api/v1/auth/change-password/forced",
            Map.of("changeToken", changeToken, "currentPassword", temp, "newPassword", finalPassword));
        assertThat(changed.getStatusCode().value())
            .as("the temporary password redeems the forced change")
            .isEqualTo(200);

        assertThat(login(email, finalPassword).getStatusCode().value())
            .as("and the user is back in the product")
            .isEqualTo(200);
        assertThat(login(email, temp).getStatusCode().value())
            .as("the temporary password is spent — it does not remain a second credential")
            .isEqualTo(401);
    }

    // ── Behaviour 4: another tenant's user is NOT FOUND ──────────────────────────────────────

    @Test
    void reset_aTargetInAnotherTenantIsNotFound() {
        UUID otherTenant = UUID.randomUUID();
        UUID neighbour = insertUserDirectly(otherTenant, uniqueEmail("neighbour"), "Neighbour");
        assertThat(userExists(neighbour))
            .as("[control] the neighbouring row really exists — without this the 404 below is "
                + "satisfied by an INSERT the policy refused")
            .isTrue();

        ResponseEntity<String> response = reset(neighbour, OWNER, "TENANT", "cross tenant");

        assertThat(response.getStatusCode().value()).isEqualTo(404);
        assertThat(passwordHash(neighbour))
            .as("nothing was written to the neighbour's row")
            .isEqualTo("$2a$12$notarealhashnotarealhashnotarealhashnotarealhash");
        // A user id that exists NOWHERE must answer identically, or the pair is an oracle.
        assertThat(reset(UUID.randomUUID(), OWNER, "TENANT", "nobody").getStatusCode().value())
            .as("an id that exists nowhere answers the same as another tenant's")
            .isEqualTo(404);
    }

    // ── Behaviour 5: the audit event names the RIGHT actor, and carries no credential ─────────

    @Test
    void reset_emitsAnAuditEventWhoseActorAndTargetAreDifferentPeopleAndCarriesNoPasswordMaterial() {
        String email = uniqueEmail("audited");
        UUID target = createdUserId(create(email, "Audited", BRANCH, "CASHIER"));
        long before = outboxRepository.count();

        String temp = parse(reset(target, OWNER, "TENANT", "audit-reason-42"))
            .path("data").path("tempPassword").asText();

        String payload = latestPayloadOfType("ADMIN_PASSWORD_RESET");
        assertThat(payload).as("the event is PERSISTED, not merely published — 13-14 found an audit "
            + "write that could never commit while the method it audited reported success").isNotBlank();
        assertThat(outboxRepository.count()).isGreaterThan(before);

        JsonNode event = parseJson(payload);
        assertThat(event.path("actingAdministratorId").asText())
            .as("the ACTOR is the administrator")
            .isEqualTo(OWNER.toString());
        assertThat(event.path("targetUserId").asText())
            .as("the TARGET is the person whose password changed")
            .isEqualTo(target.toString());
        assertThat(event.path("actingAdministratorId").asText())
            .as("and they are two different people — the impersonation trail recorded every user as "
                + "their own impersonator, and this is the same shape of mistake (D-34)")
            .isNotEqualTo(event.path("targetUserId").asText());
        assertThat(event.path("actorTier").asText()).isEqualTo("TENANT");
        assertThat(event.path("reason").asText()).isEqualTo("audit-reason-42");
        assertThat(event.path("tenantId").asText()).isEqualTo(TENANT.toString());

        // No credential material anywhere in the payload, checked by VALUE rather than by key name:
        // a key-set assertion passes against a payload that republishes the password under a
        // harmless name (13-09 falsified exactly that).
        assertThat(payload).doesNotContain(temp);
        for (JsonNode value : event) {
            assertThat(value.asText()).isNotEqualTo(temp);
        }
    }

    // ── Behaviour 6: the tenant tier cannot reset above its own ceiling; the platform tier can ──

    @Test
    void reset_aTenantTierCallerIsRefusedATargetAboveItsCeilingAndThePlatformTierIsNot() {
        // The control FIRST, so the refusal below cannot be a caller who simply cannot reset at all.
        String email = uniqueEmail("peer");
        UUID peer = createdUserId(create(email, "Peer", BRANCH, "CASHIER"));
        assertThat(reset(peer, CASHIER, "TENANT", "control").getStatusCode().value())
            .as("[control] a cashier CAN reset a user who holds nothing above it")
            .isEqualTo(200);

        String hashBefore = passwordHash(OWNER);
        ResponseEntity<String> refused = reset(OWNER, CASHIER, "TENANT", "privilege inversion");
        assertThat(refused.getStatusCode().value())
            .as("a tenant-tier caller may not reset a target holding a role above its own — that is "
                + "a privilege inversion, not an administrative convenience")
            .isEqualTo(403);
        assertThat(refused.getBody()).contains("ROLE_CEILING_EXCEEDED");
        assertThat(refused.getBody())
            .as("the refusal names the role and a count, never the permission codes it withholds")
            .doesNotContain("rbac.manage");
        assertThat(passwordHash(OWNER)).as("the refused reset changed nothing").isEqualTo(hashBefore);

        // The platform tier is deliberately unbounded: a SuperAdmin supports every tenant, and the
        // acting id there is a platform_users row that has no tenant role to compare against at all.
        ResponseEntity<String> platform = reset(OWNER, UUID.randomUUID(), "PLATFORM", "support call");
        assertThat(platform.getStatusCode().value())
            .as("the PLATFORM tier may reset the highest tenant role")
            .isEqualTo(200);
        assertThat(passwordHash(OWNER)).isNotEqualTo(hashBefore);
        assertThat(parseJson(latestPayloadOfType("ADMIN_PASSWORD_RESET")).path("actorTier").asText())
            .isEqualTo("PLATFORM");

        // Restore the shared OWNER fixture. Run order is the filesystem's, and 13-09 had two
        // unrelated IT classes go red on a credential another test had quietly changed.
        restoreOwnerPassword();
    }

    // ── The two refusals that keep the seam honest ───────────────────────────────────────────

    @Test
    void reset_requiresAnActingAdministratorAndAReason() {
        UUID target = createdUserId(create(uniqueEmail("needsactor"), "Needs Actor", BRANCH, "CASHIER"));

        ResponseEntity<String> noActor = rest.post().uri(USERS + "/" + target + "/password-reset")
            .contentType(MediaType.APPLICATION_JSON)
            .header(InternalServiceFilter.HEADER, INTERNAL_SECRET)
            .header("X-Tenant-Id", TENANT.toString())
            .body(Map.of("actorTier", "TENANT", "reason", "no actor"))
            .exchange((rq, rs) -> toEntity(rs));
        assertThat(noActor.getStatusCode().value()).isEqualTo(403);
        assertThat(noActor.getBody()).contains("ACTING_USER_REQUIRED");

        assertThat(reset(target, OWNER, "TENANT", "  ").getStatusCode().value())
            .as("a reset without a reason is refused — every reset is audited, and an audit row "
                + "with no reason cannot answer why a rival was locked out (T-13-13-E)")
            .isEqualTo(400);
    }

    @Test
    void reset_isRefusedWithoutTheInternalSecret() {
        UUID target = createdUserId(create(uniqueEmail("nosecretreset"), "No Secret", BRANCH, "CASHIER"));
        ResponseEntity<String> response = rest.post().uri(USERS + "/" + target + "/password-reset")
            .contentType(MediaType.APPLICATION_JSON)
            .header("X-Tenant-Id", TENANT.toString())
            .header("X-Acting-User-Id", OWNER.toString())
            .body(Map.of("actorTier", "TENANT", "reason", "no secret"))
            .exchange((rq, rs) -> toEntity(rs));
        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody()).contains("INTERNAL_AUTH_REQUIRED");
    }

    // ───────────────────────────────── helpers ─────────────────────────────────

    /** Set by {@link #create} so a caller can pick up the one-time temporary password. */
    private String createdTempPassword;

    private ResponseEntity<String> reset(UUID targetUserId, UUID actingUserId, String tier, String reason) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("actorTier", tier);
        body.put("reason", reason);
        return rest.post().uri(USERS + "/" + targetUserId + "/password-reset")
            .contentType(MediaType.APPLICATION_JSON)
            .header(InternalServiceFilter.HEADER, INTERNAL_SECRET)
            .header("X-Tenant-Id", TENANT.toString())
            .header("X-Acting-User-Id", actingUserId.toString())
            .body(body)
            .exchange((rq, rs) -> toEntity(rs));
    }

    private ResponseEntity<String> create(String email, String fullName, UUID branchId, String roleCode) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("email", email);
        body.put("fullName", fullName);
        body.put("branchId", branchId.toString());
        body.put("roleCode", roleCode);
        ResponseEntity<String> response = rest.post().uri(USERS)
            .contentType(MediaType.APPLICATION_JSON)
            .header(InternalServiceFilter.HEADER, INTERNAL_SECRET)
            .header("X-Tenant-Id", TENANT.toString())
            .header("X-Acting-User-Id", OWNER.toString())
            .body(body)
            .exchange((rq, rs) -> toEntity(rs));
        createdTempPassword = parse(response).path("data").path("tempPassword").asText();
        return response;
    }

    private ResponseEntity<String> login(String email, String password) {
        return exchangePost("/api/v1/auth/login",
            TestFixtures.loginBody(email, password, TestFixtures.DEMO_SLUG));
    }

    private void completeForcedChange(String email, String temp, String newPassword) {
        String changeToken = changeTokenOf(login(email, temp));
        ResponseEntity<String> changed = exchangePost("/api/v1/auth/change-password/forced",
            Map.of("changeToken", changeToken, "currentPassword", temp, "newPassword", newPassword));
        assertThat(changed.getStatusCode().value())
            .as("[fixture] the new account could not clear its forced-change gate: " + changed.getBody())
            .isEqualTo(200);
    }

    private static String changeTokenOf(ResponseEntity<String> refusal) {
        JsonNode details = parseJson(refusal.getBody()).path("error").path("details");
        for (JsonNode detail : details) {
            if ("changeToken".equals(detail.path("field").asText())) {
                return detail.path("issue").asText();
            }
        }
        return "";
    }

    private void restoreOwnerPassword() {
        // Through the production path, so the history and reuse rules see what they would see in
        // life; the seeded credential is what every other IT class logs in with.
        String temp = parse(reset(OWNER, UUID.randomUUID(), "PLATFORM", "fixture restore"))
            .path("data").path("tempPassword").asText();
        String changeToken = changeTokenOf(login(TestFixtures.OWNER_EMAIL, temp));
        exchangePost("/api/v1/auth/change-password/forced",
            Map.of("changeToken", changeToken, "currentPassword", temp,
                "newPassword", TestFixtures.OWNER_PASSWORD));
    }

    // ── Database reads (the assertions that a response body cannot make) ─────────────────────

    private void plantLockout(UUID userId, int failedCount) {
        inTransaction(() -> entityManager.createNativeQuery(
                "UPDATE users SET failed_login_count = :n, locked_until = now() + interval '15 minutes' "
                    + "WHERE id = :id")
            .setParameter("n", failedCount)
            .setParameter("id", userId)
            .executeUpdate());
    }

    private UUID insertUserDirectly(UUID tenantId, String email, String fullName) {
        UUID id = UUID.randomUUID();
        new org.springframework.transaction.support.TransactionTemplate(transactionManager)
            .execute(status -> {
                passwordPolicyService.setTenantGuc(tenantId);
                return entityManager.createNativeQuery("""
                        INSERT INTO users (id, tenant_id, email, password_hash, full_name, totp_enabled,
                                           is_active, failed_login_count, created_at, updated_at, version,
                                           must_change_password)
                        VALUES (:id, :tid, :email, '$2a$12$notarealhashnotarealhashnotarealhashnotarealhash',
                                :name, false, true, 0, now(), now(), 0, false)
                        """)
                    .setParameter("id", id)
                    .setParameter("tid", tenantId)
                    .setParameter("email", email)
                    .setParameter("name", fullName)
                    .executeUpdate();
            });
        return id;
    }

    private void insertRefreshSessionDirectly(UUID tenantId, UUID userId) {
        new org.springframework.transaction.support.TransactionTemplate(transactionManager)
            .execute(status -> {
                passwordPolicyService.setTenantGuc(tenantId);
                return entityManager.createNativeQuery("""
                        INSERT INTO refresh_sessions (id, tenant_id, user_id, branch_id, token_hash,
                                                      expires_at, created_at)
                        VALUES (:id, :tid, :uid, :bid, :hash, now() + interval '30 days', now())
                        """)
                    .setParameter("id", UUID.randomUUID())
                    .setParameter("tid", tenantId)
                    .setParameter("uid", userId)
                    .setParameter("bid", BRANCH)
                    .setParameter("hash", "hash-" + UUID.randomUUID())
                    .executeUpdate();
            });
    }

    private String passwordHash(UUID userId) {
        return (String) single("SELECT password_hash FROM users WHERE id = '" + userId + "'");
    }

    private boolean userExists(UUID userId) {
        return count("SELECT count(*) FROM users WHERE id = '" + userId + "'") == 1;
    }

    private boolean mustChangePassword(UUID userId) {
        return Boolean.TRUE.equals(single("SELECT must_change_password FROM users WHERE id = '" + userId + "'"));
    }

    private int failedLoginCount(UUID userId) {
        return ((Number) single("SELECT failed_login_count FROM users WHERE id = '" + userId + "'")).intValue();
    }

    private boolean lockedUntilIsNull(UUID userId) {
        return single("SELECT locked_until FROM users WHERE id = '" + userId + "'") == null;
    }

    private long passwordHistoryRows(UUID userId) {
        return count("SELECT count(*) FROM password_history WHERE user_id = '" + userId + "'");
    }

    private long liveRefreshSessions(UUID userId) {
        return count("SELECT count(*) FROM refresh_sessions WHERE user_id = '" + userId
            + "' AND revoked_at IS NULL");
    }

    /**
     * The payload of the most recent outbox row of this event type, as raw JSON.
     *
     * <p>Read out of {@code event_outbox} rather than from a mocked publisher, on purpose. 13-09's
     * defect was a publisher called CORRECTLY with the wrong argument, and 13-14's was an audit row
     * that could never commit at all — neither is visible to a test that stops at the seam.
     * {@code envelope_json} is the whole envelope; the payload is one field inside it.
     */
    private String latestPayloadOfType(String eventType) {
        List<?> rows = entityManager.createNativeQuery(
                "SELECT envelope_json FROM event_outbox WHERE event_type = :t "
                    + "ORDER BY created_at DESC LIMIT 1")
            .setParameter("t", eventType)
            .getResultList();
        if (rows.isEmpty()) {
            return "";
        }
        JsonNode payload = parseJson(String.valueOf(rows.get(0))).path("payload");
        return payload.isMissingNode() ? "" : payload.toString();
    }

    private Object single(String sql) {
        List<?> rows = entityManager.createNativeQuery(sql).getResultList();
        return rows.isEmpty() ? null : rows.get(0);
    }

    private long count(String sql) {
        return ((Number) entityManager.createNativeQuery(sql).getSingleResult()).longValue();
    }

    private void inTransaction(Runnable work) {
        new org.springframework.transaction.support.TransactionTemplate(transactionManager)
            .execute(status -> {
                passwordPolicyService.setTenantGuc(TENANT);
                work.run();
                return null;
            });
    }

    private static String uniqueEmail(String prefix) {
        return prefix + UUID.randomUUID().toString().substring(0, 8) + "@demo.local";
    }

    private static UUID createdUserId(ResponseEntity<String> createResponse) {
        return UUID.fromString(parse(createResponse).path("data").path("id").asText());
    }

    private static JsonNode parse(ResponseEntity<String> response) {
        return parseJson(response.getBody());
    }

    private static JsonNode parseJson(String body) {
        try {
            return JSON.readTree(body == null || body.isBlank() ? "{}" : body);
        } catch (Exception e) {
            throw new IllegalStateException("not JSON: " + body, e);
        }
    }

    private static ResponseEntity<String> toEntity(org.springframework.http.client.ClientHttpResponse response)
            throws java.io.IOException {
        byte[] bytes = response.getBody() != null ? response.getBody().readAllBytes() : new byte[0];
        return ResponseEntity.status(response.getStatusCode())
            .headers(response.getHeaders())
            .body(new String(bytes, StandardCharsets.UTF_8));
    }

    /** Kept so the unused-import warning does not hide a real one. */
    @SuppressWarnings("unused")
    private static final List<String> UNUSED = new ArrayList<>();
}
