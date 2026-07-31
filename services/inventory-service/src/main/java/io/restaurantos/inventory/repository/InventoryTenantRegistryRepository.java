package io.restaurantos.inventory.repository;

import io.restaurantos.inventory.entity.InventoryTenantRegistryEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

/**
 * The D6 gap-closure tenant registry (RLS-exempt {@code inventory_tenant_registry}, V3). Backs
 * {@code ExpirySweepService}'s cross-tenant discovery — {@link #findAllTenantIds()} needs no
 * ambient {@code TenantContext} because this table carries no tenant-isolation policy at all.
 * {@link #upsertTenant(UUID)} is written by {@code TenantRegistryService} inside the same
 * transaction as the stock write it accompanies.
 */
@Repository
public interface InventoryTenantRegistryRepository extends JpaRepository<InventoryTenantRegistryEntity, UUID> {

    /**
     * Idempotent registration — {@code ON CONFLICT DO NOTHING} so repeated calls for an
     * already-registered tenant (every subsequent receipt/opening-balance/transfer-receive/count
     * for the same tenant) are a harmless no-op, never an error or a duplicate row.
     */
    @Modifying
    @Query(value = "INSERT INTO inventory_tenant_registry (tenant_id) VALUES (:tenantId) "
            + "ON CONFLICT (tenant_id) DO NOTHING", nativeQuery = true)
    void upsertTenant(@Param("tenantId") UUID tenantId);

    @Query("SELECT r.tenantId FROM InventoryTenantRegistryEntity r")
    List<UUID> findAllTenantIds();
}
