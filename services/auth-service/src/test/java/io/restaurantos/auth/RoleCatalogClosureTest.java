package io.restaurantos.auth;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Every role a grant names is a role the catalog actually defines.
 *
 * <p>{@code PermissionCatalogClosureTest} closes the same loop one column over — it checks that
 * every {@code role_permissions.permission_code} names a real {@code permissions} row. This checks
 * the other column: that every {@code role_permissions.role_code} names a real {@code roles} row.
 * The two are genuinely independent, and the gap between them is not hypothetical:
 *
 * <h2>What this catches, and what it deliberately does not</h2>
 *
 * <p>It catches the SOURCE-level form: a changeset that grants to a role code the changelog never
 * declares anywhere. That is a real and recurring shape, and it is caught here on the branch that
 * introduces it.
 *
 * <p>It does <b>not</b> catch the instance that prompted it, and pretending otherwise would be
 * worse than not having the test. {@code FINANCE_VIEWER} had two grants ({@code finance.coa.view}
 * from 037, {@code hr.payroll.view} from 045) and no {@code roles} row in the live {@code auth_db}
 * — but the changelog declares it perfectly well, in {@code 035-seed-system-roles}. The divergence
 * was in the DATABASE, not the source:
 *
 * <ul>
 *   <li>{@code 035} executed on 2026-06-24 (verified in {@code databasechangelog}).</li>
 *   <li>The {@code FINANCE_VIEWER} row was added to it on 2026-06-27, in commit {@code b63074a}.</li>
 *   <li>{@code runOnChange="false"} means the edit never re-applied, so an already-migrated database
 *       kept the six original roles forever while {@code 037} and {@code 045} granted to the
 *       seventh.</li>
 * </ul>
 *
 * <p>That is the same mechanism changeset 057 documents one table over, and no test that reads the
 * repository tree can see it — the tree is correct; it is the deployed rows that are not. The fix
 * for that half is a migration ({@code 082}), which repairs the rows and RAISEs if the repair does
 * not converge. This test covers the half a migration cannot: the drift that has not shipped yet.
 */
class RoleCatalogClosureTest {

    private static final Path REPO_ROOT = Path.of("..", "..").toAbsolutePath().normalize();

    /** {@code <insert tableName="roles"><column name="code" value="X"/>} */
    private static final Pattern ROLE_INSERT = Pattern.compile(
            "<insert\\s+tableName=\"roles\">\\s*<column\\s+name=\"code\"\\s+value=\"([^\"]+)\"",
            Pattern.DOTALL);
    /**
     * Raw-SQL role inserts, in BOTH forms the changelog uses:
     * {@code VALUES ('X', …)} and {@code SELECT NULL, 'X', …}.
     *
     * <p>Reading only the tuple form reported WAITER as an orphan. 055 inserts it with
     * {@code SELECT … WHERE NOT EXISTS}, because {@code tenant_id} is nullable and Postgres treats
     * NULLs in a unique constraint as distinct, so {@code ON CONFLICT} cannot guard it. A scanner
     * blind to one of two legitimate forms invents drift, which is worse than missing it — the same
     * blind spot once made a one-row permission drift measure as forty-six.
     */
    private static final Pattern SQL_ROLE = Pattern.compile(
            "(?:VALUES\\s*\\(|SELECT\\s+(?:NULL|null)\\s*,)\\s*'([A-Z][A-Z0-9_]*)'\\s*,");

    /** {@code <insert tableName="role_permissions"><column name="role_code" value="X"/>} */
    private static final Pattern GRANT_ROLE = Pattern.compile(
            "<insert\\s+tableName=\"role_permissions\">.*?name=\"role_code\"\\s+value=\"([^\"]+)\"",
            Pattern.DOTALL);
    /** Raw-SQL grant tuples: {@code ('ROLE', 'some.code')}. */
    private static final Pattern SQL_GRANT_ROLE = Pattern.compile(
            "\\(\\s*'([A-Z][A-Z0-9_]*)'\\s*,\\s*'[a-z][a-z0-9_.*]*'\\s*\\)");
    /** {@code INSERT INTO role_permissions … SELECT 'ROLE', code FROM permissions …} */
    private static final Pattern SQL_SELECT_GRANT_ROLE = Pattern.compile(
            "SELECT\\s+'([A-Z][A-Z0-9_]*)'\\s*,", Pattern.CASE_INSENSITIVE);

    @Test
    void everyGrantedRoleExistsInTheRoleCatalog() throws IOException {
        Set<String> roles = declaredRoles();
        Set<String> granted = grantedRoles();

        assertThat(roles)
                .as("roles parsed from the changelog; a small set means the scan broke, not that "
                        + "the catalog is empty")
                .hasSizeGreaterThan(4);
        assertThat(granted).as("role codes parsed from role_permissions inserts").isNotEmpty();

        Set<String> orphans = new TreeSet<>(granted);
        orphans.removeAll(roles);

        assertThat(orphans)
                .as("""
                    Role codes that role_permissions grants to, and that the roles table never \
                    defines.

                    A grant to a non-existent role is invisible at runtime — nobody holds the role, \
                    so nobody is refused anything, and RoleCatalog.requireKnown simply declines to \
                    offer it. What breaks is everything that reasons over the grant lattice: the \
                    role picker's ceiling check, any "what can this role do" report, and any future \
                    migration that joins the two tables. FINANCE_VIEWER sat in exactly this state \
                    with two grants and no role.

                    Either add the roles row or delete the grants.""")
                .isEmpty();
    }

    private static Set<String> declaredRoles() throws IOException {
        Set<String> codes = new TreeSet<>();
        for (Path changeset : changesets()) {
            String xml = withoutRollbacks(Files.readString(changeset, StandardCharsets.UTF_8));
            for (String block : changeSetBlocks(xml)) {
                Matcher m = ROLE_INSERT.matcher(block);
                while (m.find()) {
                    codes.add(m.group(1));
                }
                for (String sql : sqlInsertBlocks(block, "roles")) {
                    Matcher sm = SQL_ROLE.matcher(sql);
                    while (sm.find()) {
                        codes.add(sm.group(1));
                    }
                }
            }
        }
        return codes;
    }

    private static Set<String> grantedRoles() throws IOException {
        Set<String> codes = new TreeSet<>();
        for (Path changeset : changesets()) {
            String xml = withoutRollbacks(Files.readString(changeset, StandardCharsets.UTF_8));
            for (String block : changeSetBlocks(xml)) {
                Matcher m = GRANT_ROLE.matcher(block);
                while (m.find()) {
                    codes.add(m.group(1));
                }
                for (String sql : sqlInsertBlocks(block, "role_permissions")) {
                    Matcher sm = SQL_GRANT_ROLE.matcher(sql);
                    while (sm.find()) {
                        codes.add(sm.group(1));
                    }
                    Matcher sel = SQL_SELECT_GRANT_ROLE.matcher(sql);
                    while (sel.find()) {
                        codes.add(sel.group(1));
                    }
                }
            }
        }
        return codes;
    }

    /**
     * Each {@code <changeSet>…</changeSet>} body.
     *
     * <p>Per changeset rather than per file: 030 declares permissions and roles in separate
     * changesets of the same file, and the two are not interchangeable.
     */
    private static List<String> changeSetBlocks(String xml) {
        Pattern block = Pattern.compile("<changeSet\\b[^>]*>.*?</changeSet>", Pattern.DOTALL);
        List<String> blocks = new java.util.ArrayList<>();
        Matcher m = block.matcher(xml);
        while (m.find()) {
            blocks.add(m.group());
        }
        return blocks;
    }

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

    /** A rollback re-creates what its forward path removed; counting it reports the opposite. */
    private static String withoutRollbacks(String xml) {
        return xml.replaceAll("(?s)<rollback>.*?</rollback>", "");
    }

    private static List<Path> changesets() throws IOException {
        Path dir = REPO_ROOT.resolve("services/auth-service/src/main/resources/db/changelog");
        try (Stream<Path> paths = Files.walk(dir)) {
            return paths.filter(p -> p.toString().endsWith(".xml")).toList();
        }
    }
}
