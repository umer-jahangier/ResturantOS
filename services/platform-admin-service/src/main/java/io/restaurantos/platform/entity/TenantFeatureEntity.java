package io.restaurantos.platform.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.io.Serializable;
import java.util.UUID;

/**
 * Per-tenant feature flag record. Part of the NON-RLS platform_db (SC4/PLATFORM-07).
 * SuperAdmin toggles here are authoritative over tier defaults (PLATFORM-04/SC6).
 */
@Entity
@Table(name = "tenant_features")
@IdClass(TenantFeatureEntity.TenantFeatureKey.class)
@Getter
@Setter
public class TenantFeatureEntity {

    @Id
    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Id
    @Column(name = "feature_code", nullable = false, length = 100)
    private String featureCode;

    @Column(name = "is_enabled", nullable = false)
    private boolean enabled;

    /**
     * TRUE when a SuperAdmin set this row deliberately; FALSE when it was seeded from the tier
     * matrix (13-14, changeset 030-001).
     *
     * <p>This is the whole of PLATFORM-10's "a SuperAdmin override is authoritative over tier
     * defaults" as data. A tier change reconciles rows against the new tier's defaults, and it MUST
     * skip the rows marked here — otherwise reconciliation revokes a feature an administrator
     * granted on purpose. Without the marker there is nothing to distinguish the two, and the only
     * two available implementations (reconcile everything / reconcile nothing) are both wrong.
     *
     * <p>Written by {@code FeatureFlagAdminService.setFeature} (the SuperAdmin path) and read by
     * {@code FeatureFlagAdminService.reconcileToTierDefaults}. Provisioning's seeding loop leaves
     * it at its {@code false} default.
     */
    @Column(name = "is_override", nullable = false)
    private boolean override;

    @Column(name = "config_json", columnDefinition = "jsonb")
    @JdbcTypeCode(SqlTypes.JSON)
    private String configJson;

    @Embeddable
    public static class TenantFeatureKey implements Serializable {
        private UUID tenantId;
        private String featureCode;

        public TenantFeatureKey() {}

        public TenantFeatureKey(UUID tenantId, String featureCode) {
            this.tenantId = tenantId;
            this.featureCode = featureCode;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof TenantFeatureKey k)) return false;
            return tenantId.equals(k.tenantId) && featureCode.equals(k.featureCode);
        }

        @Override
        public int hashCode() {
            return 31 * tenantId.hashCode() + featureCode.hashCode();
        }
    }
}
