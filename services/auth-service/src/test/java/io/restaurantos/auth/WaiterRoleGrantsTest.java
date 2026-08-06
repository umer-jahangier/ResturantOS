package io.restaurantos.auth;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * WAITER takes orders. It does not touch the till, void, refund, or settle a bill.
 *
 * <p>The point of seeding a WAITER role at all is that table staff currently have to be given
 * CASHIER, which carries {@code pos.till.open}, {@code pos.till.close} and
 * {@code pos.order.void.own}. If WAITER ever quietly acquires those, the role has stopped being
 * worth having and nothing else in the build would notice: an over-granted role produces a login
 * that works, an endpoint that answers 200, and a user who can do more than anyone intended.
 *
 * <p>So this asserts the boundary rather than the seed. It scans <em>every</em> changeset in the
 * auth-service changelog for a WAITER grant in either the attribute form or the raw-SQL form, and
 * fails on the branch that widens the role — including a changeset written months from now that
 * knows nothing about this file. It needs no database and no container, so it cannot be skipped by
 * an environment that will not run integration tests.
 */
class WaiterRoleGrantsTest {

    private static final Path REPO_ROOT = Path.of("..", "..").toAbsolutePath().normalize();

    /**
     * Permission families a waiter must never hold. Prefix-matched, so a future
     * {@code pos.till.audit} or {@code pos.order.void.supervised} is caught the day it is granted
     * rather than the day someone audits the role.
     */
    private static final List<String> FORBIDDEN_PREFIXES = List.of(
            "pos.till.",          // opening, closing, reconciling and reviewing the drawer
            "pos.order.void",     // .own and .any alike — a void is a supervisor action
            "pos.order.refund",   // money leaving the drawer
            "pos.order.close",    // PaymentController gates taking payment on this
            "rbac.",              // administration of any kind
            "finance.",
            "branch.manage");

    /** What a waiter must actually be able to do. Absence here is a permissionless login. */
    private static final List<String> REQUIRED = List.of(
            "pos.order.create",
            "pos.order.update",
            "pos.order.view",
            "pos.order.send_to_kds");

    @Test
    void waiterHoldsTheOrderTakingCodes() throws IOException {
        assertThat(waiterGrants())
                .as("WAITER's grants, parsed from every changeset in the auth-service changelog")
                .containsAll(REQUIRED);
    }

    @Test
    void waiterHoldsNoTillVoidRefundOrAdministrationPermission() throws IOException {
        Set<String> violations = new TreeSet<>();
        for (String code : waiterGrants()) {
            for (String forbidden : FORBIDDEN_PREFIXES) {
                if (code.startsWith(forbidden)) {
                    violations.add(code);
                }
            }
        }
        assertThat(violations)
                .as("WAITER has been granted permissions from a family it must never hold. A waiter "
                        + "who can open the till, void an order, take payment or administer the "
                        + "tenant is a CASHIER with a different name, and seeding WAITER stops "
                        + "being a security improvement. If this grant is genuinely intended, the "
                        + "role — not this assertion — is what needs changing.")
                .isEmpty();
    }

    /**
     * Every permission code granted to WAITER anywhere in the changelog.
     *
     * <p>Both grant forms are read for the same reason {@link PermissionCatalogClosureTest} reads
     * both: several changesets write {@code INSERT INTO role_permissions … VALUES ('ROLE','code')}
     * and several use the {@code <insert tableName="role_permissions">} attribute form, and a scan
     * that sees only one of the two silently under-reports — which, for this test, means silently
     * passing while the role is wide open.
     */
    private static Set<String> waiterGrants() throws IOException {
        Pattern attributeGrant = Pattern.compile(
                "<insert\\s+tableName=\"role_permissions\">\\s*"
                        + "<column\\s+name=\"role_code\"\\s+value=\"WAITER\"\\s*/>\\s*"
                        + "<column\\s+name=\"permission_code\"\\s+value=\"([^\"]+)\"",
                Pattern.DOTALL);
        Pattern sqlGrant = Pattern.compile(
                "\\(\\s*'WAITER'\\s*,\\s*'([a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)+)'\\s*\\)");
        Pattern sqlInsert = Pattern.compile("INSERT\\s+INTO\\s+role_permissions[^;]*;",
                Pattern.CASE_INSENSITIVE | Pattern.DOTALL);

        Set<String> granted = new TreeSet<>();
        for (Path changeset : changesets()) {
            // A rollback deliberately undoes its forward path; counting it as a grant reports the
            // very rows the changeset exists to remove.
            String xml = Files.readString(changeset, StandardCharsets.UTF_8)
                    .replaceAll("(?s)<rollback>.*?</rollback>", "");
            Matcher attr = attributeGrant.matcher(xml);
            while (attr.find()) {
                granted.add(attr.group(1));
            }
            Matcher block = sqlInsert.matcher(xml);
            while (block.find()) {
                Matcher sm = sqlGrant.matcher(block.group());
                while (sm.find()) {
                    granted.add(sm.group(1));
                }
            }
        }
        assertThat(granted)
                .as("no WAITER grant found in any changeset — either the role was never seeded or "
                        + "this scan has stopped matching the changelog's grant syntax, and an "
                        + "empty set would make the exclusion assertion pass vacuously")
                .isNotEmpty();
        return granted;
    }

    private static List<Path> changesets() throws IOException {
        Path dir = REPO_ROOT.resolve("services/auth-service/src/main/resources/db/changelog");
        try (Stream<Path> paths = Files.walk(dir)) {
            return new ArrayList<>(paths.filter(p -> p.toString().endsWith(".xml")).toList());
        }
    }
}
