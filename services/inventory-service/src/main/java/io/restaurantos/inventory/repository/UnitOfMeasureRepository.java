package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.UnitOfMeasure;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface UnitOfMeasureRepository extends JpaRepository<UnitOfMeasure, UUID> {

    /**
     * EXPLICITLY tenant-scoped, unlike the ambient-filter variants below — every other repository
     * {@code IngredientService} touches already takes the tenant id as a parameter
     * ({@code findByTenantIdAndId}, {@code findByTenantIdOrderBySortOrderAscNameAsc}, …), and this
     * is the one read {@code UomProvisioningService} decides INSERTs from. Deciding what a tenant
     * is missing off a query that could return another tenant's rows would silently under-provision
     * it, so this must not depend on whether the {@code tenantFilter} Hibernate filter happens to
     * be enabled on the current session.
     */
    List<UnitOfMeasure> findByTenantId(UUID tenantId);

    /** Relies on the tenantFilter Hibernate filter (+ FORCE RLS) for tenant scoping. */
    Optional<UnitOfMeasure> findByCode(String code);

    /**
     * Batch variant of {@link #findByCode(String)} — {@code RecipeCostPreviewService} resolves
     * every distinct UOM code referenced by a draft line array in ONE query rather than one
     * lookup per line (T-08.2-074). Relies on the same tenantFilter Hibernate filter (+ FORCE RLS)
     * for tenant scoping.
     */
    List<UnitOfMeasure> findByCodeIn(Collection<String> codes);
}
