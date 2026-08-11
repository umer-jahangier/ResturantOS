package io.restaurantos.auth;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Every permission code the running system enforces is one the catalog actually defines.
 *
 * <p>This is the highest-recurrence defect in the codebase. Five separate outages have had exactly
 * this shape, each found only by a human trying the feature and being refused:
 *
 * <ul>
 *   <li>{@code crm.*} — every CRM endpoint 403'd for every user including OWNER (fixed by 047)</li>
 *   <li>{@code finance.expense.approve} — the expense inbox accepted expenses that nobody could
 *       ever approve (fixed by 049)</li>
 *   <li>{@code pos.order.view.all} — Order Management showed managers and owners zero orders,
 *       because the "see everyone's orders" code existed in no catalog and on no role (050)</li>
 *   <li>{@code pos.order.void.any} — the supervisor void override that no supervisor had: the OPA
 *       policy read {@code .any}, the catalog granted {@code pos.order.void} (050)</li>
 *   <li>{@code pos.order.void.own} — granted to CASHIER, never inserted into {@code permissions},
 *       so the catalog and the grants disagreed about what exists (049)</li>
 * </ul>
 *
 * <p>None of these could fail a normal test. A permission that no role holds does not throw at
 * startup, does not break a unit test, and produces a clean, confident 403 or a plausibly-empty
 * list at runtime — the system behaves exactly like one where the user genuinely lacks access. The
 * only way to catch it is to compare the two vocabularies directly, which is what this does.
 *
 * <p>Sources scanned: {@code @PreAuthorize} expressions and inline JWT-claim permission checks
 * across every service plus the gateway and shared-lib, the Rego policies and policy fixtures under
 * {@code policies/}, and the frontend's nav-config permission gates. Target: the {@code permissions}
 * inserts in the Liquibase changelog. Both sides are read from the repository tree rather than a
 * running database, so this stays a fast unit test and fails on the branch that introduces the drift
 * rather than in whichever environment someone first clicks the feature.
 *
 * <h2>What the 2026-08-12 audit found, and what it changed here</h2>
 *
 * <p>The audit compared every referenced code against the live catalogue. On the two surfaces this
 * test originally scanned it found <b>zero</b> drift — the assertion was honest, not lucky. Nine
 * phantom codes existed anyway, every one of them on a surface the scan could not see:
 *
 * <ul>
 *   <li><b>Scope.</b> {@code sources("services", ".java")} skipped {@code gateway/} and
 *       {@code shared-lib/} entirely, and the frontend was never considered.</li>
 *   <li><b>Idiom.</b> Only {@code has(Any)?Authority('…')} matched, and only with SINGLE quotes.
 *       The three WebSocket handlers gate with {@code permissions.contains(CONSTANT)} against the
 *       raw JWT claim — a real gate, in a form this file could not read.</li>
 *   <li><b>Fixtures.</b> {@code policies/tests/*.rego} were inside the scanned file set the whole
 *       time; the {@code has_permission(input, "…")} regex simply never matched the
 *       {@code base_user([…])} lists where five phantoms live.</li>
 *   <li><b>Vacuity.</b> The catalog side had a size floor. The ENFORCED side had none. A scan that
 *       returned nothing — wrong working directory, a moved module, a refactor to a SpEL idiom the
 *       regex no longer reads — subtracted an empty set from the catalog and passed green. That is
 *       this repository's signature defect wearing the costume of its own countermeasure.</li>
 * </ul>
 *
 * <p>All four are closed below. The floors and the negative control are the important half: a
 * comparison that cannot fail is not a control, and until now nothing here proved this one could.
 */
class PermissionCatalogClosureTest {

    /** {@code hasAuthority('x')} / {@code hasAnyAuthority("x", 'y')} — quoted codes inside the SpEL. */
    private static final Pattern SPEL_AUTHORITY = Pattern.compile("has(?:Any)?Authority\\(([^)]*)\\)");

    /** A permission code: lowercase dotted segments. */
    private static final String CODE = "[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+";

    /**
     * Either quote style.
     *
     * <p>Single-quote-only was a live blind spot, not a hypothetical one: the Spring Security
     * {@code authorizeHttpRequests} DSL takes {@code .hasAuthority("code")} with DOUBLE quotes, and
     * {@link #SPEL_AUTHORITY} matches that call perfectly — it just yielded zero codes from the
     * argument list and dropped the gate silently.
     */
    private static final Pattern QUOTED = Pattern.compile("['\"](" + CODE + ")['\"]");

    /**
     * {@code permissions.contains("pos.kds.view")} — the raw-JWT-claim idiom.
     *
     * <p>Used by every WebSocket handler, because a {@code @PreAuthorize} cannot run on a socket
     * upgrade. {@code KdsWebSocketHandler}, {@code PosOrderWebSocketHandler} and
     * {@code DashboardWebSocketHandler} are three real authorization gates that this file was blind
     * to for its entire existence.
     */
    private static final Pattern CLAIM_CONTAINS = Pattern.compile(
            "(?:permissions|authorities|perms)\\s*\\.\\s*contains\\(\\s*\"(" + CODE + ")\"\\s*\\)");

    /** {@code static final String VIEW_PERMISSION = "pos.order.view";} — the same gate, hoisted. */
    private static final Pattern PERMISSION_CONSTANT = Pattern.compile(
            "static\\s+final\\s+String\\s+\\w*(?:PERMISSION|AUTHORITY|PERM)\\w*\\s*=\\s*\"(" + CODE + ")\"");

    /** {@code common.has_permission(input, "x")} in Rego. */
    private static final Pattern REGO_PERMISSION =
            Pattern.compile("has_permission\\(\\s*input\\s*,\\s*\"([^\"]+)\"\\s*\\)");

    /** A Rego fixture's permission list: {@code base_user(["a","b"])} or {@code "permissions": [...]}. */
    private static final Pattern REGO_PERMISSION_LIST =
            Pattern.compile("\"permissions\"\\s*:\\s*\\[([^\\]]*)\\]|base_user\\(\\s*\\[([^\\]]*)\\]");

    /** {@code permission: "pos.order.view"} in a frontend nav-item definition. */
    private static final Pattern NAV_PERMISSION = Pattern.compile("permission:\\s*\"([^\"]+)\"");

    /** A permissions-table insert in a Liquibase changeset. */
    private static final Pattern CATALOG_INSERT = Pattern.compile(
            "<insert\\s+tableName=\"permissions\">\\s*<column\\s+name=\"code\"\\s+value=\"([^\"]+)\"",
            Pattern.DOTALL);

    /**
     * The repository root, found by walking up rather than by counting {@code ".."} levels.
     *
     * <p>{@code Path.of("..", "..")} is resolved against the JVM's working directory, which is
     * surefire's fork directory and happens to be this module. Nothing enforced that. If the module
     * moved one level, or a runner forked from the reactor root, every {@code sources(…)} call would
     * have resolved to a directory that does not exist, {@link #sources} would have returned an
     * empty list <em>without complaint</em>, and this test would have passed while comparing nothing
     * against the catalog. Anchoring on a marker removes the assumption entirely.
     */
    private static final Path REPO_ROOT = repoRoot();

    private static Path repoRoot() {
        Path dir = Path.of("").toAbsolutePath().normalize();
        for (Path p = dir; p != null; p = p.getParent()) {
            if (Files.isDirectory(p.resolve("services")) && Files.isDirectory(p.resolve("policies"))) {
                return p;
            }
        }
        throw new IllegalStateException(
                "repository root not found above " + dir + " (looked for services/ and policies/); "
                        + "every scan below would have been silently empty");
    }

    /**
     * Per-source floors.
     *
     * <p>Deliberately close to today's real counts. A floor of 1 would satisfy the letter of
     * "not vacuous" while still letting a regex that stopped matching 60 of 66 gates pass.
     */
    private static final Map<String, Integer> ENFORCED_FLOOR = Map.of(
            "@PreAuthorize / JWT-claim checks (services, gateway, shared-lib)", 60,
            "policies/**/*.rego (has_permission)", 30);

    @Test
    void everyEnforcedPermissionExistsInTheCatalog() throws IOException {
        Set<String> catalog = catalogCodes();
        assertThat(catalog)
                .as("catalog parsed from the changelog; an empty set means the scan broke, not that "
                        + "the catalog is empty")
                .hasSizeGreaterThan(40);

        Map<String, Set<String>> enforcedBySource = new TreeMap<>();
        enforcedBySource.put("@PreAuthorize / JWT-claim checks (services, gateway, shared-lib)",
                javaAuthorities());
        enforcedBySource.put("policies/**/*.rego (has_permission)", regoPermissions());

        // The floors run BEFORE the comparison, because an empty enforced set makes the comparison
        // below pass no matter how much drift exists. This is the assertion whose absence made the
        // original version of this test unable to fail for the most likely reason it would break.
        enforcedBySource.forEach((source, codes) -> assertThat(codes)
                .as("Codes scanned from %s. This is a FLOOR, not a target: the scan is a regex over "
                        + "source text, and the way it breaks is by quietly matching less. If this "
                        + "fails after a legitimate refactor, fix the pattern and lower the floor "
                        + "deliberately — do not delete the check, because without it this whole "
                        + "test passes on an empty input set.", source)
                .hasSizeGreaterThanOrEqualTo(ENFORCED_FLOOR.get(source)));

        assertThat(missingFrom(catalog, enforcedBySource))
                .as("Permission codes that are ENFORCED but that the catalog never defines. No role "
                        + "can hold these, so the guarded feature is unreachable for every user on "
                        + "every tenant — including OWNER — and it fails as a normal-looking 403 or "
                        + "an empty list. Either add the code (and its grants) in a changeset under "
                        + "services/auth-service/src/main/resources/db/changelog/v1.0.0/, or correct "
                        + "the enforcement to name a code that exists.")
                .isEmpty();
    }

    /**
     * The negative control: this comparison must be able to fail, and must name the offender.
     *
     * <p>Run against synthetic input rather than by mutating a real file, so the guard against a
     * silently-vacuous assertion is permanent and runs on every build. {@code FeatureCodeClosureTest}
     * has had one of these since it was written; this test did not, which is why nothing ever
     * demonstrated that its central {@code isEmpty()} was reachable.
     */
    @Test
    void driftIsReportedWithBothTheCodeAndItsSource() {
        Set<String> catalog = Set.of("pos.order.view", "finance.journal.view");
        Map<String, Set<String>> enforced = new TreeMap<>();
        enforced.put("source-a", new TreeSet<>(Set.of("pos.order.view", "pos.report.view")));
        enforced.put("source-b", new TreeSet<>(Set.of("finance.journal.view")));

        assertThat(missingFrom(catalog, enforced))
                .containsExactly(Map.entry("source-a", Set.of("pos.report.view")));
    }

    /**
     * Rego FIXTURES name real permissions too.
     *
     * <p>{@code policies/tests/*.rego} were always inside the scanned file set — the
     * {@code has_permission(input, "…")} pattern simply never matched a {@code base_user([…])} list,
     * so five phantoms sat in the policy suite unnoticed.
     *
     * <p>A fixture phantom is not a broken gate; it is a broken TEST. {@code kds_test.rego} builds
     * "a FINANCE_VIEWER" out of {@code finance.report.view} — a code no role holds — and asserts the
     * KDS refuses them. It does refuse them, but only because that user holds nothing at all. The
     * test would pass identically if the KDS rule accepted every real finance code in the catalogue.
     * A negative control built from a permission that does not exist proves the denial of a user who
     * does not exist.
     */
    @Test
    void everyPermissionInAPolicyFixtureExistsInTheCatalog() throws IOException {
        Set<String> catalog = catalogCodes();
        Map<String, Set<String>> byFile = new TreeMap<>();
        for (Path rego : sources("policies", ".rego")) {
            String text = Files.readString(rego, StandardCharsets.UTF_8);
            Matcher list = REGO_PERMISSION_LIST.matcher(text);
            while (list.find()) {
                String body = list.group(1) != null ? list.group(1) : list.group(2);
                Matcher code = Pattern.compile("\"(" + CODE + ")\"").matcher(body);
                while (code.find()) {
                    byFile.computeIfAbsent(rego.getFileName().toString(), k -> new TreeSet<>())
                            .add(code.group(1));
                }
            }
        }
        assertThat(byFile.values().stream().mapToInt(Set::size).sum())
                .as("permission codes read out of Rego fixture lists; a zero here means the pattern "
                        + "stopped matching, not that the fixtures stopped naming permissions")
                .isGreaterThanOrEqualTo(40);

        assertThat(withoutKnownDebt(missingFrom(catalog, byFile)))
                .as("Permission codes a POLICY FIXTURE grants that the catalog never defines. The "
                        + "policy passes; the test that proves it does is the thing that is broken. "
                        + "Build the fixture from codes a real role actually holds, so a denial "
                        + "means the rule denied a plausible user rather than an empty one.")
                .isEmpty();
    }

    /**
     * Frontend nav gates name real permissions too.
     *
     * <p>The frontend is where an unseeded code is most invisible: {@code PermissionGuard} and
     * {@code useNavGroupVisibility} both resolve to {@code permissions.includes(code)}, so a phantom
     * is indistinguishable from "this user is not allowed" — the item is simply never drawn, for
     * anyone, forever, with no request, no 403 and no log line.
     *
     * <p>Codes are compared as literal strings rather than through a dotted-code regex on purpose:
     * the two phantoms this found ({@code platform:tenant:read}, {@code platform:admin}) are
     * COLON-delimited, and a scan that assumed the house naming convention would have skipped them
     * as "not a permission code" — which is exactly how they survived every previous sweep.
     */
    @Test
    void everyFrontendNavPermissionExistsInTheCatalog() throws IOException {
        Set<String> catalog = catalogCodes();
        Map<String, Set<String>> byFile = new TreeMap<>();
        for (String relative : List.of(
                "frontend/components/shared/sidebar-nav-items.ts",
                "frontend/components/shared/mobile-bottom-nav.tsx",
                "frontend/components/dashboard/presets.ts")) {
            Path file = REPO_ROOT.resolve(relative);
            assertThat(file)
                    .as("nav config scanned by this test. If this file moved, the scan below reads "
                            + "nothing and passes — point it at the new path, do not delete the entry.")
                    .exists();
            Matcher m = NAV_PERMISSION.matcher(Files.readString(file, StandardCharsets.UTF_8));
            while (m.find()) {
                byFile.computeIfAbsent(relative, k -> new TreeSet<>()).add(m.group(1));
            }
        }
        assertThat(byFile.values().stream().mapToInt(Set::size).sum())
                .as("permission codes read out of the frontend nav config")
                .isGreaterThanOrEqualTo(12);

        assertThat(withoutKnownDebt(missingFrom(catalog, byFile)))
                .as("Permission codes a NAV ITEM gates on that the catalog never defines. The item "
                        + "is hidden from every user on every tenant, and looks exactly like a "
                        + "correctly-applied permission. Either seed the code or gate on one that "
                        + "exists — deleting the gate is not a fix, it ungates the item.")
                .isEmpty();
    }

    /**
     * The nine phantoms the 2026-08-12 audit found, recorded so that the TENTH fails the build.
     *
     * <p>This is debt, not an exemption. Every entry is a code referenced somewhere and seeded
     * nowhere; none is a live production gate today, which is the only reason this list is allowed
     * to exist instead of the build being red. Remove entries as they are fixed; never add one
     * without a reference and a reason.
     *
     * <ul>
     *   <li>{@code branch.view}, {@code rbac.user.view} — {@code policies/tests/rbac_test.rego:115}.
     *       Plausible-looking read counterparts to {@code branch.manage} / {@code rbac.user.manage}
     *       that were never seeded. Fix: build the fixture from the real codes.</li>
     *   <li>{@code pos.order.read} — {@code common_test.rego:45}, {@code pos_test.rego:63},
     *       {@code rbac_test.rego:47}. The catalogue says {@code pos.order.view}.</li>
     *   <li>{@code finance.report.view}, {@code finance.period.manage} — {@code kds_test.rego},
     *       {@code inventory_test.rego}, and {@code KdsAccessIsolationIT}. An "ACCOUNTANT" built
     *       from two codes no accountant holds; the real ones are {@code finance.journal.view} /
     *       {@code finance.coa.view} and {@code finance.period.open} / {@code .close}.</li>
     *   <li>{@code platform:tenant:read}, {@code platform:admin} —
     *       {@code sidebar-nav-items.ts:413,420}. The SuperAdmin nav gates on a colon-delimited
     *       scheme that exists in no catalogue and in no token; the platform JWT carries the ROLE
     *       {@code SUPER_ADMIN}, which is what {@code PlatformAdminController} actually checks.
     *       Latent only because {@code platformNavItems} is currently rendered by nothing.</li>
     *   <li>{@code pos.till.manage} ({@code CashPaymentRequiresTillIT:83,134}),
     *       {@code pos.orders.create} ({@code MenuStationRoutingIT:282}) — Java IT fixtures; the
     *       real codes are {@code pos.till.open}/{@code .close} and {@code pos.order.create}. Not
     *       listed here because this test does not scan {@code src/test} Java at all — recorded so
     *       the audit's list stays whole.</li>
     * </ul>
     */
    private static final Set<String> KNOWN_UNSEEDED = Set.of(
            "branch.view",
            "rbac.user.view",
            "pos.order.read",
            "finance.report.view",
            "finance.period.manage",
            "platform:tenant:read",
            "platform:admin");

    // ── Helpers ───────────────────────────────────────────────────────────────────────────────

    /** source → the codes it names that the catalog does not define, sources with no gap omitted. */
    private static Map<String, Set<String>> missingFrom(
            Set<String> catalog, Map<String, Set<String>> referencedBySource) {
        Map<String, Set<String>> missing = new TreeMap<>();
        referencedBySource.forEach((source, codes) -> {
            Set<String> gap = new TreeSet<>(codes);
            gap.removeAll(catalog);
            if (!gap.isEmpty()) {
                missing.put(source, gap);
            }
        });
        return missing;
    }

    private static Map<String, Set<String>> withoutKnownDebt(Map<String, Set<String>> missing) {
        Map<String, Set<String>> remaining = new TreeMap<>();
        missing.forEach((source, codes) -> {
            Set<String> gap = new TreeSet<>(codes);
            gap.removeAll(KNOWN_UNSEEDED);
            if (!gap.isEmpty()) {
                remaining.put(source, gap);
            }
        });
        return remaining;
    }

    /**
     * Grants must also name real permissions. {@code pos.order.void.own} sat in
     * {@code role_permissions} with no matching {@code permissions} row: it reached the JWT, so
     * voids worked, but anything reading the catalog to answer "what can this role do" was wrong.
     */
    @Test
    void everyGrantedPermissionExistsInTheCatalog() throws IOException {
        Set<String> catalog = catalogCodes();
        Set<String> granted = new TreeSet<>();
        Pattern grant = Pattern.compile(
                "<insert\\s+tableName=\"role_permissions\">.*?name=\"permission_code\"\\s+value=\"([^\"]+)\"",
                Pattern.DOTALL);
        // Raw-SQL grants too: several changesets write INSERT INTO role_permissions ... VALUES
        // ('ROLE','some.code') instead of the attribute form, and a scan that sees only one of the
        // two silently under-reports. That is not hypothetical — measuring this repo's grant drift
        // with an attribute-only parser reported ~46 undeclared grants when the real number was
        // one, because it could not see the blanket SELECT-based grants in 030/041/042.
        Pattern sqlGrant = Pattern.compile(
                "\\(\\s*'[A-Z_]+'\\s*,\\s*'([a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_*]*)+)'\\s*\\)");
        for (Path changeset : changesets()) {
            String xml = withoutRollbacks(Files.readString(changeset, StandardCharsets.UTF_8));
            Matcher m = grant.matcher(xml);
            while (m.find()) {
                granted.add(m.group(1));
            }
            for (String block : sqlInsertBlocks(xml, "role_permissions")) {
                Matcher sm = sqlGrant.matcher(block);
                while (sm.find()) {
                    granted.add(sm.group(1));
                }
            }
        }
        assertThat(granted).as("grants parsed from the changelog").isNotEmpty();

        Set<String> orphans = new TreeSet<>(granted);
        orphans.removeAll(catalog);
        assertThat(orphans)
                .as("Codes granted to a role that the permissions table never defines")
                .isEmpty();
    }

    /** Every {@code INSERT INTO <table> …;} statement in a changeset, raw-SQL form. */
    private static List<String> sqlInsertBlocks(String xml, String table) {
        Pattern block = Pattern.compile("INSERT\\s+INTO\\s+" + table + "[^;]*;",
                Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
        List<String> blocks = new java.util.ArrayList<>();
        Matcher m = block.matcher(xml);
        while (m.find()) {
            blocks.add(m.group());
        }
        return blocks;
    }

    /**
     * Every permission code the changelog DECLARES, in either form.
     *
     * <p>Both forms have to be read. The attribute form ({@code <insert tableName="permissions">})
     * was all this parsed originally, so the four codes changeset 049 declares in raw SQL looked
     * undeclared — and the same blind spot, applied to grants, is what once made a one-row drift
     * measure as forty-six.
     */
    private static Set<String> catalogCodes() throws IOException {
        Pattern sqlCatalog = Pattern.compile("\\(\\s*'([a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+)'\\s*,");
        Set<String> codes = new LinkedHashSet<>();
        for (Path changeset : changesets()) {
            String xml = withoutRollbacks(Files.readString(changeset, StandardCharsets.UTF_8));
            Matcher m = CATALOG_INSERT.matcher(xml);
            while (m.find()) {
                codes.add(m.group(1));
            }
            for (String block : sqlInsertBlocks(xml, "permissions")) {
                Matcher sm = sqlCatalog.matcher(block);
                while (sm.find()) {
                    codes.add(sm.group(1));
                }
            }
        }
        return codes;
    }

    /**
     * Strips {@code <rollback>} bodies before scanning.
     *
     * <p>A rollback deliberately re-creates what its forward path removed — changeset 054 restores
     * the retired {@code pos.order.void} row — so counting rollback statements as declarations or
     * grants reports the very thing the changeset exists to delete.
     */
    private static String withoutRollbacks(String xml) {
        return xml.replaceAll("(?s)<rollback>.*?</rollback>", "");
    }

    private static List<Path> changesets() throws IOException {
        Path dir = REPO_ROOT.resolve("services/auth-service/src/main/resources/db/changelog");
        try (Stream<Path> paths = Files.walk(dir)) {
            return paths.filter(p -> p.toString().endsWith(".xml")).toList();
        }
    }

    /**
     * Every permission code Java enforcement names, in every idiom this system uses.
     *
     * <p>{@code gateway} and {@code shared-lib} are scanned alongside {@code services} because
     * "authorization lives in a service" was an assumption, not a rule: {@code JwtGlobalFilter} and
     * {@code JwtAuthenticationFilter} are both authorization code, and a gate written in either was
     * invisible here.
     */
    private static Set<String> javaAuthorities() throws IOException {
        Set<String> codes = new TreeSet<>();
        for (String module : List.of("services", "gateway", "shared-lib")) {
            for (Path java : sources(module, ".java")) {
                String txt = Files.readString(java, StandardCharsets.UTF_8);
                Matcher expr = SPEL_AUTHORITY.matcher(txt);
                while (expr.find()) {
                    Matcher quoted = QUOTED.matcher(expr.group(1));
                    while (quoted.find()) {
                        codes.add(quoted.group(1));
                    }
                }
                collect(CLAIM_CONTAINS, txt, codes);
                collect(PERMISSION_CONSTANT, txt, codes);
            }
        }
        return codes;
    }

    private static void collect(Pattern pattern, String text, Set<String> into) {
        Matcher m = pattern.matcher(text);
        while (m.find()) {
            into.add(m.group(1));
        }
    }

    private static Set<String> regoPermissions() throws IOException {
        Set<String> codes = new TreeSet<>();
        for (Path rego : sources("policies", ".rego")) {
            Matcher m = REGO_PERMISSION.matcher(Files.readString(rego, StandardCharsets.UTF_8));
            while (m.find()) {
                codes.add(m.group(1));
            }
        }
        return codes;
    }

    private static List<Path> sources(String relativeDir, String extension) throws IOException {
        Path dir = REPO_ROOT.resolve(relativeDir);
        if (!Files.isDirectory(dir)) {
            return List.of();
        }
        try (Stream<Path> paths = Files.walk(dir)) {
            return paths.filter(p -> p.toString().endsWith(extension))
                    .filter(p -> !p.toString().contains("target"))
                    .filter(p -> !p.toString().contains("src\\test") && !p.toString().contains("src/test"))
                    .toList();
        }
    }
}
