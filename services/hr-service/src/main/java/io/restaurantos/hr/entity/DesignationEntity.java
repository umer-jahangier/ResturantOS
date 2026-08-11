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
 * A tenant-managed job title (35-02's {@code designations} table).
 *
 * <p>Replaces {@code employees.designation}, a free-text column. Same case-insensitive uniqueness
 * rule as {@link DepartmentEntity}, scoped to the tenant.
 */
@Entity
@Table(name = "designations")
@Getter
@Setter
public class DesignationEntity {

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
     * Optional parent department — nullable on purpose.
     *
     * <p>A tenant that wants job titles grouped under departments can have that; one that does not
     * can leave every row unattached. Requiring it would force an owner to invent a department
     * before they can name a single job title.
     */
    @Column(name = "department_id")
    private UUID departmentId;

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
