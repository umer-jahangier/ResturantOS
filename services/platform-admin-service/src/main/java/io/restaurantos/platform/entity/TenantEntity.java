package io.restaurantos.platform.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * Tenant registration in the SuperAdmin control plane.
 * platform_db is NOT tenant-scoped — no RLS, does not extend TenantAuditableEntity (SC4/PLATFORM-07).
 * tenant_id here is a plain FK to tenants(id) in usage_records/impersonation_log, not a row-security boundary.
 */
@Entity
@Table(name = "tenants")
@Getter
@Setter
public class TenantEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, unique = true, length = 100)
    private String slug;

    @Column(name = "brand_name")
    private String brandName;

    @Column(nullable = false, length = 30)
    @Enumerated(EnumType.STRING)
    private TenantStatus status;

    @Column(nullable = false, length = 30)
    @Enumerated(EnumType.STRING)
    private TierType tier;

    @Column(name = "theme_config", columnDefinition = "jsonb")
    private String themeConfig;

    @Column(name = "email_config", columnDefinition = "jsonb")
    private String emailConfig;

    @Column(name = "billing_ref")
    private String billingRef;

    @Column(name = "trial_ends_at")
    private Instant trialEndsAt;

    @Column(name = "custom_domain")
    private String customDomain;

    @Column(name = "domain_verified")
    private boolean domainVerified = false;

    @Column(name = "max_branches")
    private Integer maxBranches;

    @Column(name = "max_users")
    private Integer maxUsers;

    @Column(name = "storage_gb")
    private Integer storageGb;

    @Column(name = "nlq_quota")
    private Integer nlqQuota;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "suspended_at")
    private Instant suspendedAt;

    @Column(name = "cancelled_at")
    private Instant cancelledAt;

    public enum TenantStatus {
        PENDING_SETUP, ACTIVE, SUSPENDED, CANCELLED, PURGED, PROVISIONING_FAILED
    }

    public enum TierType {
        STARTER, GROWTH, ENTERPRISE, CUSTOM
    }
}
