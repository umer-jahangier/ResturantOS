package io.restaurantos.hr.repository;

import io.restaurantos.hr.entity.DepartmentEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface DepartmentRepository extends JpaRepository<DepartmentEntity, UUID> {

    List<DepartmentEntity> findAllByTenantIdOrderByNameAsc(UUID tenantId);

    Optional<DepartmentEntity> findByIdAndTenantId(UUID id, UUID tenantId);

    /**
     * Case- and whitespace-insensitive name lookup, matching the FUNCTIONAL unique index
     * {@code ux_departments_tenant_name} on {@code (tenant_id, lower(trim(name)))}.
     *
     * <p>The index is the real guarantee — this exists so the service can turn what would be a bare
     * 23505 into a message that NAMES THE FIELD. A 409 with no field path cannot be bound to an
     * input, which is the whole point of D-35-03.
     *
     * <p>{@code excludeId} lets rename reuse the same query: renaming a row to its own current name
     * must not collide with itself.
     */
    @Query("""
           SELECT d FROM DepartmentEntity d
           WHERE d.tenantId = :tenantId
             AND lower(trim(d.name)) = lower(trim(:name))
             AND (:excludeId IS NULL OR d.id <> :excludeId)
           """)
    Optional<DepartmentEntity> findByNormalisedName(@Param("tenantId") UUID tenantId,
                                                    @Param("name") String name,
                                                    @Param("excludeId") UUID excludeId);
}
