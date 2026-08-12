package io.restaurantos.auth.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.samstevens.totp.code.DefaultCodeGenerator;
import dev.samstevens.totp.secret.DefaultSecretGenerator;
import dev.samstevens.totp.time.SystemTimeProvider;
import io.restaurantos.auth.entity.UserBranchRoleEntity;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.repository.UserBranchRoleRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The role BUILDER (S3) — composing a tenant's own role out of the permission catalogue, and the
 * three ways that could have been a privilege-escalation path instead of a feature.
 *
 * <h2>What was missing and why the read side was not enough</h2>
 *
 * <p>13-07 shipped both reads a role picker needs — {@code GET /api/v1/roles} and
 * {@code GET /api/v1/permissions} — and nothing that could write one. The product register measured
 * the consequence: {@code /app/roles} 404, an assign dialog offering a fixed list of eight, and
 * "nowhere in the product can anyone see what a role actually grants". This file asserts the write
 * side end to end, through the real HTTP stack with real signed tokens, because the subject matter
 * is authorization and an over-permissive implementation is indistinguishable from a correct one in
 * a diff.
 *
 * <h2>The three refusals that make this safe</h2>
 *
 * <ol>
 *   <li><b>The ceiling applies to composition.</b> {@link #tenantAdmin_composingARoleAboveItsOwnCeiling_isRefused()}
 *       is the test that fails without {@code RoleAdminService.requireWithinCeiling}: a TENANT_ADMIN
 *       who is refused 403 when ASSIGNING OWNER would otherwise simply build "Head Waiter" carrying
 *       {@code rbac.manage} and assign that instead.</li>
 *   <li><b>Grants are tenant-scoped.</b> {@link #anotherTenantsRoleOfTheSameCode_grantsNothingHere()}
 *       is the test that fails without changeset 092: {@code role_permissions} was keyed on
 *       (role_code, permission_code) alone, so two tenants that both name a role HEAD_WAITER shared
 *       one grant set and each silently inherited the other's permissions.</li>
 *   <li><b>Built-in roles are not editable.</b> A tenant row sharing a system role's code is the one
 *       collision the tenant-scoped catalogue cannot resolve.</li>
 * </ol>
 *
 * <h2>The proof that the role is real</h2>
 *
 * <p>{@link #aUserHoldingTheNewRole_signsInWithExactlyWhatWasTicked()} does not inspect a table. It
 * assigns the role to a user, logs that user in, and decodes the permissions claim off the issued
 * JWT — which is the only artefact that decides what the product lets them do. A role that exists in
 * three tables and does not reach a token is the "structurally present, behaviourally absent" shape
 * this codebase keeps producing.
 */
class CustomRoleBuilderIT extends BaseIntegrationTest {

    private static final String ROLES = "/api/v1/roles";

    /** A TENANT_ADMIN of the demo tenant — the persona the ceiling rule is about. */
    private static final UUID TADMIN_ID = UUID.fromString("c0000041-0000-4000-8000-000000000041");
    private static final String TADMIN_EMAIL = "rolebuilder-admin@demo.local";
    private static final String TADMIN_PASSWORD = "Builder#2026";

    /** The person the built role is handed to. */
    private static final UUID HOLDER_ID = UUID.fromString("c0000042-0000-4000-8000-000000000042");
    private static final String HOLDER_EMAIL = "headwaiter@demo.local";
    private static final String HOLDER_PASSWORD = "Holder#2026";
    private static final UUID HOLDER_ASSIGNMENT_ID = UUID.fromString("d0000042-0000-4000-8000-000000000042");

    /** A neighbouring tenant that will define a role under the SAME code. */
    private static final UUID OTHER_TENANT_ID = UUID.fromString("a0000098-0000-4000-8000-000000000098");
    private static final UUID OTHER_TENANT_ROLE_ID = UUID.fromString("d0000098-0000-4000-8000-000000000098");

    private static final String HEAD_WAITER_CODE = "HEAD_WAITER";

    /**
     * The subset ticked. Deliberately all POS codes and deliberately NOT any {@code rbac.*} code:
     * a role carrying {@code rbac.manage} or {@code finance.period.close} would trip the TOTP
     * step-up at login (D-29a) and this file's whole point is that the holder can sign in.
     */
    private static final List<String> TICKED = List.of(
        "pos.order.create", "pos.order.view", "pos.order.update", "pos.tables.manage");

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final DefaultSecretGenerator secretGenerator = new DefaultSecretGenerator();
    private final DefaultCodeGenerator codeGenerator = new DefaultCodeGenerator();
    private final SystemTimeProvider timeProvider = new SystemTimeProvider();

    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwordEncoder;
    @Autowired UserBranchRoleRepository userBranchRoleRepository;

    private String ownerTotpSecret;
    private String tadminTotpSecret;

    @BeforeEach
    void seedPersonas() {
        setRls(TestFixtures.demoTenantId());
        cleanUp();

        ownerTotpSecret = secretGenerator.generate();
        UserEntity owner = userRepository.findByEmail(TestFixtures.OWNER_EMAIL).orElseThrow();
        owner.setTotpSecret(ownerTotpSecret);
        owner.setTotpEnabled(true);
        userRepository.save(owner);

        tadminTotpSecret = secretGenerator.generate();
        saveUser(TADMIN_ID, TADMIN_EMAIL, TADMIN_PASSWORD, "Role Builder Admin", tadminTotpSecret);
        assign(UUID.fromString("d0000041-0000-4000-8000-000000000041"), TADMIN_ID, "TENANT_ADMIN");

        saveUser(HOLDER_ID, HOLDER_EMAIL, HOLDER_PASSWORD, "Hira the Head Waiter", null);
    }

    @AfterEach
    void restoreState() {
        setRls(TestFixtures.demoTenantId());
        userRepository.findByEmail(TestFixtures.OWNER_EMAIL).ifPresent(owner -> {
            owner.setTotpSecret(null);
            owner.setTotpEnabled(false);
            userRepository.save(owner);
        });
        cleanUp();
    }

    private void cleanUp() {
        jdbc.update("DELETE FROM user_branch_roles WHERE user_id IN (?, ?)", HOLDER_ID, TADMIN_ID);
        jdbc.update("DELETE FROM role_permissions WHERE tenant_id IS NOT NULL");
        jdbc.update("DELETE FROM roles WHERE tenant_id IS NOT NULL");
    }

    // ── The happy path, all the way to a token ────────────────────────────────────────────────

    @Test
    @DisplayName("an owner composes a role from the catalogue and it appears with exactly what was ticked")
    void owner_composesARoleFromTheCatalogue() throws Exception {
        ResponseEntity<String> created = post(ROLES, ownerToken(), body("Head Waiter", TICKED));

        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        JsonNode data = objectMapper.readTree(created.getBody()).path("data");
        assertThat(data.path("code").asText())
            .as("the code is DERIVED from the name — a caller-supplied one could be OWNER")
            .isEqualTo(HEAD_WAITER_CODE);
        assertThat(data.path("name").asText()).isEqualTo("Head Waiter");
        assertThat(data.path("system").asBoolean()).isFalse();
        assertThat(textValues(data.path("permissions"))).containsExactlyElementsOf(TICKED.stream().sorted().toList());

        JsonNode listed = entryWithCode(
            objectMapper.readTree(get(ROLES, ownerToken()).getBody()).path("data"), HEAD_WAITER_CODE);
        assertThat(textValues(listed.path("permissions")))
            .as("the catalogue read and the write agree; a role that only exists in the POST "
                + "response is the failure this product keeps shipping")
            .containsExactlyElementsOf(TICKED.stream().sorted().toList());
        assertThat(listed.path("assignedUserCount").asLong())
            .as("nobody holds it yet")
            .isZero();
    }

    /**
     * The whole point: the role reaches a real session.
     *
     * <p>Asserts the NEGATIVE too. A permissions claim that merely CONTAINS what was ticked would
     * also be satisfied by a bug that granted everything, which is the direction that matters here.
     */
    @Test
    @DisplayName("a user holding the new role signs in with exactly what was ticked, and nothing else")
    void aUserHoldingTheNewRole_signsInWithExactlyWhatWasTicked() throws Exception {
        assertThat(post(ROLES, ownerToken(), body("Head Waiter", TICKED)).getStatusCode())
            .isEqualTo(HttpStatus.CREATED);
        assign(HOLDER_ASSIGNMENT_ID, HOLDER_ID, HEAD_WAITER_CODE);

        List<String> claim = permissionsInToken(login(HOLDER_EMAIL, HOLDER_PASSWORD, null));

        assertThat(claim).containsExactlyElementsOf(TICKED.stream().sorted().toList());
        assertThat(claim)
            .as("a custom role must not inherit the platform vocabulary it did not ask for")
            .doesNotContain("rbac.manage", "rbac.role.manage", "pos.order.void.any");
    }

    /**
     * "Edit the role to remove a permission and confirm the change reaches that user's next
     * session" — the acceptance criterion, asserted as two logins around one PUT.
     */
    @Test
    @DisplayName("removing a permission from the role removes it from the holder's NEXT session")
    void editingTheRole_reachesTheHoldersNextSession() throws Exception {
        post(ROLES, ownerToken(), body("Head Waiter", TICKED));
        assign(HOLDER_ASSIGNMENT_ID, HOLDER_ID, HEAD_WAITER_CODE);

        assertThat(permissionsInToken(login(HOLDER_EMAIL, HOLDER_PASSWORD, null)))
            .as("before the edit")
            .contains("pos.order.update");

        List<String> reduced = TICKED.stream().filter(c -> !c.equals("pos.order.update")).toList();
        ResponseEntity<String> updated =
            put(ROLES + "/" + HEAD_WAITER_CODE, ownerToken(), body("Head Waiter", reduced));
        assertThat(updated.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(objectMapper.readTree(updated.getBody()).path("data").path("assignedUserCount").asLong())
            .as("the edit response counts the real holders rather than defaulting to zero")
            .isEqualTo(1L);

        assertThat(permissionsInToken(login(HOLDER_EMAIL, HOLDER_PASSWORD, null)))
            .as("after the edit, on the holder's next sign-in")
            .containsExactlyElementsOf(reduced.stream().sorted().toList());
    }

    // ── Refusal 1: the ceiling applies to COMPOSITION, not only to assignment ──────────────────

    /**
     * FALSIFICATION TARGET. Delete {@code requireWithinCeiling} from
     * {@code RoleAdminService.create} and this answers 201, at which point the tenant admin holds a
     * role granting {@code rbac.manage} — the umbrella permission 13-02 split the
     * tenant-administration authority precisely in order to withhold from them.
     *
     * <p>The positive half is asserted in the same test so this cannot be satisfied by an endpoint
     * that refuses a tenant admin everything.
     */
    @Test
    @DisplayName("a tenant admin composing a role above its own ceiling is refused ROLE_CEILING_EXCEEDED")
    void tenantAdmin_composingARoleAboveItsOwnCeiling_isRefused() throws Exception {
        String tadmin = tenantAdminToken();

        assertThat(permissionsInToken(tadmin))
            .as("the premise: TENANT_ADMIN really does not hold rbac.manage")
            .doesNotContain("rbac.manage");

        ResponseEntity<String> refused = post(ROLES, tadmin,
            body("Shadow Owner", List.of("pos.order.view", "rbac.manage")));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(objectMapper.readTree(refused.getBody()).path("error").path("code").asText())
            .isEqualTo("ROLE_CEILING_EXCEEDED");
        assertThat(jdbc.queryForObject(
            "SELECT count(*) FROM roles WHERE code = 'SHADOW_OWNER'", Long.class))
            .as("and nothing was written")
            .isZero();

        assertThat(post(ROLES, tadmin, body("Section Head", TICKED)).getStatusCode())
            .as("a tenant admin can still compose a role entirely within its own authority")
            .isEqualTo(HttpStatus.CREATED);
    }

    /**
     * The other direction of the same rule. A role an OWNER built may carry authority a tenant admin
     * does not hold; letting them rewrite it is how a tenant loses its last administrator.
     */
    @Test
    @DisplayName("a tenant admin cannot edit or delete a role carrying authority it does not hold")
    void tenantAdmin_cannotRewriteARoleAboveItsCeiling() throws Exception {
        assertThat(post(ROLES, ownerToken(),
            body("Deputy Owner", List.of("pos.order.view", "rbac.manage"))).getStatusCode())
            .as("the OWNER may build it — this is within OWNER's ceiling")
            .isEqualTo(HttpStatus.CREATED);

        String tadmin = tenantAdminToken();
        assertThat(put(ROLES + "/DEPUTY_OWNER", tadmin, body("Deputy Owner", TICKED)).getStatusCode())
            .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(delete(ROLES + "/DEPUTY_OWNER", tadmin).getStatusCode())
            .isEqualTo(HttpStatus.FORBIDDEN);

        assertThat(jdbc.queryForObject("""
            SELECT count(*) FROM role_permissions
             WHERE role_code = 'DEPUTY_OWNER' AND permission_code = 'rbac.manage'
            """, Long.class))
            .as("the grant survived both attempts")
            .isEqualTo(1L);
    }

    // ── Refusal 2: another tenant's role of the same code grants nothing here ──────────────────

    /**
     * FALSIFICATION TARGET for changeset 092.
     *
     * <p>Before it, {@code role_permissions} was keyed on (role_code, permission_code) with no
     * tenant column. Two tenants naming a role HEAD_WAITER therefore shared one grant set, and a
     * neighbour's {@code rbac.manage} would be resolved into THIS tenant's token. Written with plain
     * SQL so no tenant-aware repository can quietly refuse to create the row this needs to prove is
     * invisible, and asserted against a token rather than against a query, because the token is what
     * decides what the user may do.
     *
     * <p>Note what this test canNOT rely on: Testcontainers connects as a SUPERUSER, so the FORCE
     * RLS policy 092 adds is inert here. It passes only because the queries carry the tenant
     * predicate themselves.
     */
    @Test
    @DisplayName("another tenant's role of the same code grants nothing in this tenant")
    void anotherTenantsRoleOfTheSameCode_grantsNothingHere() throws Exception {
        post(ROLES, ownerToken(), body("Head Waiter", TICKED));
        assign(HOLDER_ASSIGNMENT_ID, HOLDER_ID, HEAD_WAITER_CODE);

        jdbc.update("INSERT INTO roles (id, tenant_id, code, name, is_system) VALUES (?, ?, ?, ?, false)",
            OTHER_TENANT_ROLE_ID, OTHER_TENANT_ID, HEAD_WAITER_CODE, "Neighbour Head Waiter");
        jdbc.update("""
            INSERT INTO role_permissions (tenant_id, role_code, permission_code)
            VALUES (?, ?, 'rbac.manage'), (?, ?, 'pos.order.void.any')
            """, OTHER_TENANT_ID, HEAD_WAITER_CODE, OTHER_TENANT_ID, HEAD_WAITER_CODE);

        assertThat(jdbc.queryForObject("""
            SELECT count(*) FROM role_permissions WHERE tenant_id = ? AND role_code = ?
            """, Long.class, OTHER_TENANT_ID, HEAD_WAITER_CODE))
            .as("the neighbour's grants must actually be in the table, or this proves nothing")
            .isEqualTo(2L);

        assertThat(permissionsInToken(login(HOLDER_EMAIL, HOLDER_PASSWORD, null)))
            .as("the holder's token is composed from THIS tenant's grants only")
            .containsExactlyElementsOf(TICKED.stream().sorted().toList());

        JsonNode listed = entryWithCode(
            objectMapper.readTree(get(ROLES, ownerToken()).getBody()).path("data"), HEAD_WAITER_CODE);
        assertThat(textValues(listed.path("permissions")))
            .as("and so is the catalogue read")
            .containsExactlyElementsOf(TICKED.stream().sorted().toList());
    }

    // ── Refusal 3: built-in roles are immutable, and codes cannot collide ──────────────────────

    @Test
    @DisplayName("a built-in role cannot be edited or deleted")
    void systemRoles_areImmutable() throws Exception {
        String owner = ownerToken();

        ResponseEntity<String> edit = put(ROLES + "/CASHIER", owner, body("Cashier", TICKED));
        assertThat(edit.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(objectMapper.readTree(edit.getBody()).path("error").path("code").asText())
            .isEqualTo("SYSTEM_ROLE_IMMUTABLE");

        assertThat(delete(ROLES + "/CASHIER", owner).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);

        assertThat(jdbc.queryForObject("""
            SELECT count(*) FROM role_permissions WHERE role_code = 'CASHIER' AND tenant_id IS NULL
            """, Long.class))
            .as("the platform-defined CASHIER grants are untouched")
            .isGreaterThan(3L);
    }

    /**
     * A tenant role whose code equals a system role's is the collision the tenant-scoped catalogue
     * cannot resolve: {@code PermissionResolver} would union the platform grants with the tenant's.
     * The only door that can create one is this endpoint, so it is closed here.
     */
    @Test
    @DisplayName("a name that derives onto a built-in role's code is refused, not silently merged")
    void aNameCollidingWithABuiltInRole_isRefused() throws Exception {
        ResponseEntity<String> refused = post(ROLES, ownerToken(), body("Cashier", TICKED));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        assertThat(objectMapper.readTree(refused.getBody()).path("error").path("code").asText())
            .isEqualTo("DUPLICATE_VALUE");
        assertThat(jdbc.queryForObject(
            "SELECT count(*) FROM roles WHERE code = 'CASHIER'", Long.class))
            .as("still exactly one CASHIER row, the platform one")
            .isEqualTo(1L);
    }

    @Test
    @DisplayName("the same role name twice is refused rather than creating a second row")
    void aDuplicateName_isRefused() throws Exception {
        assertThat(post(ROLES, ownerToken(), body("Head Waiter", TICKED)).getStatusCode())
            .isEqualTo(HttpStatus.CREATED);
        assertThat(post(ROLES, ownerToken(), body("head waiter", TICKED)).getStatusCode())
            .isEqualTo(HttpStatus.CONFLICT);
    }

    // ── Retiring a role ───────────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("a role still held by somebody cannot be deleted, and the refusal counts them")
    void aRoleInUse_cannotBeDeleted() throws Exception {
        post(ROLES, ownerToken(), body("Head Waiter", TICKED));
        assign(HOLDER_ASSIGNMENT_ID, HOLDER_ID, HEAD_WAITER_CODE);

        ResponseEntity<String> refused = delete(ROLES + "/" + HEAD_WAITER_CODE, ownerToken());
        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
        JsonNode error = objectMapper.readTree(refused.getBody()).path("error");
        assertThat(error.path("code").asText()).isEqualTo("ROLE_IN_USE");
        assertThat(error.path("message").asText()).contains("1 person");

        jdbc.update("DELETE FROM user_branch_roles WHERE id = ?", HOLDER_ASSIGNMENT_ID);

        assertThat(delete(ROLES + "/" + HEAD_WAITER_CODE, ownerToken()).getStatusCode())
            .isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(jdbc.queryForObject("""
            SELECT count(*) FROM role_permissions WHERE role_code = ?
            """, Long.class, HEAD_WAITER_CODE))
            .as("the grants go with it — an orphaned grant set would be re-adopted by the next "
                + "role that derives onto the same code")
            .isZero();
    }

    // ── Validation and the gate ───────────────────────────────────────────────────────────────

    @Test
    @DisplayName("a permission code that is not in the catalogue is a 400 naming it")
    void anUnknownPermissionCode_isRefusedAndNamed() throws Exception {
        ResponseEntity<String> refused =
            post(ROLES, ownerToken(), body("Ghost Role", List.of("pos.order.view", "pos.void")));

        assertThat(refused.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        // `pos.void` is the exact phantom code the walkthrough found in a live error message.
        assertThat(objectMapper.readTree(refused.getBody()).path("error").path("message").asText())
            .contains("pos.void");
    }

    @Test
    @DisplayName("a role granting nothing cannot be created")
    void anEmptyPermissionSet_isRefused() throws Exception {
        assertThat(post(ROLES, ownerToken(), body("Empty Role", List.of())).getStatusCode())
            .isEqualTo(HttpStatus.BAD_REQUEST);
    }

    @Test
    @DisplayName("a caller holding neither administration code cannot reach the write side at all")
    void aCashier_isRefusedEveryVerb() throws Exception {
        String cashier = login(TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, null);

        assertThat(post(ROLES, cashier, body("Head Waiter", TICKED)).getStatusCode())
            .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(put(ROLES + "/CASHIER", cashier, body("Cashier", TICKED)).getStatusCode())
            .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(delete(ROLES + "/CASHIER", cashier).getStatusCode())
            .isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(post(ROLES, null, body("Head Waiter", TICKED)).getStatusCode())
            .isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────────────────

    private static Map<String, Object> body(String name, List<String> permissions) {
        return Map.of("name", name, "permissions", permissions);
    }

    private void saveUser(UUID id, String email, String password, String fullName, String totpSecret) {
        UserEntity user = userRepository.findById(id).orElseGet(UserEntity::new);
        user.setId(id);
        user.setTenantId(TestFixtures.demoTenantId());
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode(password));
        user.setFullName(fullName);
        user.setLocale("en");
        user.setTotpSecret(totpSecret);
        user.setTotpEnabled(totpSecret != null);
        user.setActive(true);
        user.setMustChangePassword(false);
        user.setFailedLoginCount(0);
        user.setLockedUntil(null);
        userRepository.save(user);
    }

    private void assign(UUID assignmentId, UUID userId, String roleCode) {
        UserBranchRoleEntity assignment =
            userBranchRoleRepository.findById(assignmentId).orElseGet(UserBranchRoleEntity::new);
        assignment.setId(assignmentId);
        assignment.setTenantId(TestFixtures.demoTenantId());
        assignment.setUserId(userId);
        assignment.setBranchId(TestFixtures.mainBranchId());
        assignment.setRoleCode(roleCode);
        assignment.setActive(true);
        assignment.setPrimary(true);
        userBranchRoleRepository.save(assignment);
    }

    /** The permissions claim off a real signed token — what actually decides what a user may do. */
    private List<String> permissionsInToken(String accessToken) throws Exception {
        String payload = new String(Base64.getUrlDecoder().decode(accessToken.split("\\.")[1]),
            StandardCharsets.UTF_8);
        return textValues(objectMapper.readTree(payload).path("permissions")).stream().sorted().toList();
    }

    private ResponseEntity<String> get(String uri, String token) {
        var spec = rest.get().uri(uri);
        if (token != null) {
            spec = spec.header("Authorization", "Bearer " + token);
        }
        return spec.exchange((request, response) -> toStringEntity(response));
    }

    private ResponseEntity<String> post(String uri, String token, Object body) {
        var spec = rest.post().uri(uri).contentType(MediaType.APPLICATION_JSON);
        if (token != null) {
            spec = spec.header("Authorization", "Bearer " + token);
        }
        return spec.body(body).exchange((request, response) -> toStringEntity(response));
    }

    private ResponseEntity<String> put(String uri, String token, Object body) {
        var spec = rest.put().uri(uri).contentType(MediaType.APPLICATION_JSON);
        if (token != null) {
            spec = spec.header("Authorization", "Bearer " + token);
        }
        return spec.body(body).exchange((request, response) -> toStringEntity(response));
    }

    private ResponseEntity<String> delete(String uri, String token) {
        var spec = rest.delete().uri(uri);
        if (token != null) {
            spec = spec.header("Authorization", "Bearer " + token);
        }
        return spec.exchange((request, response) -> toStringEntity(response));
    }

    private static ResponseEntity<String> toStringEntity(
            org.springframework.http.client.ClientHttpResponse response) throws java.io.IOException {
        byte[] bytes = response.getBody() != null ? response.getBody().readAllBytes() : new byte[0];
        return ResponseEntity.status(response.getStatusCode())
            .body(new String(bytes, StandardCharsets.UTF_8));
    }

    private String ownerToken() throws Exception {
        return login(TestFixtures.OWNER_EMAIL, TestFixtures.OWNER_PASSWORD, currentCode(ownerTotpSecret));
    }

    private String tenantAdminToken() throws Exception {
        return login(TADMIN_EMAIL, TADMIN_PASSWORD, currentCode(tadminTotpSecret));
    }

    private String login(String email, String password, String totpCode) throws Exception {
        var loginBody = totpCode == null
            ? TestFixtures.loginBody(email, password, TestFixtures.DEMO_SLUG)
            : TestFixtures.loginBody(email, password, TestFixtures.DEMO_SLUG, totpCode);
        ResponseEntity<String> response = exchangePost("/api/v1/auth/login", loginBody);
        assertThat(response.getStatusCode())
            .as("login for %s: %s", email, response.getBody())
            .isEqualTo(HttpStatus.OK);
        return objectMapper.readTree(response.getBody()).path("data").path("accessToken").asText();
    }

    private String currentCode(String secret) throws Exception {
        return codeGenerator.generate(secret, timeProvider.getTime() / 30);
    }

    private static JsonNode entryWithCode(JsonNode array, String code) {
        for (JsonNode node : array) {
            if (code.equals(node.path("code").asText())) {
                return node;
            }
        }
        throw new AssertionError("no role with code " + code + " in " + array);
    }

    private static List<String> textValues(JsonNode array) {
        List<String> values = new ArrayList<>();
        array.forEach(node -> values.add(node.asText()));
        return values;
    }
}
