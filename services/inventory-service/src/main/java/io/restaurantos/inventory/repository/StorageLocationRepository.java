package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.domain.model.StorageLocation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Every method here takes the tenant id explicitly. That is deliberate — see
 * {@link UnitOfMeasureRepository#findByTenantId}: the ambient {@code tenantFilter} variants next
 * to it were proven able to leak across tenants, and this repository decides what a write may
 * reference, so it must not depend on whether that filter happens to be enabled on the session.
 */
@Repository
public interface StorageLocationRepository extends JpaRepository<StorageLocation, UUID> {

    List<StorageLocation> findByTenantIdOrderBySortOrderAscNameAsc(UUID tenantId);

    Optional<StorageLocation> findByTenantIdAndId(UUID tenantId, UUID id);

    /**
     * Backs the case-insensitive duplicate check that mirrors {@code uq_storage_location_tenant_name_ci}.
     * Checking in the service produces a message a manager can act on; letting the index reject it
     * produces a constraint-violation stack trace and a 500.
     */
    Optional<StorageLocation> findByTenantIdAndNameIgnoreCase(UUID tenantId, String name);
}
