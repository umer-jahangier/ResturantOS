package io.restaurantos.hr.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * A tenant-managed department (35-02's {@code departments} table).
 *
 * <p>Replaces {@code employees.department}, a free-text column — which is how "Waiter", "waiter"
 * and "Wtr" became three departments that no report could group. Uniqueness is enforced by a
 * FUNCTIONAL unique index on {@code (tenant_id, lower(trim(name)))}, not by this class.
 *
 * <p>Has setters, unlike {@code TaxConfigEntity} — whose lack of them is precisely why tax
 * configuration has had no write path and payroll cannot run.
 */
@Entity
@Table(name = "departments")
@Getter
@Setter
public class DepartmentEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "name", nullable = false)
    private String name;

    @Column(name = "code")
    private String code;

    /**
     * Deactivated rather than deleted.
     *
     * <p>A department referenced by an employee cannot be removed without either orphaning the
     * employee or rewriting their record, and both are worse than a flag. An inactive row stays
     * resolvable by id — so an existing employee still renders — while dropping out of the list of
     * assignable options.
     */
    @Column(name = "is_active", nullable = false)
    private boolean active = true;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt = Instant.now();

    @Column(name = "created_by")
    private UUID createdBy;

    @Column(name = "updated_by")
    private UUID updatedBy;
}
