package io.restaurantos.platform;

import io.restaurantos.platform.entity.TenantEntity;
import io.restaurantos.platform.entity.TenantFeatureEntity;
import io.restaurantos.platform.entity.PlatformUserEntity;
import io.restaurantos.platform.entity.UsageRecordEntity;
import io.restaurantos.platform.entity.ImpersonationLogEntity;
import io.restaurantos.shared.entity.TenantAuditableEntity;
import org.junit.jupiter.api.Test;

import java.sql.ResultSet;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Verifies SC4 / PLATFORM-07 isolation guarantees:
 * 1. platform_db has ZERO RLS policies on any of the five business tables
 * 2. No platform entity extends TenantAuditableEntity (source-level check)
 * 3. pg_class.relrowsecurity = false for all five tables
 *
 * These tests run against the real Testcontainers Postgres instance
 * with Liquibase applied (010-create-platform-tables.xml).
 */
class PlatformDbIsolationIT extends BasePlatformIT {

    private static final List<String> PLATFORM_TABLES = List.of(
        "tenants", "tenant_features", "platform_users", "usage_records", "impersonation_log"
    );

    // --- SC4: No RLS policies on any platform table ---

    @Test
    void platformDb_hasZeroRlsPolicies_onAllBusinessTables() {
        for (String table : PLATFORM_TABLES) {
            int policyCount = jdbc.queryForObject(
                "SELECT COUNT(*) FROM pg_policies WHERE tablename = ?",
                Integer.class, table);
            assertThat(policyCount)
                .as("Table '%s' must have zero RLS policies", table)
                .isEqualTo(0);
        }
    }

    @Test
    void platformDb_rowLevelSecurityDisabled_onAllBusinessTables() {
        for (String table : PLATFORM_TABLES) {
            boolean rlsEnabled = jdbc.queryForObject(
                "SELECT relrowsecurity FROM pg_class WHERE relname = ?",
                Boolean.class, table);
            assertThat(rlsEnabled)
                .as("Table '%s' must not have row-level security enabled", table)
                .isFalse();
        }
    }

    // --- SC4: No platform entity extends TenantAuditableEntity ---

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

    // --- Shared infra tables present (020-shared-infra-tables.xml) ---

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
                .as("Shared infra table '%s' must not have RLS", table)
                .isFalse();
        }
    }

    // --- No app.current_tenant_id GUC in any platform changeset ---

    @Test
    void platformTables_have_noAppCurrentTenantIdReferences() {
        // Count rows in pg_policies that reference app.current_tenant_id — should be 0
        int count = jdbc.queryForObject(
            "SELECT COUNT(*) FROM pg_policies WHERE qual::text LIKE '%current_tenant_id%' "
            + "AND tablename = ANY(ARRAY['tenants','tenant_features','platform_users','usage_records','impersonation_log'])",
            Integer.class);
        assertThat(count).as("No platform table should reference app.current_tenant_id GUC").isEqualTo(0);
    }
}
