package io.restaurantos.auth.integration;

import io.restaurantos.auth.config.InternalServiceFilter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.client.RestClient;

import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

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

    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwordEncoder;

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
        RestClient.RequestBodySpec spec = rest.post().uri(uri).contentType(MediaType.APPLICATION_JSON);
        if (secret != null) {
            spec = spec.header(InternalServiceFilter.HEADER, secret);
        }
        return spec.body(body).exchange((request, response) -> toEntity(response));
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
