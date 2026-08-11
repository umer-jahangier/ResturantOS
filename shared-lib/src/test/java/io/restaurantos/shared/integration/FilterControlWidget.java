package io.restaurantos.shared.integration;

import io.restaurantos.shared.entity.TenantAuditableEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;
import org.hibernate.annotations.Filter;

import java.util.UUID;

/**
 * The positive control for {@link TenantFilterPropagationIT}.
 *
 * <p>Identical to {@link Widget} in every respect that could matter — same table, same base
 * class, same filter name, same condition — with exactly one difference: the {@code @Filter}
 * annotation is declared <b>here, on the entity</b>, rather than inherited from the
 * {@code @MappedSuperclass}. If a query through this entity carries a tenant predicate and the
 * same query through {@link Widget} does not, the location of the annotation is the whole
 * cause, and no other explanation (Hibernate version, dialect, filter name, parameter type,
 * how the filter is enabled) survives.
 *
 * <p>Test-only. Read-only. Never inserted through — {@link Widget} owns the writes.
 */
@Entity
@Table(name = "widgets")
@Filter(name = "tenantFilter", condition = "tenant_id = :tenantId")
@Getter
@Setter
public class FilterControlWidget extends TenantAuditableEntity {

    @Id
    private UUID id;

    @Column(nullable = false)
    private String name;

    @Column(name = "amount_paisa")
    private Long amountPaisa;
}
