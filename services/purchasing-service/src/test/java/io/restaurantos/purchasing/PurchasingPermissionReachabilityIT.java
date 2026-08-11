package io.restaurantos.purchasing;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Every authority a purchasing endpoint demands must exist in the permission catalogue and be
 * granted to at least one role — proven by reading the annotations and the changelogs, never a
 * list someone maintained by hand.
 *
 * <p><b>Why this exists.</b> Phase 36's brief opened with "purchasing answered 403 for the
 * MANAGER", and the 36-01 live drive found the 403 no longer reproduces: {@code auth_db} holds all
 * ten {@code vendor.*} grants for MANAGER and the issued token carries all ten. The cause was
 * grant drift that has since been repaired — which is precisely the problem this test addresses.
 * The evidence that closed the finding is a snapshot of one database on one day. An endpoint added
 * tomorrow demanding an authority nobody holds would ship unreachable, be discovered by a user, and
 * be reported as "purchasing is broken" all over again.
 *
 * <p>Changesets {@code 045-repair-vendor-manage-approve-grants.xml} and
 * {@code 049-repair-permission-catalog-drift.xml} exist because that already happened twice.
 *
 * <p><b>Both sides are read from source.</b> The demanded set comes from the {@code @PreAuthorize}
 * strings in the controller sources; the granted set comes from the Liquibase changelogs. Neither
 * is transcribed, because a transcription drifts exactly the way the changelogs did. The one
 * hand-written thing here is {@link #INTENDED_DESIGN} — a deliberate, cited restatement of the
 * model, asserted <em>against</em> the parsed changelogs, so that a changelog edit which silently
 * widens a role fails the build instead of being adopted by default.
 *
 * <p><b>No Spring context, no database.</b> This is a source-and-changelog invariant. It carries
 * the {@code IT} suffix because that is what the plan names, and this module's surefire excludes
 * {@code **}{@code /*IT.java} — so it is run by failsafe:
 *
 * <pre>mvn -pl services/purchasing-service -am verify -Dit.test=PurchasingPermissionReachabilityIT</pre>
 *
 * {@code mvn test -Dtest=PurchasingPermissionReachabilityIT} executes <b>zero</b> tests and reports
 * success, which is worse than failing.
 */
@DisplayName("Every authority purchasing demands is declared, granted, and reachable")
class PurchasingPermissionReachabilityIT {

    /** {@code @PreAuthorize("hasAuthority('vendor.po.approve')")} → {@code vendor.po.approve}. */
    private static final Pattern HAS_AUTHORITY =
            Pattern.compile("hasAuthority\\(\\s*'([^']+)'\\s*\\)");

    /** A Liquibase {@code <insert tableName="role_permissions">} pair. */
    private static final Pattern LIQUIBASE_GRANT = Pattern.compile(
            "<insert\\s+tableName=\"role_permissions\">\\s*"
                    + "<column\\s+name=\"role_code\"\\s+value=\"([^\"]+)\"\\s*/>\\s*"
                    + "<column\\s+name=\"permission_code\"\\s+value=\"([^\"]+)\"\\s*/>");

    /**
     * The {@code ON CONFLICT DO NOTHING} form the repair changesets use. 045 restores grants with
     * raw SQL rather than {@code <insert>} because an insert that already exists aborts the whole
     * changeset; the repair has to be inert on a fresh database.
     */
    private static final Pattern SQL_GRANT =
            Pattern.compile("\\(\\s*'([A-Z_]+)'\\s*,\\s*'(vendor\\.[a-z.]+)'\\s*\\)");

    /**
     * The intended role-to-authority model, restated so a human can check it, with the changeset
     * that declares each block. Asserted against the parsed changelogs below — this is a check on
     * the transcription, not a substitute for reading the source of truth.
     *
     * <ul>
     *   <li>{@code 030-create-roles-permissions.xml} — seeds {@code vendor.manage} and
     *       {@code vendor.po.approve} for OWNER / TENANT_ADMIN / MANAGER.</li>
     *   <li>{@code 031-purchasing-permissions.xml}, changeset
     *       {@code auth-1.0.0-031-purchasing-permissions} — the rest of the {@code vendor.*}
     *       catalogue and the MANAGER / OWNER / TENANT_ADMIN / ACCOUNTANT / INVENTORY_MANAGER
     *       grants. Its own comment records that CASHIER holds nothing on purpose.</li>
     *   <li>{@code 045-repair-vendor-manage-approve-grants.xml} — restores the two 030 grants on
     *       databases that migrated before 030 was edited.</li>
     * </ul>
     */
    private static final Map<String, Set<String>> INTENDED_DESIGN = new TreeMap<>(Map.of(
            // Full procurement authority.
            "OWNER", fullVendorSet(),
            "TENANT_ADMIN", fullVendorSet(),
            "MANAGER", fullVendorSet(),
            // Books and pays; does not raise or approve orders, and does not manage the vendor master.
            "ACCOUNTANT", new TreeSet<>(Set.of(
                    "vendor.view", "vendor.invoice.book", "vendor.invoice.override",
                    "vendor.payment.create")),
            // Raises requisitions and receives goods; cannot approve, send, close, invoice or pay.
            "INVENTORY_MANAGER", new TreeSet<>(Set.of(
                    "vendor.view", "vendor.po.create", "vendor.grn.receive"))));

    /**
     * Roles that must hold NOTHING in the vendor module. The cashier control is the one the
     * existing {@code PurchasingEndpointAuthorizationIT} relies on; waiter and kitchen staff are
     * asserted for the same reason 19b minted {@code pos.tables.admin} rather than reuse a code a
     * waiter already held — an exclusion nobody asserts is an exclusion that erodes.
     */
    private static final Set<String> DELIBERATELY_EXCLUDED_ROLES =
            new TreeSet<>(Set.of("CASHIER", "WAITER", "KITCHEN_STAFF"));

    private static TreeSet<String> fullVendorSet() {
        return new TreeSet<>(Set.of(
                "vendor.view", "vendor.manage",
                "vendor.po.create", "vendor.po.approve", "vendor.po.send", "vendor.po.close",
                "vendor.grn.receive",
                "vendor.invoice.book", "vendor.invoice.override",
                "vendor.payment.create"));
    }

    // ── The two sources of truth ────────────────────────────────────────────────────────────

    /** controller simple name + "#" + the enclosing line → the authority it demands. */
    private static Map<String, String> demandedAuthorities() throws IOException {
        Path webDir = repoRoot().resolve(
                "services/purchasing-service/src/main/java/io/restaurantos/purchasing/web");
        assertThat(Files.isDirectory(webDir))
                .as("the purchasing web package must exist at %s", webDir)
                .isTrue();

        Map<String, String> demanded = new LinkedHashMap<>();
        try (Stream<Path> files = Files.list(webDir)) {
            List<Path> controllers = files
                    .filter(p -> p.getFileName().toString().endsWith("Controller.java"))
                    .sorted()
                    .toList();
            for (Path controller : controllers) {
                String source = Files.readString(controller);
                String name = controller.getFileName().toString().replace(".java", "");
                Matcher m = HAS_AUTHORITY.matcher(source);
                int n = 0;
                while (m.find()) {
                    demanded.put(name + "#" + (++n), m.group(1));
                }
            }
        }
        return demanded;
    }

    /** role code → the vendor authorities the changelogs grant it. */
    private static Map<String, Set<String>> declaredGrants() throws IOException {
        Path changelogDir = repoRoot().resolve(
                "services/auth-service/src/main/resources/db/changelog/v1.0.0");
        assertThat(Files.isDirectory(changelogDir))
                .as("the auth changelog directory must exist at %s", changelogDir)
                .isTrue();

        Map<String, Set<String>> grants = new TreeMap<>();
        try (Stream<Path> files = Files.list(changelogDir)) {
            for (Path changelog : files.filter(p -> p.toString().endsWith(".xml")).sorted().toList()) {
                String xml = Files.readString(changelog);
                record(grants, LIQUIBASE_GRANT.matcher(xml));
                record(grants, SQL_GRANT.matcher(xml));
            }
        }
        return grants;
    }

    private static void record(Map<String, Set<String>> grants, Matcher m) {
        while (m.find()) {
            String role = m.group(1);
            String permission = m.group(2);
            if (permission.startsWith("vendor.")) {
                grants.computeIfAbsent(role, r -> new TreeSet<>()).add(permission);
            }
        }
    }

    /**
     * The module directory is Maven's working directory; the repo root is two levels up. Resolved
     * by walking until a marker is found rather than by counting {@code ..}, so this survives being
     * run from the module or from the reactor root.
     */
    private static Path repoRoot() {
        Path p = Path.of("").toAbsolutePath();
        while (p != null && !Files.isDirectory(p.resolve("services/purchasing-service"))) {
            p = p.getParent();
        }
        assertThat(p).as("could not locate the repository root from %s",
                Path.of("").toAbsolutePath()).isNotNull();
        return p;
    }

    // ── The four assertions ─────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("every authority a controller demands is granted to at least one role")
    void everyDemandedAuthorityIsGrantedToSomeone() throws IOException {
        Map<String, String> demanded = demandedAuthorities();
        Set<String> granted = declaredGrants().values().stream()
                .flatMap(Set::stream).collect(Collectors.toCollection(TreeSet::new));

        assertThat(demanded)
                .as("no @PreAuthorize authority was found in the purchasing controllers — the "
                        + "scanner is broken, and a scanner that finds nothing passes everything")
                .isNotEmpty();

        List<String> unreachable = demanded.entrySet().stream()
                .filter(e -> !granted.contains(e.getValue()))
                .map(e -> e.getKey() + " demands '" + e.getValue() + "' which no changelog grants")
                .toList();

        assertThat(unreachable)
                .as("an endpoint demanding an authority no role holds is unreachable by every "
                        + "human being. It will not fail at build time, it will fail for a user, "
                        + "and it will be reported as 'purchasing is broken'.")
                .isEmpty();
    }

    @Test
    @DisplayName("every granted vendor authority is demanded by at least one endpoint")
    void everyGrantedAuthorityHasAConsumer() throws IOException {
        Set<String> demanded = new TreeSet<>(demandedAuthorities().values());
        Set<String> granted = declaredGrants().values().stream()
                .flatMap(Set::stream).collect(Collectors.toCollection(TreeSet::new));

        Set<String> orphaned = new TreeSet<>(granted);
        orphaned.removeAll(demanded);

        assertThat(orphaned)
                .as("a permission granted to a role and checked by nothing is a capability nobody "
                        + "can reason about — it is what 031's own comment records finding in 030, "
                        + "where vendor.manage and vendor.po.approve were seeded with zero consumers")
                .isEmpty();
    }

    @Test
    @DisplayName("the changelogs grant exactly the intended design — no more, no less")
    void declaredGrantsMatchTheIntendedDesign() throws IOException {
        Map<String, Set<String>> declared = declaredGrants();

        // Only the roles the design speaks about; a role the design is silent on is covered by the
        // exclusion test below, which is the stricter statement.
        for (Map.Entry<String, Set<String>> intended : INTENDED_DESIGN.entrySet()) {
            String role = intended.getKey();
            Set<String> actual = declared.getOrDefault(role, Set.of());

            Set<String> missing = new TreeSet<>(intended.getValue());
            missing.removeAll(actual);
            Set<String> extra = new TreeSet<>(actual);
            extra.removeAll(intended.getValue());

            assertThat(missing)
                    .as("%s is missing vendor authorities the design gives it. Either a changeset "
                            + "was edited after it executed (the 045/049 drift shape) or the design "
                            + "table in this test is stale.", role)
                    .isEmpty();
            assertThat(extra)
                    .as("%s has been granted vendor authorities the design does not give it. "
                            + "Widening a role to make a call succeed is the failure mode D-36-02 "
                            + "exists to prevent — if the widening is intended, change the design "
                            + "table here deliberately and say why.", role)
                    .isEmpty();
        }
    }

    @Test
    @DisplayName("roles deliberately excluded from purchasing hold nothing in the vendor module")
    void excludedRolesHoldNoVendorAuthority() throws IOException {
        Map<String, Set<String>> declared = declaredGrants();

        List<String> violations = new ArrayList<>();
        for (String role : DELIBERATELY_EXCLUDED_ROLES) {
            Set<String> held = declared.getOrDefault(role, Set.of());
            if (!held.isEmpty()) {
                violations.add(role + " holds " + held);
            }
        }

        assertThat(violations)
                .as("031's comment states CASHIER holds nothing in the vendor module on purpose. "
                        + "An exclusion that nobody asserts is an exclusion that erodes one "
                        + "convenient grant at a time.")
                .isEmpty();

        // And the roles the design does speak about must not have quietly acquired a role code
        // nobody wrote down — a typo'd role_code inserts happily and grants nothing to anyone.
        Set<String> knownRoles = new LinkedHashSet<>(INTENDED_DESIGN.keySet());
        knownRoles.addAll(DELIBERATELY_EXCLUDED_ROLES);
        Set<String> unknown = new TreeSet<>(declared.keySet());
        unknown.removeAll(knownRoles);
        assertThat(unknown)
                .as("a role code holding vendor authorities that this test does not know about. "
                        + "Either a new role was introduced (add it to the design table) or a "
                        + "role_code was mistyped, in which case the grant reaches nobody.")
                .isEmpty();
    }
}
