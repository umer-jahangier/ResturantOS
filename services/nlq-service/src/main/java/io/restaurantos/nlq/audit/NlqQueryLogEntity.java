package io.restaurantos.nlq.audit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

/**
 * One row per NLQ request — success, validator rejection, quota rejection, Claude failure, or
 * timeout. An audit log that only records successes is not an audit log (plan 12-07).
 *
 * <p>Maps {@code nlq_query_log}, created by 12-04's {@code V1__nlq_schema.sql} — RLS ENABLED and
 * FORCED, so every write and read is tenant-scoped by the {@code app.current_tenant_id} GUC that
 * shared-lib's {@code TenantAwareDataSourcePostProcessor} sets from {@code TenantContext} at
 * connection checkout. {@code impersonated_by} is NLQ-02's impersonation stamp — sourced from the
 * validated JWT ({@code JwtClaims.impersonatedBy()}) only, never a client header.
 */
@Entity
@Table(name = "nlq_query_log")
public class NlqQueryLogEntity {

    @Id
    @GeneratedValue
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "branch_id")
    private UUID branchId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "impersonated_by")
    private UUID impersonatedBy;

    @Column(name = "role_code")
    private String roleCode;

    @Column(name = "question", nullable = false)
    private String question;

    @Column(name = "generated_sql")
    private String generatedSql;

    @Column(name = "executed_sql")
    private String executedSql;

    @Column(name = "rejection_code")
    private String rejectionCode;

    @Column(name = "row_count")
    private Integer rowCount;

    @Column(name = "duration_ms")
    private Integer durationMs;

    @Column(name = "cache_hit", nullable = false)
    private boolean cacheHit;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected NlqQueryLogEntity() {
        // JPA
    }

    private NlqQueryLogEntity(Builder b) {
        this.tenantId = b.tenantId;
        this.branchId = b.branchId;
        this.userId = b.userId;
        this.impersonatedBy = b.impersonatedBy;
        this.roleCode = b.roleCode;
        this.question = b.question;
        this.generatedSql = b.generatedSql;
        this.executedSql = b.executedSql;
        this.rejectionCode = b.rejectionCode;
        this.rowCount = b.rowCount;
        this.durationMs = b.durationMs;
        this.cacheHit = b.cacheHit;
        this.createdAt = Instant.now();
    }

    public static Builder builder() {
        return new Builder();
    }

    public UUID getId() {
        return id;
    }

    public UUID getTenantId() {
        return tenantId;
    }

    public UUID getBranchId() {
        return branchId;
    }

    public UUID getUserId() {
        return userId;
    }

    public UUID getImpersonatedBy() {
        return impersonatedBy;
    }

    public String getRoleCode() {
        return roleCode;
    }

    public String getQuestion() {
        return question;
    }

    public String getGeneratedSql() {
        return generatedSql;
    }

    public String getExecutedSql() {
        return executedSql;
    }

    public String getRejectionCode() {
        return rejectionCode;
    }

    public Integer getRowCount() {
        return rowCount;
    }

    public Integer getDurationMs() {
        return durationMs;
    }

    public boolean isCacheHit() {
        return cacheHit;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public static final class Builder {
        private UUID tenantId;
        private UUID branchId;
        private UUID userId;
        private UUID impersonatedBy;
        private String roleCode;
        private String question;
        private String generatedSql;
        private String executedSql;
        private String rejectionCode;
        private Integer rowCount;
        private Integer durationMs;
        private boolean cacheHit;

        public Builder tenantId(UUID v) {
            this.tenantId = v;
            return this;
        }

        public Builder branchId(UUID v) {
            this.branchId = v;
            return this;
        }

        public Builder userId(UUID v) {
            this.userId = v;
            return this;
        }

        public Builder impersonatedBy(UUID v) {
            this.impersonatedBy = v;
            return this;
        }

        public Builder roleCode(String v) {
            this.roleCode = v;
            return this;
        }

        public Builder question(String v) {
            this.question = v;
            return this;
        }

        public Builder generatedSql(String v) {
            this.generatedSql = v;
            return this;
        }

        public Builder executedSql(String v) {
            this.executedSql = v;
            return this;
        }

        public Builder rejectionCode(String v) {
            this.rejectionCode = v;
            return this;
        }

        public Builder rowCount(Integer v) {
            this.rowCount = v;
            return this;
        }

        public Builder durationMs(Integer v) {
            this.durationMs = v;
            return this;
        }

        public Builder cacheHit(boolean v) {
            this.cacheHit = v;
            return this;
        }

        public NlqQueryLogEntity build() {
            return new NlqQueryLogEntity(this);
        }
    }
}
