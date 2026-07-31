package io.restaurantos.purchasing.repository;

import io.restaurantos.purchasing.domain.model.VendorItemPrice;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

public interface VendorItemPriceRepository extends JpaRepository<VendorItemPrice, UUID> {

    List<VendorItemPrice> findByTenantIdAndVendorItemIdOrderByEffectiveFromDesc(UUID tenantId, UUID vendorItemId);

    List<VendorItemPrice> findByTenantIdAndVendorItemIdInOrderByEffectiveFromDesc(
            UUID tenantId, Collection<UUID> vendorItemIds);

    /**
     * The current price for each of {@code vendorItemIds} — the row whose window covers {@code
     * now}. Callers batch this ONE call across an entire catalog page rather than querying per
     * row (see {@code VendorItemService.list}).
     */
    @Query("""
            SELECT p FROM VendorItemPrice p
            WHERE p.tenantId = :tenantId
              AND p.vendorItemId IN :vendorItemIds
              AND p.effectiveFrom <= :now
              AND (p.effectiveTo IS NULL OR p.effectiveTo > :now)
            ORDER BY p.effectiveFrom DESC
            """)
    List<VendorItemPrice> findCurrentForVendorItems(
            @Param("tenantId") UUID tenantId,
            @Param("vendorItemIds") Collection<UUID> vendorItemIds,
            @Param("now") Instant now);
}
