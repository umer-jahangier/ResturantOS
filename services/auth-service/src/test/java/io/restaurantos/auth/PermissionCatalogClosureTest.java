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
 * <p>Sources scanned: {@code @PreAuthorize} expressions across every service, and the Rego policies
 * under {@code policies/}. Target: the {@code permissions} inserts in the Liquibase changelog. Both
 * are read from the repository tree rather than a running database, so this stays a fast unit test
 * and fails on the branch that introduces the drift rather than in whichever environment someone
 * first clicks the feature.
 */
class PermissionCatalogClosureTest {

    /** {@code hasAuthority('x')} / {@code hasAnyAuthority('x','y')} — quoted codes inside the SpEL. */
    private static final Pattern SPEL_AUTHORITY = Pattern.compile("has(?:Any)?Authority\\(([^)]*)\\)");
    private static final Pattern QUOTED = Pattern.compile("'([a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+)'");
    /** {@code common.has_permission(input, "x")} in Rego. */
    private static final Pattern REGO_PERMISSION =
            Pattern.compile("has_permission\\(\\s*input\\s*,\\s*\"([^\"]+)\"\\s*\\)");
    /** A permissions-table insert in a Liquibase changeset. */
    private static final Pattern CATALOG_INSERT = Pattern.compile(
            "<insert\\s+tableName=\"permissions\">\\s*<column\\s+name=\"code\"\\s+value=\"([^\"]+)\"",
            Pattern.DOTALL);

    private static final Path REPO_ROOT = Path.of("..", "..").toAbsolutePath().normalize();

    @Test
    void everyEnforcedPermissionExistsInTheCatalog() throws IOException {
        Set<String> catalog = catalogCodes();
        assertThat(catalog)
                .as("catalog parsed from the changelog; an empty set means the scan broke, not that "
                        + "the catalog is empty")
                .hasSizeGreaterThan(40);

        Map<String, Set<String>> enforcedBySource = new TreeMap<>();
        enforcedBySource.put("@PreAuthorize", javaAuthorities());
        enforcedBySource.put("policies/*.rego", regoPermissions());

        Map<String, Set<String>> missing = new TreeMap<>();
        enforcedBySource.forEach((source, codes) -> {
            Set<String> gap = new TreeSet<>(codes);
            gap.removeAll(catalog);
            if (!gap.isEmpty()) {
                missing.put(source, gap);
            }
        });

        assertThat(missing)
                .as("Permission codes that are ENFORCED but that the catalog never defines. No role "
                        + "can hold these, so the guarded feature is unreachable for every user on "
                        + "every tenant — including OWNER — and it fails as a normal-looking 403 or "
                        + "an empty list. Either add the code (and its grants) in a changeset under "
                        + "services/auth-service/src/main/resources/db/changelog/v1.0.0/, or correct "
                        + "the enforcement to name a code that exists.")
                .isEmpty();
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

    private static Set<String> javaAuthorities() throws IOException {
        Set<String> codes = new TreeSet<>();
        for (Path java : sources("services", ".java")) {
            String txt = Files.readString(java, StandardCharsets.UTF_8);
            Matcher expr = SPEL_AUTHORITY.matcher(txt);
            while (expr.find()) {
                Matcher quoted = QUOTED.matcher(expr.group(1));
                while (quoted.find()) {
                    codes.add(quoted.group(1));
                }
            }
        }
        return codes;
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
