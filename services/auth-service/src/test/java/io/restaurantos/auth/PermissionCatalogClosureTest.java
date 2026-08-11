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

    /**
     * {@code permission: "pos.order.view"} OR {@code permission: ["a", "b"]} in a nav-item.
     *
     * <p>Both forms, because both are live. The array form arrived with the 37-12 Finance/Takings
     * work — {@code permission: ["finance.journal.view", "pos.order.view.all", "pos.till.review"]}
     * with {@code permissionMode: "any"} — and a scan that read only the scalar form would have
     * silently skipped three real gates on the day they were written. That is the same class of
     * miss this whole file exists to close, so it is worth stating: the pattern must track the
     * config's shape, and when the config grows a shape, this grows with it.
     */
    private static final Pattern NAV_PERMISSION =
            Pattern.compile("permission:\\s*(\\[[^\\]]*\\]|\"[^\"]*\")");

    /** Any quoted string, whatever the naming convention — see the frontend test for why. */
    private static final Pattern QUOTED_ANY = Pattern.compile("\"([^\"]+)\"");

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
    private static final int JAVA_FLOOR = 60;
    private static final int REGO_FLOOR = 30;

    @Test
    void everyEnforcedPermissionExistsInTheCatalog() throws IOException {
        Set<String> catalog = catalogCodes();
        assertThat(catalog)
                .as("catalog parsed from the changelog; an empty set means the scan broke, not that "
                        + "the catalog is empty")
                .hasSizeGreaterThan(40);

        Map<String, Set<String>> java = javaAuthorities();
        Map<String, Set<String>> rego = regoPermissions();

        // The floors run BEFORE the comparison, because an empty enforced set makes the comparison
        // below pass no matter how much drift exists. This is the assertion whose absence made the
        // original version of this test unable to fail for the most likely reason it would break.
        assertFloor(java, JAVA_FLOOR, "@PreAuthorize / JWT-claim checks in services, gateway, shared-lib");
        assertFloor(rego, REGO_FLOOR, "has_permission() in policies/**/*.rego");

        Map<String, Set<String>> enforced = new TreeMap<>(java);
        rego.forEach((code, where) ->
                enforced.computeIfAbsent(code, k -> new TreeSet<>()).addAll(where));

        assertThat(missingFrom(catalog, enforced))
                .as("Permission codes that are ENFORCED but that the catalog never defines, each "
                        + "listed with EVERY file and line that names it — start there.%n"
                        + "No role can hold these, so the guarded feature is unreachable for every "
                        + "user on every tenant, including OWNER, and it fails as a normal-looking "
                        + "403 or an empty list. Either add the code (and its grants) in a changeset "
                        + "under services/auth-service/src/main/resources/db/changelog/v1.0.0/, or "
                        + "correct the enforcement to name a code that exists. Deleting the gate is "
                        + "not a fix: it ungates the endpoint.%n"
                        + "This test lives in auth-service because auth-service owns the catalogue, "
                        + "but it reads the whole repository — so the offending line is very often "
                        + "in a module you are not working in.")
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
    void driftIsReportedWithBothTheCodeAndTheLineThatNamesIt() {
        Set<String> catalog = Set.of("pos.order.view", "finance.journal.view");
        Map<String, Set<String>> referenced = new TreeMap<>();
        referenced.put("pos.order.view", new TreeSet<>(Set.of("a/Ok.java:10")));
        referenced.put("finance.journal.view", new TreeSet<>(Set.of("a/Ok.java:11")));
        referenced.put("pos.report.view", new TreeSet<>(Set.of("a/Bad.java:12", "b/Also.rego:3")));

        assertThat(missingFrom(catalog, referenced))
                .containsExactly(Map.entry(
                        "pos.report.view", Set.of("a/Bad.java:12", "b/Also.rego:3")));
    }

    /** A floor on the number of distinct codes a scanner found, asserted before any comparison. */
    private static void assertFloor(Map<String, Set<String>> refs, int floor, String source) {
        assertThat(refs.keySet())
                .as("Distinct permission codes scanned from %s. This is a FLOOR, not a target: the "
                        + "scan is a regex over source text, and the way it breaks is by quietly "
                        + "matching less. If this fails after a legitimate refactor, fix the pattern "
                        + "and lower the floor deliberately — do not delete the check, because "
                        + "without it this whole test passes on an empty input set.", source)
                .hasSizeGreaterThanOrEqualTo(floor);
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
        Map<String, Set<String>> refs = new TreeMap<>();
        for (Path rego : sources("policies", ".rego")) {
            String text = Files.readString(rego, StandardCharsets.UTF_8);
            Matcher list = REGO_PERMISSION_LIST.matcher(text);
            while (list.find()) {
                String body = list.group(1) != null ? list.group(1) : list.group(2);
                int bodyStart = text.indexOf(body, list.start());
                Matcher code = Pattern.compile("\"(" + CODE + ")\"").matcher(body);
                while (code.find()) {
                    record(refs, code.group(1), rego, text, bodyStart + code.start());
                }
            }
        }
        assertThat(refs.keySet())
                .as("distinct permission codes read out of Rego fixture lists; a small set here "
                        + "means the pattern stopped matching, not that the fixtures stopped naming "
                        + "permissions")
                .hasSizeGreaterThanOrEqualTo(35);

        assertThat(withoutKnownDebt(missingFrom(catalog, refs)))
                .as("Permission codes a POLICY FIXTURE grants that the catalog never defines, each "
                        + "with the file and line to fix.%n"
                        + "The policy is fine; the test that proves it is the broken thing. A "
                        + "fixture built from a code no role holds denies a user who cannot exist, "
                        + "so the rule could be widened to accept a real neighbouring code and this "
                        + "suite would stay green. Rebuild the fixture from codes the named role "
                        + "actually holds — `SELECT permission_code FROM role_permissions WHERE "
                        + "role_code = '<ROLE>'`.")
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
        Map<String, Set<String>> refs = new TreeMap<>();
        for (String relative : List.of(
                "frontend/components/shared/sidebar-nav-items.ts",
                "frontend/components/shared/mobile-bottom-nav.tsx",
                "frontend/components/dashboard/presets.ts")) {
            Path file = REPO_ROOT.resolve(relative);
            assertThat(file)
                    .as("nav config scanned by this test. If this file moved, the scan below reads "
                            + "nothing and passes — point it at the new path, do not delete the entry.")
                    .exists();
            String text = Files.readString(file, StandardCharsets.UTF_8);
            Matcher m = NAV_PERMISSION.matcher(text);
            while (m.find()) {
                Matcher code = QUOTED_ANY.matcher(m.group(1));
                while (code.find()) {
                    record(refs, code.group(1), file, text, m.start(1) + code.start());
                }
            }
        }
        assertThat(refs.keySet())
                .as("distinct permission codes read out of the frontend nav config")
                .hasSizeGreaterThanOrEqualTo(12);

        assertThat(withoutKnownDebt(missingFrom(catalog, refs)))
                .as("Permission codes a NAV ITEM gates on that the catalog never defines, each with "
                        + "the file and line that names it.%n"
                        + "The item is hidden from every user on every tenant, and looks exactly "
                        + "like a correctly-applied permission — no request, no 403, no log line. "
                        + "Gate on a code that exists (or on a role, if that is what the backend "
                        + "checks); deleting the gate is not a fix, it ungates the item.%n"
                        + "Yes, this is the auth-service build failing over a frontend file. That "
                        + "is deliberate: the catalogue lives here, and a silently-vanishing menu "
                        + "item costs far more than a surprising failure location.")
                .isEmpty();
    }

    /**
     * What is left of the nine phantoms the 2026-08-12 audit found, so that the tenth fails the build.
     *
     * <p>Debt, not an exemption. Every entry is a code referenced somewhere and seeded nowhere;
     * neither is a live production gate today, which is the only reason this list is allowed to
     * exist instead of the build being red. Remove entries as they are fixed; never add one without
     * a reference and a reason.
     *
     * <p><b>Fixed and removed from this list</b> in the same change that added it — seven of nine:
     * {@code finance.report.view} and {@code finance.period.manage} (the "ACCOUNTANT" in
     * {@code kds_test.rego} and {@code KdsAccessIsolationIT} now holds the four codes the role
     * really has, including {@code pos.order.view} — the near-miss that makes the denial mean
     * something); {@code pos.order.read} → {@code pos.order.view} in {@code common_test.rego},
     * {@code pos_test.rego}, {@code rbac_test.rego}; {@code branch.view} / {@code rbac.user.view} →
     * {@code audit.log.view} in {@code rbac_test.rego}; {@code pos.till.manage} →
     * {@code pos.till.open}/{@code .close} in {@code CashPaymentRequiresTillIT};
     * {@code pos.orders.create} → {@code pos.order.create} in {@code MenuStationRoutingIT}.
     *
     * <p><b>Remaining — both blocked, not deferred.</b> {@code platform:tenant:read} and
     * {@code platform:admin} gate the two {@code platformNavItems} entries in
     * {@code frontend/components/shared/sidebar-nav-items.ts}. They use a colon-delimited scheme
     * that exists in no catalogue and in no token: the platform JWT carries the ROLE
     * {@code SUPER_ADMIN}, which is what {@code PlatformAdminController} and
     * {@code PlatformUserAdminController} actually check, so the fix is to gate on that role and
     * NOT to seed these codes. They are latent rather than live only because {@code platformNavItems}
     * is currently imported by nothing. The file was being edited by another workstream when this
     * was written; the exact patch is in {@code .planning/audits/PERMISSION-CODE-AUDIT.md} §6.
     */
    private static final Set<String> KNOWN_UNSEEDED = Set.of(
            "platform:tenant:read",
            "platform:admin");

    // ── Helpers ───────────────────────────────────────────────────────────────────────────────

    /**
     * Records one reference as {@code code → {"relative/path.java:42", …}}.
     *
     * <p>The location is the point of the whole structure. This test runs in auth-service and reads
     * the entire repository, so when it fails the offending line is usually in a module the reader
     * is not working in and did not touch. A bare code name sends them grepping; a path and a line
     * number sends them to the fix.
     */
    private static void record(
            Map<String, Set<String>> refs, String code, Path file, String text, int offset) {
        refs.computeIfAbsent(code, k -> new TreeSet<>()).add(location(file, text, offset));
    }

    private static String location(Path file, String text, int offset) {
        int line = 1;
        for (int i = 0; i < offset && i < text.length(); i++) {
            if (text.charAt(i) == '\n') {
                line++;
            }
        }
        return REPO_ROOT.relativize(file.toAbsolutePath()) + ":" + line;
    }

    /** code → every location that names it, keeping only codes the catalog does not define. */
    private static Map<String, Set<String>> missingFrom(
            Set<String> catalog, Map<String, Set<String>> referenced) {
        Map<String, Set<String>> missing = new TreeMap<>(referenced);
        missing.keySet().removeAll(catalog);
        return missing;
    }

    private static Map<String, Set<String>> withoutKnownDebt(Map<String, Set<String>> missing) {
        Map<String, Set<String>> remaining = new TreeMap<>(missing);
        remaining.keySet().removeAll(KNOWN_UNSEEDED);
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
    private static Map<String, Set<String>> javaAuthorities() throws IOException {
        Map<String, Set<String>> refs = new TreeMap<>();
        for (String module : List.of("services", "gateway", "shared-lib")) {
            for (Path java : sources(module, ".java")) {
                String txt = Files.readString(java, StandardCharsets.UTF_8);
                Matcher expr = SPEL_AUTHORITY.matcher(txt);
                while (expr.find()) {
                    Matcher quoted = QUOTED.matcher(expr.group(1));
                    while (quoted.find()) {
                        record(refs, quoted.group(1), java, txt, expr.start(1) + quoted.start());
                    }
                }
                collect(CLAIM_CONTAINS, txt, java, refs);
                collect(PERMISSION_CONSTANT, txt, java, refs);
            }
        }
        return refs;
    }

    private static void collect(
            Pattern pattern, String text, Path file, Map<String, Set<String>> refs) {
        Matcher m = pattern.matcher(text);
        while (m.find()) {
            record(refs, m.group(1), file, text, m.start(1));
        }
    }

    private static Map<String, Set<String>> regoPermissions() throws IOException {
        Map<String, Set<String>> refs = new TreeMap<>();
        for (Path rego : sources("policies", ".rego")) {
            String text = Files.readString(rego, StandardCharsets.UTF_8);
            collect(REGO_PERMISSION, text, rego, refs);
        }
        return refs;
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
