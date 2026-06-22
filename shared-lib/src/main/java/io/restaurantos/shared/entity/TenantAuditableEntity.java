package io.restaurantos.shared.entity;

import jakarta.persistence.Column;
import jakarta.persistence.EntityListeners;
import jakarta.persistence.MappedSuperclass;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;
import org.hibernate.annotations.FilterDef;
import org.hibernate.annotations.ParamDef;
import org.springframework.data.annotation.CreatedBy;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedBy;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

import java.io.Serializable;
import java.time.Instant;
import java.util.UUID;

/**
 * Base class for every tenant-scoped JPA entity in every service except platform_db.
 * Provides: tenant_id (isolation), created/updated audit fields, and soft-delete (deleted_at).
 *
 * The Hibernate filter "tenantFilter" is enabled per request/consumer by
 * TenantFilterInterceptor (HTTP) or TenantAwareMessageProcessor (RabbitMQ) / TenantTaskDecorator (@Async).
 */
@Getter
@Setter
@MappedSuperclass
@EntityListeners(AuditingEntityListener.class)
@FilterDef(name = "tenantFilter", parameters = @ParamDef(name = "tenantId", type = UUID.class))
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
public abstract class TenantAuditableEntity implements Serializable {

    /** Owning tenant. Never updatable. Populated from TenantContext on persist (see services). */
    @Column(name = "tenant_id", nullable = false, updatable = false)
    private UUID tenantId;

    /** Set by Spring Data Auditing on insert. */
    @CreatedDate
    @Column(name = "created_at", updatable = false, nullable = false)
    private Instant createdAt;

    /** Updated by Spring Data Auditing on every flush. */
    @LastModifiedDate
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** User id from AuditorAware (JWT sub). */
    @CreatedBy
    @Column(name = "created_by", updatable = false)
    private UUID createdBy;

    @LastModifiedBy
    @Column(name = "updated_by")
    private UUID updatedBy;

    /** Soft-delete marker. NULL = live row. */
    @Column(name = "deleted_at")
    private Instant deletedAt;

    public boolean isDeleted() {
        return deletedAt != null;
    }
}
