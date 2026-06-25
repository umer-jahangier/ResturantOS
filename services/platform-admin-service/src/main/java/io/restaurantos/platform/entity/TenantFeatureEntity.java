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
