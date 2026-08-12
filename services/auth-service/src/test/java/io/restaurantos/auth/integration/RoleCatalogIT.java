package io.restaurantos.auth.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.samstevens.totp.code.DefaultCodeGenerator;
import dev.samstevens.totp.secret.DefaultSecretGenerator;
import dev.samstevens.totp.time.SystemTimeProvider;
import io.restaurantos.auth.entity.UserBranchRoleEntity;
import io.restaurantos.auth.entity.UserEntity;
import io.restaurantos.auth.repository.RolePermissionRepository;
import io.restaurantos.auth.repository.RoleRepository;
import io.restaurantos.auth.repository.UserBranchRoleRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

/**
 * The role and permission catalog (D-14) — the discovery half of user administration.
 *
 * <p>13-06 made an unknown role code a hard 400 on the only write path for {@code
 * user_branch_roles}. That is only usable if a caller can find out which codes are valid, which is
 * what these two endpoints are for. Everything here is asserted through the real HTTP stack with a
 * real signed token, because the whole subject matter is authorization: an over-exposed catalog, an
 * under-exposed catalog and a correct one are indistinguishable in a diff and all start cleanly.
 *
 * <h2>What this file can and cannot see</h2>
 *
 * <p>Testcontainers' Postgres user is a SUPERUSER, so it bypasses row security entirely. Every RLS
 * policy in {@code auth_db} is therefore INERT here. That is not a footnote — it is how two write
 * paths shipped broken (13-02's {@code ab7e59a}, 13-06's {@code provisionAdmin}), green in every
 * test and rejected by the real database. So {@link #listRoles_neverReturnsAnotherTenantsRole()}
 * deliberately does NOT rely on the {@code roles} RLS policy: the service filters on
 * {@code tenant_id} in the query itself, and this test would fail if that predicate were deleted
 * even though the policy would still be there. The policy is the second line, measured separately
 * against the live {@code auth_db} whose {@code auth_user} is {@code NOSUPERUSER NOBYPASSRLS}.
 */
class RoleCatalogIT extends BaseIntegrationTest {

    private static final String ROLES = "/api/v1/roles";
    private static final String PERMISSIONS = "/api/v1/permissions";

    /** A TENANT_ADMIN of the demo tenant — the persona the ceiling rule is about. */
    private static final UUID TADMIN_ID = UUID.fromString("c0000031-0000-4000-8000-000000000031");
    private static final String TADMIN_EMAIL = "catalog-admin@demo.local";
    private static final String TADMIN_PASSWORD = "Catalog#2026";

    /** A neighbouring tenant that must never appear in the demo tenant's catalog. */
    private static final UUID OTHER_TENANT_ID = UUID.fromString("a0000099-0000-4000-8000-000000000099");
    private static final UUID OTHER_TENANT_ROLE_ID = UUID.fromString("d0000099-0000-4000-8000-000000000099");
    private static final String OTHER_TENANT_ROLE_CODE = "NEIGHBOUR_ONLY";

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final DefaultSecretGenerator secretGenerator = new DefaultSecretGenerator();
    private final DefaultCodeGenerator codeGenerator = new DefaultCodeGenerator();
    private final SystemTimeProvider timeProvider = new SystemTimeProvider();

    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder passwordEncoder;
    @Autowired UserBranchRoleRepository userBranchRoleRepository;

    /**
     * Spied so {@link #listRoles_costsABoundedNumberOfQueriesRegardlessOfRoleCount()} can count
     * calls. Real in every other test — a spy delegates.
     */
    @MockitoSpyBean RoleRepository roleRepository;
    @MockitoSpyBean RolePermissionRepository rolePermissionRepository;

    private String ownerTotpSecret;
    private String tadminTotpSecret;

    // ── Personas ─────────────────────────────────────────────────────────────────────────────

    @BeforeEach
    void enrolAdministrators() {
        setRls(TestFixtures.demoTenantId());

        // OWNER and TENANT_ADMIN both trigger TOTP step-up at login — OWNER on rbac.manage,
        // TENANT_ADMIN on finance.period.close / hr.payroll.approve. That is D-29a working as
        // decided, so the personas enrol a factor rather than the gate being weakened.
        ownerTotpSecret = secretGenerator.generate();
        UserEntity owner = userRepository.findByEmail(TestFixtures.OWNER_EMAIL).orElseThrow();
        owner.setTotpSecret(ownerTotpSecret);
        owner.setTotpEnabled(true);
        userRepository.save(owner);

        tadminTotpSecret = secretGenerator.generate();
        UserEntity tadmin = userRepository.findById(TADMIN_ID).orElseGet(UserEntity::new);
        tadmin.setId(TADMIN_ID);
        tadmin.setTenantId(TestFixtures.demoTenantId());
        tadmin.setEmail(TADMIN_EMAIL);
        tadmin.setPasswordHash(passwordEncoder.encode(TADMIN_PASSWORD));
        tadmin.setFullName("Catalog Tenant Admin");
        tadmin.setLocale("en");
        tadmin.setTotpSecret(tadminTotpSecret);
        tadmin.setTotpEnabled(true);
        tadmin.setActive(true);
        tadmin.setFailedLoginCount(0);
        tadmin.setLockedUntil(null);
        userRepository.save(tadmin);

        if (userBranchRoleRepository
                .findByUserIdAndBranchIdAndActiveTrue(TADMIN_ID, TestFixtures.mainBranchId())
                .isEmpty()) {
            UserBranchRoleEntity assignment = new UserBranchRoleEntity();
            assignment.setId(UUID.fromString("d0000031-0000-4000-8000-000000000031"));
            assignment.setTenantId(TestFixtures.demoTenantId());
            assignment.setUserId(TADMIN_ID);
            assignment.setBranchId(TestFixtures.mainBranchId());
            assignment.setRoleCode("TENANT_ADMIN");
            assignment.setActive(true);
            assignment.setPrimary(true);
            userBranchRoleRepository.save(assignment);
        }

        // A role belonging to a DIFFERENT tenant. Written with plain SQL so no tenant-aware
        // repository can quietly refuse to create the very row this file needs to prove is hidden.
        jdbc.update("DELETE FROM roles WHERE id = ?", OTHER_TENANT_ROLE_ID);
        jdbc.update("INSERT INTO roles (id, tenant_id, code, name, is_system) VALUES (?, ?, ?, ?, false)",
                OTHER_TENANT_ROLE_ID, OTHER_TENANT_ID, OTHER_TENANT_ROLE_CODE, "Neighbour Only");
    }

    @AfterEach
    void restoreState() {
        setRls(TestFixtures.demoTenantId());
        userRepository.findByEmail(TestFixtures.OWNER_EMAIL).ifPresent(owner -> {
            owner.setTotpSecret(null);
            owner.setTotpEnabled(false);
            userRepository.save(owner);
        });
        jdbc.update("DELETE FROM roles WHERE id = ?", OTHER_TENANT_ROLE_ID);
        jdbc.update("DELETE FROM roles WHERE code LIKE 'CATALOG_PROBE_%'");
    }

    // ── Behaviour 1: the role list carries code, name, system flag and sorted codes ───────────

    @Test
    void listRoles_returnsCodeNameSystemFlagAndSortedPermissionCodes() throws Exception {
        ResponseEntity<String> response = get(ROLES, ownerToken());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        JsonNode roles = objectMapper.readTree(response.getBody()).path("data");
        assertThat(roles.isArray()).isTrue();
        assertThat(roles).isNotEmpty();

        JsonNode cashier = entryWithCode(roles, "CASHIER");
        assertThat(cashier.path("name").asText()).isEqualTo("Cashier");
        assertThat(cashier.path("system").asBoolean())
                .as("CASHIER is seeded is_system = true")
                .isTrue();

        List<String> permissions = textValues(cashier.path("permissions"));
        assertThat(permissions).isNotEmpty();
        assertThat(permissions)
                .as("sorted, so two runs of the catalog are diffable")
                .isSorted();

        // The whole list is sorted too, for the same reason.
        assertThat(textValues(roles, "code")).isSorted();
    }

    // ── Behaviour 5: the catalog is the database, not a compiled list ─────────────────────────

    /**
     * The role plan 13-02 seeded, with the codes it seeded. Nothing in this service's source
     * mentions WAITER, so a catalog built from a hardcoded list in code could not answer this.
     */
    @Test
    void listRoles_includesTheRoleSeededByPlan1302WithItsOrderTakingCodes() throws Exception {
        JsonNode waiter = entryWithCode(
                objectMapper.readTree(get(ROLES, ownerToken()).getBody()).path("data"), "WAITER");

        assertThat(textValues(waiter.path("permissions"))).contains(
                "pos.order.create",
                "pos.order.update",
                "pos.order.view",
                "pos.order.send_to_kds");
    }

    // ── Behaviour 2: permissions grouped by module, codes sorted within each ──────────────────

    @Test
    void listPermissions_isGroupedByModuleWithCodesSortedWithinEachModule() throws Exception {
        ResponseEntity<String> response = get(PERMISSIONS, ownerToken());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        JsonNode modules = objectMapper.readTree(response.getBody()).path("data");
        assertThat(modules.isArray()).isTrue();
        assertThat(modules).hasSizeGreaterThan(1);

        List<String> moduleNames = textValues(modules, "module");
        assertThat(moduleNames).as("one entry per module, sorted").isSorted().doesNotHaveDuplicates();
        assertThat(moduleNames).contains("rbac", "pos");

        for (JsonNode module : modules) {
            String name = module.path("module").asText();
            JsonNode entries = module.path("permissions");
            assertThat(entries).as("module %s carries its permissions", name).isNotEmpty();
            assertThat(textValues(entries, "code")).as("codes within %s", name).isSorted();
            for (JsonNode entry : entries) {
                assertThat(entry.path("module").asText())
                        .as("a permission may only appear under its own module")
                        .isEqualTo(name);
            }
        }

        // The module every gate on these two endpoints names.
        JsonNode rbac = entryWith(modules, "module", "rbac");
        assertThat(textValues(rbac.path("permissions"), "code"))
                .contains("rbac.manage", "rbac.user.manage", "rbac.role.manage");
    }

    // ── Behaviour 3: neither endpoint answers without a token ─────────────────────────────────

    @Test
    void bothEndpoints_withoutAToken_return401() {
        assertThat(get(ROLES, null).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(get(PERMISSIONS, null).getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
    }

    // ── Behaviour 4: nor for a caller holding neither administration code ─────────────────────

    /**
     * A cashier authenticates perfectly well and holds neither {@code rbac.manage} nor
     * {@code rbac.user.manage}. Without this, the 401 above would be satisfied by an endpoint that
     * is open to every logged-in user — which for the permission catalog means publishing the whole
     * authorization surface of the platform to anyone with a password.
     */
    @Test
    void bothEndpoints_forACallerHoldingNeitherAdministrationCode_return403() throws Exception {
        String cashier = login(TestFixtures.CASHIER_EMAIL, TestFixtures.CASHIER_PASSWORD, null);

        assertThat(get(ROLES, cashier).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(get(PERMISSIONS, cashier).getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
    }

    // ── Behaviour 6: no user, tenant or assignment data in either response ────────────────────

    @Test
    void neitherResponse_carriesUserTenantOrAssignmentData() throws Exception {
        String owner = ownerToken();
        for (String body : List.of(get(ROLES, owner).getBody(), get(PERMISSIONS, owner).getBody())) {
            assertThat(body).doesNotContain(TestFixtures.demoTenantId().toString());
            assertThat(body).doesNotContain(TestFixtures.mainBranchId().toString());
            assertThat(body).doesNotContain("@demo.local");
            assertThat(body).doesNotContainIgnoringCase("tenantId");
            assertThat(body).doesNotContainIgnoringCase("userId");
            assertThat(body).doesNotContainIgnoringCase("branchId");
        }
    }

    // ── Guardrail: never above the caller's own ceiling ───────────────────────────────────────

    /**
     * A tenant admin may not be shown a role it could not hold itself.
     *
     * <p>OWNER holds {@code rbac.manage}; TENANT_ADMIN deliberately does not (13-02 split the
     * authority precisely so that it would not). Advertising OWNER to a tenant admin makes the role
     * picker a privilege-escalation control: pick OWNER for an account you control, log in as it,
     * and you now hold the umbrella permission your own role was designed to withhold.
     *
     * <p>Both directions are asserted. The positive half is what stops this being satisfiable by an
     * endpoint that returns nothing at all.
     */
    @Test
    void listRoles_withholdsRolesAboveTheCallersCeiling() throws Exception {
        List<String> ownerSees = roleCodes(ownerToken());
        List<String> tadminSees = roleCodes(tenantAdminToken());

        assertThat(ownerSees).as("OWNER may assign OWNER").contains("OWNER");
        assertThat(tadminSees).as("TENANT_ADMIN may NOT assign OWNER").doesNotContain("OWNER");
        assertThat(tadminSees)
                .as("and is still shown the roles it can actually grant")
                .contains("CASHIER", "WAITER", "MANAGER");
    }

    /**
     * The withheld roles are counted back to the caller. A role that silently vanishes from a
     * picker is a support ticket; a warning naming the reason is an answer.
     */
    @Test
    void listRoles_reportsHowManyRolesItWithheld() throws Exception {
        JsonNode warnings = objectMapper.readTree(get(ROLES, tenantAdminToken()).getBody())
                .path("warnings");

        assertThat(warnings).isNotEmpty();
        assertThat(warnings.get(0).path("code").asText()).isEqualTo("ROLES_WITHHELD_ABOVE_CEILING");

        JsonNode ownerWarnings = objectMapper.readTree(get(ROLES, ownerToken()).getBody())
                .path("warnings");
        assertThat(ownerWarnings)
                .as("nothing is above OWNER's ceiling, so there is nothing to warn about")
                .isEmpty();
    }

    /**
     * The premise the ceiling rule rests on, asserted against the database rather than assumed.
     *
     * <p>Changeset 036 defines OWNER as holding every permission and TENANT_ADMIN as holding every
     * permission except {@code rbac.manage}. It implements that by SELECTing from
     * {@code permissions} at the moment it runs, so any code that enters the catalogue afterwards
     * without an explicit grant is missing from both roles forever — which is precisely what
     * happened to {@code pos.order.void.own} on every database that ran the original changeset 034
     * (it arrived later, via 049's repair, which grants it to CASHIER and MANAGER only).
     *
     * <p>Under the ceiling rule that one absent row made CASHIER and MANAGER unassignable BY OWNER:
     * a cashier could void their own order and the owner of the restaurant could not, so CASHIER
     * was "above" OWNER. Measured live before changeset 057: a tenant admin was offered five roles
     * instead of seven. Fail-closed, and the rule correctly reporting bad data.
     *
     * <p>This test fails on the branch that adds a permission without back-granting it, at which
     * point the role picker would otherwise start quietly withholding roles.
     */
    @Test
    void theAdministrationRolesHoldTheWholeCatalogue() {
        assertThat(jdbc.queryForList("""
                SELECT p.code FROM permissions p
                 WHERE NOT EXISTS (SELECT 1 FROM role_permissions rp
                                    WHERE rp.role_code = 'OWNER' AND rp.permission_code = p.code)
                 ORDER BY p.code
                """, String.class))
                .as("OWNER is defined as holding every permission (changeset 036, repaired by 057). "
                        + "A code here is one no role can be assigned by OWNER while holding it.")
                .isEmpty();

        assertThat(jdbc.queryForList("""
                SELECT p.code FROM permissions p
                 WHERE p.code <> 'rbac.manage'
                   AND NOT EXISTS (SELECT 1 FROM role_permissions rp
                                    WHERE rp.role_code = 'TENANT_ADMIN' AND rp.permission_code = p.code)
                 ORDER BY p.code
                """, String.class))
                .as("TENANT_ADMIN is defined as holding every permission EXCEPT rbac.manage")
                .isEmpty();

        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM role_permissions
                 WHERE role_code = 'TENANT_ADMIN' AND permission_code = 'rbac.manage'
                """, Long.class))
                .as("and the 13-02 authority split must survive a blanket grant repair")
                .isZero();
    }

    // ── Guardrail: never another tenant's data ────────────────────────────────────────────────

    /**
     * Deliberately not a test of the RLS policy — see the class javadoc. Testcontainers runs as a
     * SUPERUSER, so the policy is inert here and a test that leant on it would pass no matter what
     * the query said. The service filters on {@code tenant_id} itself, and deleting that predicate
     * fails this.
     */
    @Test
    void listRoles_neverReturnsAnotherTenantsRole() throws Exception {
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM roles WHERE id = ?", Long.class, OTHER_TENANT_ROLE_ID))
                .as("the neighbouring tenant's role must actually be in the table, or this proves nothing")
                .isEqualTo(1L);

        assertThat(roleCodes(ownerToken())).doesNotContain(OTHER_TENANT_ROLE_CODE);
        assertThat(roleCodes(tenantAdminToken())).doesNotContain(OTHER_TENANT_ROLE_CODE);
    }

    // ── The catalog cannot become an N+1 over the role list ───────────────────────────────────

    /**
     * Bounded, and asserted with more roles than the seed has so "bounded" means bounded rather
     * than "small today". A per-role permission lookup would make this endpoint's cost grow with a
     * tenant's custom-role count on a page every administrator loads.
     */
    @Test
    void listRoles_costsABoundedNumberOfQueriesRegardlessOfRoleCount() throws Exception {
        String token = ownerToken();
        clearInvocations(roleRepository, rolePermissionRepository);
        get(ROLES, token);
        verify(roleRepository, times(1)).findVisibleToTenant(any());
        verify(rolePermissionRepository, times(1)).findRolePermissionPairsForTenant(any(), any());

        for (int i = 0; i < 12; i++) {
            jdbc.update("INSERT INTO roles (id, tenant_id, code, name, is_system) VALUES (?, ?, ?, ?, false)",
                    UUID.randomUUID(), TestFixtures.demoTenantId(), "CATALOG_PROBE_" + i, "Probe " + i);
        }

        clearInvocations(roleRepository, rolePermissionRepository);
        assertThat(roleCodes(token)).contains("CATALOG_PROBE_0", "CATALOG_PROBE_11");
        verify(roleRepository, times(1)).findVisibleToTenant(any());
        verify(rolePermissionRepository, times(1)).findRolePermissionPairsForTenant(any(), any());
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private ResponseEntity<String> get(String uri, String bearerToken) {
        var spec = rest.get().uri(uri);
        if (bearerToken != null) {
            spec = spec.header("Authorization", "Bearer " + bearerToken);
        }
        return spec.exchange((request, response) -> ResponseEntity
                .status(response.getStatusCode())
                .body(new String(response.getBody().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)));
    }

    private List<String> roleCodes(String token) throws Exception {
        return textValues(objectMapper.readTree(get(ROLES, token).getBody()).path("data"), "code");
    }

    private String ownerToken() throws Exception {
        return login(TestFixtures.OWNER_EMAIL, TestFixtures.OWNER_PASSWORD, currentCode(ownerTotpSecret));
    }

    private String tenantAdminToken() throws Exception {
        return login(TADMIN_EMAIL, TADMIN_PASSWORD, currentCode(tadminTotpSecret));
    }

    private String login(String email, String password, String totpCode) throws Exception {
        var body = totpCode == null
                ? TestFixtures.loginBody(email, password, TestFixtures.DEMO_SLUG)
                : TestFixtures.loginBody(email, password, TestFixtures.DEMO_SLUG, totpCode);
        ResponseEntity<String> response = exchangePost("/api/v1/auth/login", body);
        assertThat(response.getStatusCode())
                .as("login for %s: %s", email, response.getBody())
                .isEqualTo(HttpStatus.OK);
        return objectMapper.readTree(response.getBody()).path("data").path("accessToken").asText();
    }

    private String currentCode(String secret) throws Exception {
        return codeGenerator.generate(secret, timeProvider.getTime() / 30);
    }

    private static JsonNode entryWithCode(JsonNode array, String code) {
        return entryWith(array, "code", code);
    }

    private static JsonNode entryWith(JsonNode array, String field, String value) {
        for (JsonNode node : array) {
            if (value.equals(node.path(field).asText())) {
                return node;
            }
        }
        throw new AssertionError("no entry with " + field + "=" + value + " in " + array);
    }

    private static List<String> textValues(JsonNode array) {
        List<String> values = new ArrayList<>();
        array.forEach(node -> values.add(node.asText()));
        return values;
    }

    private static List<String> textValues(JsonNode array, String field) {
        List<String> values = new ArrayList<>();
        array.forEach(node -> values.add(node.path(field).asText()));
        return values;
    }
}
