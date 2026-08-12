package io.restaurantos.audit;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The schema invariant for audit_events, and the partition-shaped ways it can be lost.
 *
 * <p>audit-service is the fifth service to get this test and the first whose table is
 * PARTITIONED, which changes what the invariant has to say. The four existing versions sweep
 * {@code relkind = 'r'} for tables that are RLS-enabled but not FORCEd. That sweep is necessary
 * here and nowhere near sufficient, because a partitioned table offers three additional ways to
 * be unprotected while looking protected — all three measured against this project's PostgreSQL
 * 18.4 rather than taken from documentation:
 *
 * <ol>
 *   <li><b>The parent is not the table.</b> A policy on the partitioned parent does not appear on
 *       the partitions at all — parent {@code relrowsecurity}/{@code relforcerowsecurity} true,
 *       partition false/false, zero rows in {@code pg_policies} for the partition. It is applied
 *       only to queries that name the parent. A query naming a partition DIRECTLY gets no policy
 *       whatsoever: with the parent fully protected, a NOSUPERUSER owner reading the partition
 *       directly saw both tenants' rows.</li>
 *   <li><b>{@code relkind} is {@code 'p'}, not {@code 'r'}.</b> A sweep written for ordinary
 *       tables does not look at the partitioned parent at all, so the parent could lose its FORCE
 *       and the sweep would stay green.</li>
 *   <li><b>Next month's partition does not exist yet.</b> A partition created after the parent is
 *       enabled and forced inherits nothing. The control has to be re-applied at creation time or
 *       it lapses on the first of some month, silently, in production.</li>
 * </ol>
 *
 * <p>Point 3 is guarded by {@link #futurePartitionsAreBornProtected()}, which does not inspect
 * {@code create_audit_partition}'s source — it calls it and reads the catalog afterwards.
 *
 * <p>Every assertion here runs over a connection that RLS actually applies to. See
 * {@link BaseAuditRlsIT} for why that sentence is the whole point.
 */
class RlsForcedInvariantIT extends BaseAuditRlsIT {

    /** The parent plus every partition attached to it. */
    private static final String AUDIT_TABLES = """
            SELECT c.relname
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND (c.relname = 'audit_events'
                   OR c.oid IN (SELECT i.inhrelid FROM pg_inherits i
                                JOIN pg_class p ON p.oid = i.inhparent
                                WHERE p.relname = 'audit_events'))
            """;

    @Test
    @DisplayName("every RLS-enabled relation in audit_db is also FORCE ROW LEVEL SECURITY")
    void everyRlsEnabledRelationIsForced() throws SQLException {
        List<String> unforced = queryNames("""
                SELECT c.relname
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public'
                  AND c.relkind IN ('r', 'p')
                  AND c.relrowsecurity
                  AND NOT c.relforcerowsecurity
                ORDER BY c.relname
                """);

        assertThat(unforced)
                .as("""
                    RLS is ENABLED but not FORCED on these relations. audit-service's Liquibase \
                    user OWNS them, and PostgreSQL exempts a table's owner from its own policies \
                    unless FORCE is set — so their tenant_isolation policies do nothing. Note the \
                    relkind filter includes 'p': the partitioned parent is not an ordinary table \
                    and a sweep for 'r' alone would not see it. Add the relation to changeset \
                    030-audit-events-rls.xml.""")
                .isEmpty();
    }

    @Test
    @DisplayName("audit_events and EVERY partition carry ENABLE, FORCE and the tenant policy")
    void everyAuditRelationCarriesTheTenantPolicy() throws SQLException {
        List<String> unprotected = queryNames(AUDIT_TABLES + """
                  AND NOT (c.relrowsecurity AND c.relforcerowsecurity
                           AND EXISTS (SELECT 1 FROM pg_policies pol
                                       WHERE pol.schemaname = 'public'
                                         AND pol.tablename = c.relname
                                         AND pol.policyname = 'tenant_isolation'))
                ORDER BY 1
                """);

        assertThat(unprotected)
                .as("""
                    These audit relations lack ENABLE, FORCE or the tenant_isolation policy. A \
                    policy on the partitioned PARENT does not cover a query that names a \
                    PARTITION directly — measured: with the parent enabled, forced and policied, \
                    a NOSUPERUSER owner running SELECT against the partition read every tenant's \
                    rows. Each partition needs the control in its own right.""")
                .isEmpty();
    }

    @Test
    @DisplayName("the invariant is not vacuous: audit_events really is partitioned, with partitions")
    void theInvariantHasSomethingToCheck() throws SQLException {
        // A guard on the guard. Both assertions above are "this list is empty", which is also what
        // they would report if audit_events had no partitions, or had been renamed, or the schema
        // had failed to migrate. This repo has shipped a positive control that passed by silently
        // skipping; an empty-list assertion over an empty universe is the same failure wearing a
        // different hat.
        List<String> relations = queryNames(AUDIT_TABLES + " ORDER BY 1");

        assertThat(relations)
                .as("audit_events must exist and be the partitioned parent the invariant assumes")
                .contains("audit_events");
        assertThat(relations)
                .as("""
                    audit_events had no partitions. The invariant assertions above would pass \
                    trivially. Either the schema did not migrate or the partitioning changeset \
                    (012/010b) has regressed.""")
                .hasSizeGreaterThan(1);

        try (Connection c = asAppUser();
             Statement s = c.createStatement();
             ResultSet rs = s.executeQuery(
                     "SELECT relkind FROM pg_class WHERE relname = 'audit_events'")) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getString(1))
                    .as("audit_events must be a PARTITIONED table ('p'); this whole class is about "
                            + "the ways partitioning defeats a naive RLS control")
                    .isEqualTo("p");
        }
    }

    @Test
    @DisplayName("a partition created next month is born with ENABLE, FORCE and the policy")
    void futurePartitionsAreBornProtected() throws SQLException {
        // The single most important guard in this class. AuditArchivalService calls
        // create_audit_partition() on the 1st of every month, and a partition created after the
        // parent was protected inherits NOTHING — measured: relrowsecurity=f, relforcerowsecurity=f,
        // zero policies. Without this the gap returns on a date nobody is watching.
        //
        // Called as audit_writer, which is what AuditArchivalService actually connects as, and
        // which has neither CREATE on the schema nor ownership of the parent. That is the point:
        // the function is SECURITY DEFINER so it succeeds anyway. Calling it as the owner would
        // pass while production failed.
        LocalDate month = LocalDate.now().plusYears(3).withDayOfMonth(1);
        String partition = "audit_events_" + month.toString().substring(0, 7).replace('-', '_');

        try (Connection c = asWriter(); Statement s = c.createStatement()) {
            s.execute("SELECT create_audit_partition(DATE '" + month + "')");
        }

        try (Connection c = asAppUser();
             Statement s = c.createStatement();
             ResultSet rs = s.executeQuery("""
                     SELECT c.relrowsecurity,
                            c.relforcerowsecurity,
                            EXISTS (SELECT 1 FROM pg_policies pol
                                    WHERE pol.schemaname = 'public'
                                      AND pol.tablename = c.relname
                                      AND pol.policyname = 'tenant_isolation')
                     FROM pg_class c
                     JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE n.nspname = 'public' AND c.relname = '""" + partition + "'")) {

            assertThat(rs.next())
                    .as("""
                        create_audit_partition() did not create %s at all. AuditArchivalService \
                        calls it as audit_writer, which has no CREATE on schema public — the \
                        function must be SECURITY DEFINER. Without this the audit log stops \
                        accepting rows once the last pre-created partition is passed.""", partition)
                    .isTrue();
            assertThat(rs.getBoolean(1))
                    .as("%s was created without ROW LEVEL SECURITY enabled", partition).isTrue();
            assertThat(rs.getBoolean(2))
                    .as("%s was created without FORCE ROW LEVEL SECURITY", partition).isTrue();
            assertThat(rs.getBoolean(3))
                    .as("%s was created without the tenant_isolation policy", partition).isTrue();
        }
    }

    private static List<String> queryNames(String sql) throws SQLException {
        List<String> out = new ArrayList<>();
        try (Connection c = asAppUser();
             Statement s = c.createStatement();
             ResultSet rs = s.executeQuery(sql)) {
            while (rs.next()) {
                out.add(rs.getString(1));
            }
        }
        return out;
    }
}
