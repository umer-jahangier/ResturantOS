package io.restaurantos.auth.integration;

import io.restaurantos.auth.config.InternalServiceFilter;
import io.restaurantos.auth.service.BranchRoleAdminService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.web.client.RestClient;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;

/**
 * The auth-service half of blocker B2: the {@code auth_tenants} row that login resolves by slug,
 * and the branch-role assignment without which a freshly provisioned admin cannot log in at all.
 *
 * <p>Two things worth knowing about what these assertions can and cannot see. Testcontainers'
 * Postgres user is a SUPERUSER, and superusers bypass row security entirely — so an RLS defect on a
 * write path is invisible here by construction. That is exactly how {@code POST
 * /internal/auth/users/&#123;id&#125;/branch-roles} stayed green for months while being incapable of
 * writing a row against the real database (13-02). Every RLS claim this plan makes is therefore
 * ALSO measured against the live dev {@code auth_db}, whose owner {@code auth_user} is
 * {@code NOSUPERUSER NOBYPASSRLS}; see 13-06-SUMMARY. What IS assertable here is the structural
 * premise the code rests on — {@link #authTenants_isNotRowLevelSecurityScoped()} — because that one
 * reads the catalog rather than depending on the policy being enforced against the current user.
 */
class AuthTenantProvisioningIT extends BaseIntegrationTest {

    private static final String INTERNAL_SECRET = "dev-internal-secret";
    private static final String TENANTS = "/internal/auth/tenants";
    /**
     * What a provisioned admin sets its temporary password to, in the tests that need to get past
     * 13-08's forced-change gate. Satisfies the shared {@code @StrongPassword} policy: at least 8
     * characters with all four character classes.
     */
    private static final String POST_CHANGE_PASSWORD = "Provisioned#1a";

    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwordEncoder;

    /** Real in every test but the rollback one; Spring resets the stubbing between methods. */
    @MockitoSpyBean BranchRoleAdminService branchRoleAdminService;

    // ── Behaviour 5: the internal secret is the whole of the authorization ────────────────────

    @Test
    void register_withoutInternalSecret_returns403() {
        ResponseEntity<String> response =
            post(TENANTS, registerBody(UUID.randomUUID(), slug("nosecret"), "No Secret"), null);

        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody()).contains("INTERNAL_AUTH_REQUIRED");
    }

    @Test
    void setStatus_withoutInternalSecret_returns403() {
        ResponseEntity<String> response =
            patch(TENANTS + "/" + UUID.randomUUID() + "/status", Map.of("status", "SUSPENDED"), null);

        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody()).contains("INTERNAL_AUTH_REQUIRED");
    }

    // ── Behaviour 1: the row login resolves by slug is created from application code ──────────

    @Test
    void register_createsActiveRowWithBothTimestamps() {
        UUID tenantId = UUID.randomUUID();
        String slug = slug("create");

        ResponseEntity<String> response = post(TENANTS, registerBody(tenantId, slug, "Create Co"), INTERNAL_SECRET);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).contains("\"status\":\"ACTIVE\"");
        assertThat(response.getBody()).contains("\"created\":true");

        Map<String, Object> row = tenantRow(tenantId);
        assertThat(row.get("slug")).isEqualTo(slug);
        assertThat(row.get("name")).isEqualTo("Create Co");
        assertThat(row.get("status")).isEqualTo("ACTIVE");
        // The entity declares both non-null and has NO auditing callback, so anything that does not
        // set them explicitly fails at the driver. Asserting they are populated is what stops a
        // later refactor from quietly relying on the column default instead.
        assertThat(row.get("created_at")).as("created_at must be set explicitly").isNotNull();
        assertThat(row.get("updated_at")).as("updated_at must be set explicitly").isNotNull();
    }

    // ── Behaviour 2: keyed on the tenant id, so a re-registration updates rather than duplicates ─

    @Test
    void register_sameTenantIdWithChangedSlug_updatesInPlace() {
        UUID tenantId = UUID.randomUUID();
        String first = slug("rename-a");
        String second = slug("rename-b");

        post(TENANTS, registerBody(tenantId, first, "Rename Co"), INTERNAL_SECRET);
        ResponseEntity<String> response =
            post(TENANTS, registerBody(tenantId, second, "Rename Co Ltd"), INTERNAL_SECRET);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).contains("\"created\":false");

        assertThat(count("SELECT count(*) FROM auth_tenants WHERE id = ?", tenantId))
            .as("an upsert keyed on the tenant id, not a second row")
            .isEqualTo(1);
        assertThat(tenantRow(tenantId).get("slug")).isEqualTo(second);
        assertThat(tenantRow(tenantId).get("name")).isEqualTo("Rename Co Ltd");
        assertThat(count("SELECT count(*) FROM auth_tenants WHERE slug = ?", first))
            .as("the old slug must be released, not left pointing at the tenant")
            .isZero();
    }

    /**
     * The plan's guardrail, asserted by replay rather than by reasoning: provisioning is retried by
     * the saga, so "idempotent" has to mean the second identical call changes nothing observable
     * except {@code updated_at} — not merely that it does not throw.
     */
    @Test
    void register_replayedIdentically_isIdempotent() {
        UUID tenantId = UUID.randomUUID();
        String slug = slug("replay");

        post(TENANTS, registerBody(tenantId, slug, "Replay Co"), INTERNAL_SECRET);
        Map<String, Object> afterFirst = tenantRow(tenantId);

        ResponseEntity<String> second = post(TENANTS, registerBody(tenantId, slug, "Replay Co"), INTERNAL_SECRET);
        Map<String, Object> afterSecond = tenantRow(tenantId);

        assertThat(second.getStatusCode().value())
            .as("a retried saga step must not have to distinguish 201 from 200")
            .isEqualTo(200);
        assertThat(count("SELECT count(*) FROM auth_tenants WHERE id = ?", tenantId)).isEqualTo(1);
        assertThat(afterSecond.get("slug")).isEqualTo(afterFirst.get("slug"));
        assertThat(afterSecond.get("name")).isEqualTo(afterFirst.get("name"));
        assertThat(afterSecond.get("status")).isEqualTo(afterFirst.get("status"));
        assertThat(afterSecond.get("created_at"))
            .as("created_at belongs to the creation, not to the retry")
            .isEqualTo(afterFirst.get("created_at"));
    }

    /**
     * A replay must not resurrect a tenant an operator has suspended. Suspension is the primary
     * non-payment lever, and the saga can re-run {@code register} at any time — so if registration
     * forced the status back to ACTIVE, one retry of a provisioning step would silently reinstate a
     * suspended tenant. Registration therefore sets ACTIVE only when it creates the row.
     */
    @Test
    void register_afterSuspension_doesNotReactivate() {
        UUID tenantId = UUID.randomUUID();
        String slug = slug("suspended-replay");

        post(TENANTS, registerBody(tenantId, slug, "Suspended Co"), INTERNAL_SECRET);
        patch(TENANTS + "/" + tenantId + "/status", Map.of("status", "SUSPENDED"), INTERNAL_SECRET);

        post(TENANTS, registerBody(tenantId, slug, "Suspended Co"), INTERNAL_SECRET);

        assertThat(tenantRow(tenantId).get("status"))
            .as("re-registering must not undo a suspension")
            .isEqualTo("SUSPENDED");
    }

    // ── Behaviour 3: a slug collision is a mappable application error ─────────────────────────

    @Test
    void register_slugHeldByADifferentTenant_returns409AndNotAConstraintViolation() {
        String slug = slug("contested");
        UUID incumbent = UUID.randomUUID();
        UUID challenger = UUID.randomUUID();

        post(TENANTS, registerBody(incumbent, slug, "Incumbent"), INTERNAL_SECRET);
        ResponseEntity<String> response = post(TENANTS, registerBody(challenger, slug, "Challenger"), INTERNAL_SECRET);

        assertThat(response.getStatusCode().value()).isEqualTo(409);
        // STATE_INVALID is the mappable application error. CONFLICT would mean the unique index
        // rejected the INSERT at the driver — a DataIntegrityViolationException the saga in 13-10
        // cannot distinguish from any other integrity failure.
        assertThat(response.getBody()).contains("STATE_INVALID");
        assertThat(response.getBody()).contains(slug);
        assertThat(count("SELECT count(*) FROM auth_tenants WHERE id = ?", challenger))
            .as("the losing registration must leave nothing behind")
            .isZero();
        assertThat(tenantRow(incumbent).get("name"))
            .as("and must not have overwritten the incumbent")
            .isEqualTo("Incumbent");
    }

    // ── Behaviour 4: a non-active status is refused at login ──────────────────────────────────

    /**
     * The before/after contrast is the point. Asserting only that a suspended tenant cannot log in
     * would pass just as well against a tenant that could never log in for some unrelated reason —
     * the identical 401 body is returned for an unknown tenant, an unknown user and a bad password.
     * Logging in successfully first is what makes the refusal afterwards mean "suspended".
     */
    @Test
    void setStatus_toANonActiveStatus_refusesASubsequentLogin() {
        UUID tenantId = UUID.randomUUID();
        String slug = slug("statusflip");
        String email = "status-flip@" + slug + ".local";
        String password = "Flip#2026aB";

        post(TENANTS, registerBody(tenantId, slug, "Status Flip Co"), INTERNAL_SECRET);
        seedLoginableUser(tenantId, email, password);

        assertThat(login(email, password, slug).getStatusCode().value())
            .as("baseline: the tenant is ACTIVE and this user can log in")
            .isEqualTo(200);

        ResponseEntity<String> patched =
            patch(TENANTS + "/" + tenantId + "/status", Map.of("status", "SUSPENDED"), INTERNAL_SECRET);
        assertThat(patched.getStatusCode().value()).isEqualTo(200);
        assertThat(patched.getBody()).contains("\"loginAllowed\":false");

        assertThat(login(email, password, slug).getStatusCode().value())
            .as("the same credentials, refused because the tenant is no longer active")
            .isEqualTo(401);
    }

    @Test
    void setStatus_backToActive_restoresLogin() {
        UUID tenantId = UUID.randomUUID();
        String slug = slug("restore");
        String email = "restore@" + slug + ".local";
        String password = "Restore#2026aB";

        post(TENANTS, registerBody(tenantId, slug, "Restore Co"), INTERNAL_SECRET);
        seedLoginableUser(tenantId, email, password);
        patch(TENANTS + "/" + tenantId + "/status", Map.of("status", "SUSPENDED"), INTERNAL_SECRET);
        assertThat(login(email, password, slug).getStatusCode().value()).isEqualTo(401);

        ResponseEntity<String> patched =
            patch(TENANTS + "/" + tenantId + "/status", Map.of("status", "ACTIVE"), INTERNAL_SECRET);

        assertThat(patched.getStatusCode().value()).isEqualTo(200);
        assertThat(patched.getBody()).contains("\"loginAllowed\":true");
        assertThat(login(email, password, slug).getStatusCode().value()).isEqualTo(200);
    }

    /**
     * The platform vocabulary has six values and {@code auth_tenants} effectively has two meanings.
     * Every non-ACTIVE platform status must land on something login refuses; the mapping is closed,
     * so a status this service has never heard of is rejected rather than guessed at. A guess that
     * fell through to ACTIVE would turn an unrecognised suspension into a working login.
     */
    @Test
    void setStatus_everyNonActivePlatformStatus_isRefusedAtLogin() {
        for (String platformStatus : new String[]{
            "PENDING_SETUP", "SUSPENDED", "CANCELLED", "PURGED", "PROVISIONING_FAILED"}) {

            UUID tenantId = UUID.randomUUID();
            // '_' is not a legal slug character — the platform's own slugify never emits one — so
            // the label has to be transliterated or register rejects it before the status is
            // reached. (It did, on the first run of this test.)
            String slug = slug("vocab-" + platformStatus.toLowerCase().replace('_', '-'));
            String email = "vocab@" + slug + ".local";
            String password = "Vocab#2026aB";

            post(TENANTS, registerBody(tenantId, slug, "Vocab Co"), INTERNAL_SECRET);
            seedLoginableUser(tenantId, email, password);
            assertThat(login(email, password, slug).getStatusCode().value()).isEqualTo(200);

            ResponseEntity<String> patched =
                patch(TENANTS + "/" + tenantId + "/status", Map.of("status", platformStatus), INTERNAL_SECRET);

            assertThat(patched.getStatusCode().value())
                .as("%s is a real platform status and must be accepted", platformStatus)
                .isEqualTo(200);
            assertThat(patched.getBody())
                .as("%s must not permit a login", platformStatus)
                .contains("\"loginAllowed\":false");
            assertThat(login(email, password, slug).getStatusCode().value())
                .as("login under %s", platformStatus)
                .isEqualTo(401);
        }
    }

    @Test
    void setStatus_withAnUnrecognisedStatus_isRejectedRatherThanGuessedAt() {
        UUID tenantId = UUID.randomUUID();
        String slug = slug("unknown-status");
        post(TENANTS, registerBody(tenantId, slug, "Unknown Status Co"), INTERNAL_SECRET);

        ResponseEntity<String> response =
            patch(TENANTS + "/" + tenantId + "/status", Map.of("status", "DORMANT"), INTERNAL_SECRET);

        assertThat(response.getStatusCode().value()).isEqualTo(409);
        assertThat(response.getBody()).contains("DORMANT");
        assertThat(tenantRow(tenantId).get("status"))
            .as("a rejected status must not have been written")
            .isEqualTo("ACTIVE");
    }

    @Test
    void setStatus_forAnUnknownTenant_returns404() {
        ResponseEntity<String> response =
            patch(TENANTS + "/" + UUID.randomUUID() + "/status", Map.of("status", "SUSPENDED"), INTERNAL_SECRET);

        assertThat(response.getStatusCode().value()).isEqualTo(404);
    }

    // ══ Task 2: provisioning an admin who can actually log in (D-05, D-12, D-13) ═════════════

    /**
     * Behaviour 1 + 2, and the whole point of blocker B2: before this plan, {@code provisionAdmin}
     * created the user row and stopped. A user with no active branch assignment cannot log in at
     * all — {@code PermissionResolver.selectDefaultBranch} throws "has no active branch
     * assignments" before a token is ever minted — so the tenant admin the platform API reported
     * creating was, in every case, an account nobody could ever use.
     */
    @Test
    void provisionAdmin_createsTheUserAndItsOwnerAssignmentTogether() {
        Tenant tenant = registeredTenant("provision");
        UUID branchId = UUID.randomUUID();

        ResponseEntity<String> response = post(provisionPath(tenant.id()),
            provisionBody("owner@" + tenant.slug() + ".local", branchId, "OWNER", "Ada Owner"),
            INTERNAL_SECRET);

        assertThat(response.getStatusCode().value()).isEqualTo(201);
        UUID userId = UUID.fromString(field(response.getBody(), "userId"));

        Map<String, Object> user = jdbc.queryForMap("SELECT * FROM users WHERE id = ?", userId);
        assertThat(user.get("email")).isEqualTo("owner@" + tenant.slug() + ".local");
        assertThat(user.get("full_name")).isEqualTo("Ada Owner");
        assertThat(user.get("must_change_password"))
            .as("a temporary credential must be changed on first use")
            .isEqualTo(true);
        assertThat(user.get("is_active")).isEqualTo(true);

        Map<String, Object> assignment = jdbc.queryForMap(
            "SELECT * FROM user_branch_roles WHERE user_id = ? AND is_active", userId);
        assertThat(assignment.get("role_code")).isEqualTo("OWNER");
        assertThat(assignment.get("branch_id")).isEqualTo(branchId);
        assertThat(assignment.get("tenant_id")).isEqualTo(tenant.id());
        // Primary is what makes default-branch selection deterministic after 13-02 replaced the
        // hardcoded HQ uuid. Without it the admin's landing branch is whichever id sorts lowest.
        assertThat(assignment.get("is_primary")).isEqualTo(true);

        assertThat(field(response.getBody(), "tempPassword"))
            .as("returned exactly once, in the response")
            .isNotBlank();
    }

    /**
     * The acceptance criterion that matters: not "a row exists" but "the thing that reads the row
     * at login succeeds and yields OWNER's authority". A row can be present and still resolve to
     * nothing.
     */
    @Test
    void provisionAdmin_theNewAdminResolvesTheOwnerPermissionSet() {
        Tenant tenant = registeredTenant("resolve");
        UUID branchId = UUID.randomUUID();

        ResponseEntity<String> created = post(provisionPath(tenant.id()),
            provisionBody("resolve@" + tenant.slug() + ".local", branchId, "OWNER", "Res Olve"),
            INTERNAL_SECRET);
        UUID userId = UUID.fromString(field(created.getBody(), "userId"));

        ResponseEntity<String> permissions = get(
            "/internal/auth/users/" + userId + "/permissions", tenant.id());

        assertThat(permissions.getStatusCode().value()).isEqualTo(200);
        assertThat(permissions.getBody()).contains("OWNER");
        assertThat(permissions.getBody()).contains("rbac.manage");
        assertThat(permissions.getBody()).contains("\"branchId\":\"" + branchId + "\"");
    }

    /**
     * Behaviour 2: the temp password is a working credential, not merely a returned string.
     *
     * <p><b>Updated by 13-08, and the update makes it stronger rather than weaker.</b> This
     * provisioned admin carries {@code must_change_password}, which until 13-08 was written here
     * and read nowhere. Now it governs login, so the first attempt is answered
     * {@code 403 PASSWORD_CHANGE_REQUIRED} instead of a token — which is the plan's decision record
     * arriving on this path: "every caller that provisions a user must expect its first login to be
     * refused". The temp password is still what proves the credential works; it now has to prove it
     * twice, once to earn the change token and once to spend it.
     *
     * <p>Provisioned as CASHIER rather than OWNER on purpose, so that after the change the login
     * completes with a token and the assertion is unambiguous. OWNER meets a second gate — see
     * {@link #provisionAdmin_asOwner_getsPastBranchResolutionAndIsAskedToEnrolTotp()}.
     */
    @Test
    void provisionAdmin_theReturnedTempPasswordActuallyAuthenticates() {
        Tenant tenant = registeredTenant("templogin");
        String email = "templogin@" + tenant.slug() + ".local";

        ResponseEntity<String> created = post(provisionPath(tenant.id()),
            provisionBody(email, UUID.randomUUID(), "CASHIER", "Temp Login"), INTERNAL_SECRET);
        String tempPassword = field(created.getBody(), "tempPassword");

        ResponseEntity<String> firstLogin = login(email, tempPassword, tenant.slug());

        assertThat(firstLogin.getStatusCode().value())
            .as("the temp password is accepted, and the account is told to change it (13-08, D-17)")
            .isEqualTo(403);
        assertThat(firstLogin.getBody())
            .contains("PASSWORD_CHANGE_REQUIRED")
            .doesNotContain("accessToken");

        assertThat(forcedChange(changeToken(firstLogin.getBody()), tempPassword, POST_CHANGE_PASSWORD)
            .getStatusCode().value()).isEqualTo(200);

        ResponseEntity<String> secondLogin = login(email, POST_CHANGE_PASSWORD, tenant.slug());
        assertThat(secondLogin.getStatusCode().value())
            .as("a provisioned admin who cannot log in is the entire content of blocker B2")
            .isEqualTo(200);
        assertThat(secondLogin.getBody()).contains("accessToken");
    }

    /**
     * The OWNER case — the account that needs BOTH gates, asserted in the order it meets them.
     *
     * <p>A freshly provisioned OWNER carries two independent obligations, and after 13-08 it
     * satisfies them one at a time:
     *
     * <ol>
     *   <li><b>{@code 403 PASSWORD_CHANGE_REQUIRED}</b> first, because the account holds a
     *       temporary password (D-17). The forced-change branch sits before permission resolution,
     *       so it is reached whatever the role.</li>
     *   <li><b>{@code 401 TOTP_ENROLLMENT_REQUIRED}</b> on the very next login, because OWNER holds
     *       {@code rbac.manage} and {@code requiresTotpStepUp} fires on it while the fresh account
     *       has no enrolled secret. That is D-29a, and neither plan suppresses it.</li>
     * </ol>
     *
     * <p><b>That order is the right one</b>, not merely the one that fell out. Enrolling a second
     * factor while the first is still a temporary password known to whoever provisioned the account
     * would bind the factor under a credential the user does not exclusively control.
     *
     * <p>What matters for blocker B2 is unchanged and still asserted: neither refusal is
     * {@code "has no active branch assignments"} or a credential failure. Reaching
     * TOTP_ENROLLMENT_REQUIRED at all is proof that the branch assignment resolved, because
     * {@code enforceTotpStepUp} runs AFTER {@code permissionResolver.resolveDefault}. Before 13-06
     * this request died earlier, at resolution.
     */
    @Test
    void provisionAdmin_asOwner_getsPastBranchResolutionAndIsAskedToEnrolTotp() {
        Tenant tenant = registeredTenant("ownerlogin");
        String email = "ownerlogin@" + tenant.slug() + ".local";

        ResponseEntity<String> created = post(provisionPath(tenant.id()),
            provisionBody(email, UUID.randomUUID(), "OWNER", "Owner Login"), INTERNAL_SECRET);
        String tempPassword = field(created.getBody(), "tempPassword");

        ResponseEntity<String> firstLogin = login(email, tempPassword, tenant.slug());
        assertThat(firstLogin.getStatusCode().value())
            .as("gate one: the temporary credential must be replaced before anything else (D-17)")
            .isEqualTo(403);
        assertThat(firstLogin.getBody()).contains("PASSWORD_CHANGE_REQUIRED");

        assertThat(forcedChange(changeToken(firstLogin.getBody()), tempPassword, POST_CHANGE_PASSWORD)
            .getStatusCode().value()).isEqualTo(200);

        ResponseEntity<String> secondLogin = login(email, POST_CHANGE_PASSWORD, tenant.slug());
        assertThat(secondLogin.getBody())
            .as("gate two: the credential and the branch assignment both resolved; only the second "
                + "factor is missing (D-29a)")
            .contains("TOTP_ENROLLMENT_REQUIRED");
        assertThat(secondLogin.getBody())
            .as("this is the failure blocker B2 is about, and it must be gone")
            .doesNotContain("no active branch assignments");
        assertThat(secondLogin.getBody())
            .as("nor is it a credential failure")
            .doesNotContain("Invalid credentials");
    }

    // ── Behaviour 3: D-13, an unvalidated role code is a permissionless login ─────────────────

    /**
     * Today an arbitrary string persists. The user then logs in successfully and holds NO
     * permissions at all, because {@code role_permissions} has no rows for a code that is not in
     * the catalog — which presents to the user as a working login into an empty product, and to an
     * administrator as a role that was assigned. That is why this is validated rather than trusted.
     */
    @Test
    void provisionAdmin_withAnUnknownRoleCode_returns400AndWritesNothing() {
        Tenant tenant = registeredTenant("badrole");
        String email = "badrole@" + tenant.slug() + ".local";

        ResponseEntity<String> response = post(provisionPath(tenant.id()),
            provisionBody(email, UUID.randomUUID(), "OWNERR", "Typo Squatter"), INTERNAL_SECRET);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
        assertThat(response.getBody()).contains("UNKNOWN_ROLE_CODE");
        assertThat(response.getBody())
            .as("naming the rejected code is what makes this actionable")
            .contains("OWNERR");
        assertThat(count("SELECT count(*) FROM users WHERE email = ?", email))
            .as("rejected before anything was written")
            .isZero();
    }

    /** The same validation must hold on the other door — the internal branch-role assign path. */
    @Test
    void assignBranchRole_withAnUnknownRoleCode_returns400AndWritesNothing() {
        Tenant tenant = registeredTenant("assignbadrole");
        UUID branchId = UUID.randomUUID();
        ResponseEntity<String> created = post(provisionPath(tenant.id()),
            provisionBody("assign@" + tenant.slug() + ".local", branchId, "OWNER", "As Sign"),
            INTERNAL_SECRET);
        UUID userId = UUID.fromString(field(created.getBody(), "userId"));

        // The acting user is the OWNER just provisioned — 13-11 requires an identity here, and an
        // owner holds the whole catalogue, so the refusal below can only be about the role CODE.
        ResponseEntity<String> response = post(
            "/internal/auth/users/" + userId + "/branch-roles",
            Map.of("branchId", UUID.randomUUID().toString(), "roleCode", "SUPERVISOR"),
            INTERNAL_SECRET, tenant.id(), userId);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
        assertThat(response.getBody()).contains("UNKNOWN_ROLE_CODE");
        assertThat(response.getBody()).contains("SUPERVISOR");
        assertThat(count("SELECT count(*) FROM user_branch_roles WHERE role_code = ?", "SUPERVISOR"))
            .isZero();
        assertThat(count("SELECT count(*) FROM user_branch_roles WHERE user_id = ?", userId))
            .as("and must not have displaced the assignment the user already held")
            .isEqualTo(1);
    }

    /**
     * A known code is accepted, which is what stops the test above from passing against a
     * validator that rejects everything.
     */
    @Test
    void assignBranchRole_withAKnownRoleCode_stillSucceeds() {
        Tenant tenant = registeredTenant("assigngoodrole");
        ResponseEntity<String> created = post(provisionPath(tenant.id()),
            provisionBody("good@" + tenant.slug() + ".local", UUID.randomUUID(), "OWNER", "Good Role"),
            INTERNAL_SECRET);
        UUID userId = UUID.fromString(field(created.getBody(), "userId"));

        ResponseEntity<String> response = post(
            "/internal/auth/users/" + userId + "/branch-roles",
            Map.of("branchId", UUID.randomUUID().toString(), "roleCode", "MANAGER"),
            INTERNAL_SECRET, tenant.id(), userId);

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(count("SELECT count(*) FROM user_branch_roles WHERE user_id = ? AND role_code = 'MANAGER'",
            userId)).isEqualTo(1);
    }

    // ── Behaviour 4: no admin may be created without an assignment ────────────────────────────

    @Test
    void provisionAdmin_withoutABranchId_isRejectedRatherThanCreatingAStrandedUser() {
        Tenant tenant = registeredTenant("nobranch");
        String email = "nobranch@" + tenant.slug() + ".local";
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("email", email);
        body.put("roleCode", "OWNER");

        ResponseEntity<String> response = post(provisionPath(tenant.id()), body, INTERNAL_SECRET);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
        assertThat(count("SELECT count(*) FROM users WHERE email = ?", email))
            .as("a user with no assignment cannot log in, so a partial success is worse than a "
                + "clean failure")
            .isZero();
    }

    @Test
    void provisionAdmin_withoutARoleCode_isRejected() {
        Tenant tenant = registeredTenant("norole");
        String email = "norole@" + tenant.slug() + ".local";
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("email", email);
        body.put("branchId", UUID.randomUUID().toString());

        ResponseEntity<String> response = post(provisionPath(tenant.id()), body, INTERNAL_SECRET);

        assertThat(response.getStatusCode().value()).isEqualTo(400);
        assertThat(count("SELECT count(*) FROM users WHERE email = ?", email)).isZero();
    }

    // ── Behaviour 6: no duplicate admin for a tenant ──────────────────────────────────────────

    @Test
    void provisionAdmin_forAnEmailAlreadyInTheTenant_isRejected() {
        Tenant tenant = registeredTenant("duplicate");
        String email = "dupe@" + tenant.slug() + ".local";
        post(provisionPath(tenant.id()), provisionBody(email, UUID.randomUUID(), "OWNER", "First"),
            INTERNAL_SECRET);

        ResponseEntity<String> second = post(provisionPath(tenant.id()),
            provisionBody(email, UUID.randomUUID(), "OWNER", "Second"), INTERNAL_SECRET);

        assertThat(second.getStatusCode().value()).isEqualTo(409);
        assertThat(second.getBody()).contains("STATE_INVALID");
        assertThat(count("SELECT count(*) FROM users WHERE email = ?", email))
            .as("rejected before a second temp password was even generated")
            .isEqualTo(1);
    }

    /**
     * Casing is not a second identity. Login lower-cases the address before looking it up, so an
     * admin provisioned as {@code Owner@x} was previously stored verbatim and could never be found
     * at login — a provisioned account that silently does not work, which is this blocker's exact
     * shape.
     */
    @Test
    void provisionAdmin_normalisesTheEmailSoTheAdminCanBeFoundAtLogin() {
        Tenant tenant = registeredTenant("casing");
        String mixedCase = "MixedCase@" + tenant.slug() + ".local";

        // CASHIER, so the login below completes rather than stopping at TOTP enrolment.
        ResponseEntity<String> created = post(provisionPath(tenant.id()),
            provisionBody(mixedCase, UUID.randomUUID(), "CASHIER", "Mixed Case"), INTERNAL_SECRET);
        UUID userId = UUID.fromString(field(created.getBody(), "userId"));

        assertThat(jdbc.queryForMap("SELECT * FROM users WHERE id = ?", userId).get("email"))
            .isEqualTo(mixedCase.toLowerCase());
        // 403 PASSWORD_CHANGE_REQUIRED, not 200, since 13-08 — and it proves the same thing more
        // sharply than the 200 did. That branch is only reached after the address resolved to a row
        // AND the password matched; an address that resolves to nothing yields the generic 401.
        assertThat(login(mixedCase, field(created.getBody(), "tempPassword"), tenant.slug())
            .getBody())
            .as("the mixed-case address found the account and the password matched")
            .contains("PASSWORD_CHANGE_REQUIRED");

        ResponseEntity<String> duplicate = post(provisionPath(tenant.id()),
            provisionBody(mixedCase.toUpperCase(), UUID.randomUUID(), "CASHIER", "Shouty"),
            INTERNAL_SECRET);
        assertThat(duplicate.getStatusCode().value())
            .as("and the duplicate check must see through casing too")
            .isEqualTo(409);
    }

    // ── Behaviour 5: the two writes share one transaction ─────────────────────────────────────

    /**
     * The rollback assertion the plan asks for, and it is not decorative. {@code provisionAdmin}
     * saves the user and then calls {@code BranchRoleAdminService.assign}; both must live or both
     * must die. Two ways to get this wrong are entirely plausible and neither is visible by reading
     * the happy path: {@code assign} could be reached with {@code REQUIRES_NEW} propagation, or
     * {@code provisionAdmin} could catch the failure and return the user anyway "so provisioning
     * makes progress". Either would leave a user with no assignment — an account that authenticates
     * against nothing and cannot log in, which is precisely the state blocker B2 describes.
     *
     * <p>Forcing the second write to fail needs a stub: there is no input that passes role
     * validation and then fails at the database, which is itself a good property. The spy delegates
     * to the real bean in every other test in this class, and Spring resets it between methods.
     */
    @Test
    void provisionAdmin_whenTheBranchRoleWriteFails_theUserDoesNotSurvive() {
        Tenant tenant = registeredTenant("rollback");
        String email = "rollback@" + tenant.slug() + ".local";
        doThrow(new IllegalStateException("branch-role write failed"))
            .when(branchRoleAdminService).assign(any(), any(), any());

        ResponseEntity<String> response = post(provisionPath(tenant.id()),
            provisionBody(email, UUID.randomUUID(), "OWNER", "Roll Back"), INTERNAL_SECRET);

        assertThat(response.getStatusCode().value())
            .as("the failure must surface, not be absorbed")
            .isEqualTo(500);
        assertThat(count("SELECT count(*) FROM users WHERE email = ?", email))
            .as("the user row must not have survived its assignment failing")
            .isZero();
        assertThat(count("SELECT count(*) FROM user_branch_roles WHERE tenant_id = ?", tenant.id()))
            .isZero();
    }

    // ── The gate, on the extended operation ──────────────────────────────────────────────────

    @Test
    void provisionAdmin_withoutInternalSecret_returns403() {
        ResponseEntity<String> response = post(provisionPath(UUID.randomUUID()),
            provisionBody("nobody@nowhere.local", UUID.randomUUID(), "OWNER", "No Body"), null);

        assertThat(response.getStatusCode().value()).isEqualTo(403);
        assertThat(response.getBody()).contains("INTERNAL_AUTH_REQUIRED");
        assertThat(response.getBody()).doesNotContain("tempPassword");
    }

    // ── The premise the whole service rests on ───────────────────────────────────────────────

    /**
     * {@code AuthTenantProvisioningService} deliberately sets no tenant GUC, which reads as a bug
     * next to every other write path in this service. It is correct only because {@code
     * auth_tenants} is the pre-tenant-context lookup login performs BEFORE any GUC can exist, and is
     * therefore not row-level-security scoped. If someone later enables RLS on this table, the
     * service stops working and the javadoc explaining why it sets no GUC becomes actively
     * misleading — so the premise is pinned here rather than left as a comment.
     */
    @Test
    void authTenants_isNotRowLevelSecurityScoped() {
        Long scoped = jdbc.queryForObject(
            "SELECT count(*) FROM pg_class WHERE relname = 'auth_tenants' "
                + "AND (relrowsecurity = true OR relforcerowsecurity = true)", Long.class);

        assertThat(scoped)
            .as("auth_tenants must stay RLS-free; login resolves it before any tenant context exists")
            .isZero();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    /** Unique per test method AND per run, so no assertion depends on another test's leftovers. */
    private static String slug(String label) {
        return "t13-06-" + label + "-" + UUID.randomUUID().toString().substring(0, 8);
    }

    private record Tenant(UUID id, String slug) {}

    /** A registered auth tenant, created the way the saga will: through the real endpoint. */
    private Tenant registeredTenant(String label) {
        UUID tenantId = UUID.randomUUID();
        String slug = slug(label);
        ResponseEntity<String> response =
            post(TENANTS, registerBody(tenantId, slug, "Tenant " + label), INTERNAL_SECRET);
        assertThat(response.getStatusCode().value())
            .as("test setup: registering tenant %s", slug)
            .isEqualTo(200);
        return new Tenant(tenantId, slug);
    }

    private static String provisionPath(UUID tenantId) {
        return TENANTS + "/" + tenantId + "/provision-admin";
    }

    private static Map<String, Object> provisionBody(String email, UUID branchId, String roleCode,
                                                     String fullName) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("email", email);
        body.put("branchId", branchId.toString());
        body.put("roleCode", roleCode);
        body.put("fullName", fullName);
        return body;
    }

    /**
     * Pull the single-use change token out of a {@code 403 PASSWORD_CHANGE_REQUIRED} refusal.
     *
     * <p>It travels in the standard error envelope's {@code details} array as
     * {@code {"field":"changeToken","issue":"<token>"}}, so the whole pair is matched rather than
     * the first {@code "issue"} in the document — the array also carries {@code expiresAt}, and a
     * looser match would silently start returning the wrong one if the order ever changed.
     */
    private static String changeToken(String json) {
        String marker = "\"field\":\"changeToken\",\"issue\":\"";
        int start = json.indexOf(marker);
        assertThat(start).as("a changeToken detail in %s", json).isNotNegative();
        start += marker.length();
        return json.substring(start, json.indexOf('"', start));
    }

    /**
     * Drive {@code POST /api/v1/auth/change-password/forced}. Public at both layers, so no token
     * and no internal secret — the change token plus the current password are the whole of the
     * authorization.
     */
    private ResponseEntity<String> forcedChange(String changeToken, String currentPassword,
                                                String newPassword) {
        return post("/api/v1/auth/change-password/forced",
            Map.of("changeToken", changeToken,
                "currentPassword", currentPassword,
                "newPassword", newPassword),
            null);
    }

    /** Pull a top-level string out of the ApiResponse envelope's data object. */
    private static String field(String json, String name) {
        String marker = "\"" + name + "\":\"";
        int start = json.indexOf(marker);
        assertThat(start).as("field '%s' present in %s", name, json).isNotNegative();
        start += marker.length();
        return json.substring(start, json.indexOf('"', start));
    }

    private static Map<String, Object> registerBody(UUID tenantId, String slug, String name) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("tenantId", tenantId.toString());
        body.put("slug", slug);
        body.put("name", name);
        return body;
    }

    /**
     * A user who can actually complete a login in the given tenant: the row itself, plus the active
     * branch-role assignment without which {@code PermissionResolver} throws before a token is ever
     * minted. Written with SQL because the public user API does not exist yet.
     */
    private void seedLoginableUser(UUID tenantId, String email, String password) {
        UUID userId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id, tenant_id, email, password_hash, full_name, "
                + "totp_enabled, is_active, failed_login_count, must_change_password) "
                + "VALUES (?, ?, ?, ?, ?, false, true, 0, false)",
            userId, tenantId, email, passwordEncoder.encode(password), "Seeded " + email);
        jdbc.update("INSERT INTO user_branch_roles (id, tenant_id, user_id, branch_id, role_code, "
                + "is_active, is_primary) VALUES (?, ?, ?, ?, 'CASHIER', true, true)",
            UUID.randomUUID(), tenantId, userId, branchId);
    }

    private ResponseEntity<String> login(String email, String password, String tenantSlug) {
        return post("/api/v1/auth/login",
            Map.of("email", email, "password", password, "tenantSlug", tenantSlug), null);
    }

    private Map<String, Object> tenantRow(UUID tenantId) {
        return jdbc.queryForMap("SELECT * FROM auth_tenants WHERE id = ?", tenantId);
    }

    private long count(String sql, Object arg) {
        Long n = jdbc.queryForObject(sql, Long.class, arg);
        return n == null ? 0L : n;
    }

    private ResponseEntity<String> post(String uri, Object body, String secret) {
        return post(uri, body, secret, null);
    }

    private ResponseEntity<String> post(String uri, Object body, String secret, UUID tenantId) {
        return post(uri, body, secret, tenantId, null);
    }

    /**
     * {@code actingUserId} is 13-11's {@code X-Acting-User-Id} — required on the branch-role write
     * path, whose own permissions bound what the request may grant.
     */
    private ResponseEntity<String> post(String uri, Object body, String secret, UUID tenantId,
                                        UUID actingUserId) {
        RestClient.RequestBodySpec spec = rest.post().uri(uri).contentType(MediaType.APPLICATION_JSON);
        if (secret != null) {
            spec = spec.header(InternalServiceFilter.HEADER, secret);
        }
        if (tenantId != null) {
            spec = spec.header("X-Tenant-Id", tenantId.toString());
        }
        if (actingUserId != null) {
            spec = spec.header("X-Acting-User-Id", actingUserId.toString());
        }
        return spec.body(body).exchange((request, response) -> toEntity(response));
    }

    private ResponseEntity<String> get(String uri, UUID tenantId) {
        var spec = rest.get().uri(uri).header(InternalServiceFilter.HEADER, INTERNAL_SECRET);
        if (tenantId != null) {
            spec = spec.header("X-Tenant-Id", tenantId.toString());
        }
        return spec.exchange((request, response) -> toEntity(response));
    }

    private ResponseEntity<String> patch(String uri, Object body, String secret) {
        RestClient.RequestBodySpec spec = rest.patch().uri(uri).contentType(MediaType.APPLICATION_JSON);
        if (secret != null) {
            spec = spec.header(InternalServiceFilter.HEADER, secret);
        }
        return spec.body(body).exchange((request, response) -> toEntity(response));
    }

    private static ResponseEntity<String> toEntity(org.springframework.http.client.ClientHttpResponse response)
            throws java.io.IOException {
        byte[] bytes = response.getBody() != null ? response.getBody().readAllBytes() : new byte[0];
        return ResponseEntity.status(response.getStatusCode())
            .body(new String(bytes, StandardCharsets.UTF_8));
    }
}
