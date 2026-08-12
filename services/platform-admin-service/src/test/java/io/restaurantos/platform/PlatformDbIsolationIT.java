package io.restaurantos.platform;

import io.restaurantos.platform.entity.TenantEntity;
import io.restaurantos.platform.entity.TenantFeatureEntity;
import io.restaurantos.platform.entity.PlatformUserEntity;
import io.restaurantos.platform.entity.UsageRecordEntity;
import io.restaurantos.platform.entity.ImpersonationLogEntity;
import io.restaurantos.shared.entity.TenantAuditableEntity;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.ConnectionCallback;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * <h2>THIS CLASS ASSERTS A DELIBERATE ABSENCE. DO NOT "FIX" IT BY ENABLING RLS.</h2>
 *
 * <p>Every other tenant-scoped database in this product FORCEs row-level security on its
 * {@code tenant_id} columns, and three tables in {@code platform_db} carry a {@code tenant_id}
 * while having no policy at all. That looks like the {@code audit_events} gap that
 * {@code 030-audit-events-rls.xml} closed. <b>It is not.</b> The tests below are a NEGATIVE
 * CONTROL: they exist so that adding a policy to {@code platform_db} turns this suite RED, on
 * purpose, and the failure message explains why.
 *
 * <p><b>The one-paragraph reason.</b> A {@code tenant_isolation} policy answers "which tenant is
 * this connection acting for?" by reading {@code app.current_tenant_id}. The SuperAdmin console
 * has no answer: {@code JwtSigningService.signPlatformToken} mints a token with NO {@code tenant_id}
 * claim (that absence is what distinguishes a platform principal from a tenant one), so
 * {@code TenantAwareDataSource} writes the GUC as EMPTY on every checkout, and the fleet-standard
 * {@code NULLIF(...)} predicate fails CLOSED. The policy would not scope the console to one
 * tenant — it would scope it to zero. {@link #enablingTheFleetPolicy_wouldBlindTheConsole_thisIsWhyThereIsNone()}
 * demonstrates that against a real table rather than asserting it in prose.
 *
 * <p>Isolation for {@code platform_db} is <b>by database and by role</b>: measured live, no tenant
 * service role holds a single grant in {@code platform_db} ({@code SET ROLE pos_user; SELECT ... FROM
 * tenants} → {@code permission denied}), the platform roles hold zero grants across all 14 tenant
 * databases, and the database has no {@code postgres_fdw}/{@code dblink} bridge. Cross-tenant read
 * inside the console is the console's job, not a leak. Full reasoning and every measurement live in
 * {@code db/changelog/v1.0.0/040-platform-db-rls-posture.xml}, next to the tables.
 *
 * <p><b>What is NOT absent by design</b> is {@code impersonation_log}'s immutability. That table is
 * the accountability record of platform staff assuming tenant users' identities, and until 040 the
 * console's own role could UPDATE, DELETE and TRUNCATE it — the subject of the record could choose
 * its contents. The append-only guards are asserted from {@link #impersonationLog_refusesDelete()}
 * onward; those tests are ordinary positive controls and a failure there is a real defect.
 *
 * <p><b>Why the guards below are triggers and not grants.</b> {@code 040-002} also revokes
 * UPDATE/DELETE/TRUNCATE from {@code platform_user}, and that revoke is <b>INERT on every
 * deployment shape</b> — measured live after applying it: {@code role_table_grants} shows the
 * privilege gone while {@code has_table_privilege('platform_user','impersonation_log','DELETE')}
 * still returns TRUE, because {@code deploy/init/02b-ensure-runtime-roles.sql} grants
 * {@code platform_admin} TO {@code platform_user} and the membership inherits ownership. On a clean
 * machine {@code platform_user} owns the tables outright, which is inert for the same reason. A
 * catalogue view that reports a control working while the privilege is unchanged is this
 * codebase's signature defect, so it is called out rather than relied on. The triggers are the
 * enforcing layer: they fire for the owner, for an inheriting member and for Liquibase alike, and
 * {@link #impersonationLog_triggerStopsTheRuntimeRoleToo_notJustTheOwner()} drives one through a
 * created NOSUPERUSER role — asserting {@code current_user} first — so the claim is measured rather
 * than assumed.
 */
class PlatformDbIsolationIT extends BasePlatformIT {

    /** The tables a future reader is most likely to "fix". Their RLS-free state is the assertion. */
    private static final List<String> PLATFORM_TABLES = List.of(
        "tenants", "tenant_features", "platform_users", "usage_records", "impersonation_log"
    );

    private static final String WHY =
        " — platform_db has NO row-level security BY DESIGN. The SuperAdmin console's token carries "
        + "no tenant_id, so app.current_tenant_id is always empty and this policy would match ZERO "
        + "rows, blanking the console rather than scoping it. Isolation here is by database and "
        + "role. Read db/changelog/v1.0.0/040-platform-db-rls-posture.xml before changing this.";

    // ── NEGATIVE CONTROL: the deliberate absence ────────────────────────────────────────────────

    @Test
    void platformDb_deliberatelyHasZeroRlsPolicies_onAllBusinessTables() {
        for (String table : PLATFORM_TABLES) {
            int policyCount = jdbc.queryForObject(
                "SELECT COUNT(*) FROM pg_policies WHERE tablename = ?",
                Integer.class, table);
            assertThat(policyCount)
                .as("Table '%s' must have zero RLS policies%s", table, WHY)
                .isEqualTo(0);
        }
    }

    @Test
    void platformDb_rowLevelSecurityDeliberatelyDisabled_onAllBusinessTables() {
        for (String table : PLATFORM_TABLES) {
            boolean rlsEnabled = jdbc.queryForObject(
                "SELECT relrowsecurity FROM pg_class WHERE relname = ?",
                Boolean.class, table);
            assertThat(rlsEnabled)
                .as("Table '%s' must not have row-level security enabled%s", table, WHY)
                .isFalse();
        }
    }

    /**
     * The demonstration that makes the absence a decision instead of an assertion.
     *
     * <p>Builds a copy of {@code tenant_features} in the shape production has it — owned by one
     * role, read by a <b>different</b> {@code NOSUPERUSER NOBYPASSRLS} role — applies the
     * fleet-standard policy verbatim, and measures what the console would then see. The console's
     * connection is reproduced exactly: {@code app.current_tenant_id} set to the EMPTY STRING,
     * which is what {@code TenantAwareDataSource} writes when {@code TenantContext} holds no tenant.
     *
     * <p>Two rows before, zero rows after, and the write is refused outright. That is the whole
     * argument, executed. It also documents the mechanism for anyone who later has a genuine
     * requirement to partition {@code platform_db}: the answer is not this GUC.
     */
    @Test
    void enablingTheFleetPolicy_wouldBlindTheConsole_thisIsWhyThereIsNone() {
        jdbc.execute("DROP TABLE IF EXISTS rls_consequence_probe");
        jdbc.execute("""
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='console_probe_role') THEN
                CREATE ROLE console_probe_role NOSUPERUSER NOBYPASSRLS;
              END IF;
            END $$""");
        jdbc.execute("""
            CREATE TABLE rls_consequence_probe (
              tenant_id UUID NOT NULL, feature_code VARCHAR(100) NOT NULL, is_enabled BOOLEAN NOT NULL,
              PRIMARY KEY (tenant_id, feature_code))""");
        jdbc.execute("""
            INSERT INTO rls_consequence_probe VALUES
              ('11111111-1111-1111-1111-111111111111','FEATURE_CRM',true),
              ('22222222-2222-2222-2222-222222222222','FEATURE_CRM',false)""");
        jdbc.execute("GRANT SELECT, INSERT ON rls_consequence_probe TO console_probe_role");

        try {
            assertThat(consoleVisibleRows())
                .as("baseline: with no policy the console sees every tenant, which is its job")
                .isEqualTo(2);

            // The fleet-standard policy, character for character as every other service writes it.
            jdbc.execute("ALTER TABLE rls_consequence_probe ENABLE ROW LEVEL SECURITY");
            jdbc.execute("ALTER TABLE rls_consequence_probe FORCE ROW LEVEL SECURITY");
            jdbc.execute("""
                CREATE POLICY tenant_isolation ON rls_consequence_probe
                  USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)""");

            assertThat(consoleVisibleRows())
                .as("THE POINT: the tenantless console now reads NOTHING. Applied to the real "
                    + "tenant_features this is GET /tenants/{id}/features returning an empty map "
                    + "for every tenant — a blank console that reads as 'no features are enabled'.")
                .isZero();

            assertThatThrownBy(() -> asRole("console_probe_role", st -> st.executeUpdate("""
                    INSERT INTO rls_consequence_probe
                      VALUES ('33333333-3333-3333-3333-333333333333','FEATURE_X',true)""")))
                .as("and every console write — PATCH /tenants/{id}/features/{code} — is refused")
                .isInstanceOf(DataAccessException.class)
                .hasStackTraceContaining("row-level security policy");
        } finally {
            jdbc.execute("DROP TABLE IF EXISTS rls_consequence_probe");
        }
    }

    /** Rows the console's connection can see: a non-owner NOSUPERUSER role with an EMPTY tenant GUC. */
    private int consoleVisibleRows() {
        return asRole("console_probe_role", st -> {
            try (ResultSet rs = st.executeQuery("SELECT count(*) FROM rls_consequence_probe")) {
                rs.next();
                return rs.getInt(1);
            }
        });
    }

    /**
     * Runs {@code work} on a REAL transaction whose {@code current_user} is {@code role} and whose
     * {@code app.current_tenant_id} is EMPTY — the console's connection, reproduced.
     *
     * <p>The explicit transaction is not ceremony. {@code SET LOCAL ROLE} is scoped to a
     * transaction, so issued on an autocommit connection it lands in its own implicit transaction
     * and is discarded before the next statement runs — the query would then execute as the table
     * OWNER while appearing to test an unprivileged role. That is the same class of silently-inert
     * control this suite exists to catch, and the first draft of this file had it: the runtime-role
     * test passed only because the trigger also stops the owner.
     *
     * <p>Rolled back unconditionally, so nothing a probe writes survives the test.
     */
    private <T> T asRole(String role, SqlWork<T> work) {
        return jdbc.execute((ConnectionCallback<T>) con -> {
            boolean autoCommit = con.getAutoCommit();
            con.setAutoCommit(false);
            try (Statement st = con.createStatement()) {
                st.execute("SET LOCAL ROLE " + role);
                st.execute("SELECT set_config('app.current_tenant_id', '', true)");
                return work.run(st);
            } finally {
                con.rollback();
                con.setAutoCommit(autoCommit);
            }
        });
    }

    @FunctionalInterface
    private interface SqlWork<T> {
        T run(Statement statement) throws SQLException;
    }

    @Test
    void platformTables_have_noAppCurrentTenantIdReferences() {
        int count = jdbc.queryForObject(
            "SELECT COUNT(*) FROM pg_policies WHERE qual::text LIKE '%current_tenant_id%' "
            + "AND tablename = ANY(ARRAY['tenants','tenant_features','platform_users','usage_records','impersonation_log'])",
            Integer.class);
        assertThat(count)
            .as("No platform table should reference the app.current_tenant_id GUC%s", WHY)
            .isEqualTo(0);
    }

    /**
     * The posture is recorded in the DATABASE too, not only in this repository. A DBA asking "why
     * does platform_db have no RLS?" types {@code \\d+} in psql long before they find the changelog,
     * and an unexplained absence is what gets "fixed" at 2am.
     */
    @Test
    void theDeliberateAbsence_isDocumentedOnTheTablesThemselves() {
        for (String table : List.of("impersonation_log", "tenant_features", "usage_records")) {
            String comment = jdbc.queryForObject(
                "SELECT obj_description(?::regclass, 'pg_class')", String.class, table);
            assertThat(comment)
                .as("Table '%s' must carry the posture comment 040-001 sets, so the decision is "
                    + "visible to anyone inspecting the database directly", table)
                .isNotNull()
                .contains("NO RLS BY DESIGN");
        }
    }

    // ── The entities are not tenant-scoped, at source level ─────────────────────────────────────

    @Test
    void tenantEntity_doesNotExtend_tenantAuditableEntity() {
        assertThat(TenantAuditableEntity.class.isAssignableFrom(TenantEntity.class))
            .as("TenantEntity must NOT extend TenantAuditableEntity (platform_db is not tenant-scoped)")
            .isFalse();
    }

    @Test
    void tenantFeatureEntity_doesNotExtend_tenantAuditableEntity() {
        assertThat(TenantAuditableEntity.class.isAssignableFrom(TenantFeatureEntity.class))
            .as("TenantFeatureEntity must NOT extend TenantAuditableEntity")
            .isFalse();
    }

    @Test
    void platformUserEntity_doesNotExtend_tenantAuditableEntity() {
        assertThat(TenantAuditableEntity.class.isAssignableFrom(PlatformUserEntity.class))
            .as("PlatformUserEntity must NOT extend TenantAuditableEntity")
            .isFalse();
    }

    @Test
    void usageRecordEntity_doesNotExtend_tenantAuditableEntity() {
        assertThat(TenantAuditableEntity.class.isAssignableFrom(UsageRecordEntity.class))
            .as("UsageRecordEntity must NOT extend TenantAuditableEntity")
            .isFalse();
    }

    @Test
    void impersonationLogEntity_doesNotExtend_tenantAuditableEntity() {
        assertThat(TenantAuditableEntity.class.isAssignableFrom(ImpersonationLogEntity.class))
            .as("ImpersonationLogEntity must NOT extend TenantAuditableEntity")
            .isFalse();
    }

    @Test
    void sharedInfraTables_present_withNoRls() {
        List<String> infraTables = List.of("event_outbox", "idempotency_keys", "processed_events");
        for (String table : infraTables) {
            int count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM pg_class WHERE relname = ?", Integer.class, table);
            assertThat(count)
                .as("Shared infra table '%s' must exist in platform_db", table)
                .isEqualTo(1);

            boolean rlsEnabled = jdbc.queryForObject(
                "SELECT relrowsecurity FROM pg_class WHERE relname = ?", Boolean.class, table);
            assertThat(rlsEnabled)
                .as("Shared infra table '%s' must not have RLS — unforced in all 15 databases, a "
                    + "fleet-wide convention", table)
                .isFalse();
        }
    }

    // ── POSITIVE CONTROLS: impersonation_log is append-only (040). A failure here IS a defect. ──

    /**
     * Measured before 040, as {@code platform_user}, the role the console's datasource connects as:
     * {@code DELETE FROM impersonation_log} returned {@code DELETE 1}. The operator could erase the
     * record of what they did.
     */
    @Test
    void impersonationLog_refusesDelete() {
        UUID id = insertImpersonationRow();
        assertThatThrownBy(() -> jdbc.update("DELETE FROM impersonation_log WHERE id = ?", id))
            .isInstanceOf(DataAccessException.class)
            .hasStackTraceContaining("IMPERSONATION_LOG_IMMUTABLE");

        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM impersonation_log WHERE id = ?", Integer.class, id))
            .as("the record must still be there after the refused delete")
            .isEqualTo(1);
    }

    /**
     * The rewrite case, which matters more than the delete: an erased row is conspicuous, an edited
     * one is not. Before 040 this UPDATE succeeded and could change both the reason and WHO was
     * impersonated.
     */
    @Test
    void impersonationLog_refusesRewriteOfWhoWhenAndWhy() {
        UUID id = insertImpersonationRow();

        assertThatThrownBy(() -> jdbc.update(
                "UPDATE impersonation_log SET reason = 'routine support' WHERE id = ?", id))
            .as("the subject of an accountability record must not choose its contents")
            .isInstanceOf(DataAccessException.class)
            .hasStackTraceContaining("IMPERSONATION_LOG_IMMUTABLE");

        assertThatThrownBy(() -> jdbc.update(
                "UPDATE impersonation_log SET target_user_id = gen_random_uuid() WHERE id = ?", id))
            .isInstanceOf(DataAccessException.class)
            .hasStackTraceContaining("IMPERSONATION_LOG_IMMUTABLE");

        assertThatThrownBy(() -> jdbc.update(
                "UPDATE impersonation_log SET platform_user_id = gen_random_uuid() WHERE id = ?", id))
            .isInstanceOf(DataAccessException.class)
            .hasStackTraceContaining("IMPERSONATION_LOG_IMMUTABLE");

        assertThat(jdbc.queryForObject(
                "SELECT reason FROM impersonation_log WHERE id = ?", String.class, id))
            .isEqualTo("PROBE: looked at a tenant's payroll");
    }

    /**
     * TRUNCATE bypasses row-level triggers entirely, so the row trigger above does not see it. This
     * is the case a reviewer is most likely to miss: without the statement-level trigger the table
     * would be immutable row by row and erasable in a single statement. Measured before 040:
     * {@code TRUNCATE impersonation_log} → {@code TRUNCATE TABLE}.
     */
    @Test
    void impersonationLog_refusesTruncate_whichTheRowTriggerCannotSee() {
        insertImpersonationRow();
        assertThatThrownBy(() -> jdbc.execute("TRUNCATE impersonation_log"))
            .isInstanceOf(DataAccessException.class)
            .hasStackTraceContaining("IMPERSONATION_LOG_IMMUTABLE");
    }

    /**
     * The one permitted transition. {@code ended_at} exists for a "close the impersonation session"
     * endpoint that has never been built; a guard whose first encounter with a real feature is to be
     * deleted protects nothing, so the carve-out is here from the start — and it is narrow: any
     * other column moving in the same statement is still refused.
     */
    @Test
    void impersonationLog_permitsClosingAnOpenSession_andNothingElseInTheSameStatement() {
        UUID id = insertImpersonationRow();

        assertThatCode(() -> jdbc.update(
                "UPDATE impersonation_log SET ended_at = NOW() WHERE id = ?", id))
            .as("closing an open session must remain possible without deleting this control")
            .doesNotThrowAnyException();

        assertThat(jdbc.queryForObject(
                "SELECT ended_at IS NOT NULL FROM impersonation_log WHERE id = ?", Boolean.class, id))
            .isTrue();

        assertThatThrownBy(() -> jdbc.update(
                "UPDATE impersonation_log SET ended_at = NOW(), reason = 'edited' WHERE id = ?", id))
            .as("the carve-out must not become a door for rewriting the rest of the row")
            .isInstanceOf(DataAccessException.class)
            .hasStackTraceContaining("IMPERSONATION_LOG_IMMUTABLE");
    }

    /**
     * The trigger is the layer that fires for EVERY role — owner, migration tool and runtime alike.
     * The tests above run as the table owner; this one drives the same guard through a created
     * {@code NOSUPERUSER NOBYPASSRLS} role, which is the shape {@code platform_user} has in
     * production. A control that only stops the role already stopped by GRANT is decoration.
     */
    @Test
    void impersonationLog_triggerStopsTheRuntimeRoleToo_notJustTheOwner() {
        UUID id = insertImpersonationRow();
        jdbc.execute("""
            DO $$ BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='runtime_probe_role') THEN
                CREATE ROLE runtime_probe_role NOSUPERUSER NOBYPASSRLS;
              END IF;
            END $$""");
        jdbc.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON impersonation_log TO runtime_probe_role");
        try {
            String effectiveUser = asRole("runtime_probe_role", st -> {
                try (ResultSet rs = st.executeQuery("SELECT current_user")) {
                    rs.next();
                    return rs.getString(1);
                }
            });
            assertThat(effectiveUser)
                .as("the probe must genuinely be running as the unprivileged role, not the owner")
                .isEqualTo("runtime_probe_role");

            assertThatThrownBy(() -> asRole("runtime_probe_role", st ->
                    st.executeUpdate("DELETE FROM impersonation_log WHERE id = '" + id + "'")))
                .as("a role holding an explicit DELETE grant is still refused by the trigger")
                .isInstanceOf(DataAccessException.class)
                .hasStackTraceContaining("IMPERSONATION_LOG_IMMUTABLE");

            assertThatThrownBy(() -> asRole("runtime_probe_role", st ->
                    st.executeUpdate("UPDATE impersonation_log SET reason='edited' WHERE id = '" + id + "'")))
                .as("...and so is a rewrite by that role")
                .isInstanceOf(DataAccessException.class)
                .hasStackTraceContaining("IMPERSONATION_LOG_IMMUTABLE");
        } finally {
            jdbc.execute("REVOKE ALL ON impersonation_log FROM runtime_probe_role");
        }
    }

    private UUID insertImpersonationRow() {
        UUID id = UUID.randomUUID();
        jdbc.update("""
            INSERT INTO impersonation_log
              (id, platform_user_id, tenant_id, target_user_id, started_at, reason)
            VALUES (?, ?, ?, ?, ?, ?)""",
            id, UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
            java.sql.Timestamp.from(Instant.now()), "PROBE: looked at a tenant's payroll");
        return id;
    }
}
