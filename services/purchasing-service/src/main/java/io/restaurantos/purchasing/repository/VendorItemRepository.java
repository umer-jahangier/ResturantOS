package io.restaurantos.purchasing.repository;

import io.restaurantos.purchasing.domain.model.VendorItem;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface VendorItemRepository extends JpaRepository<VendorItem, UUID> {

    /**
     * Live catalog rows in this tenant packing in a unit code — the cross-database half of
     * inventory's unit-retire guard (36-05). Case-insensitive: unit codes are not normalised at
     * rest, and a guard that missed a lowercase match would not guard.
     */
    @org.springframework.data.jpa.repository.Query(
            "select count(v) from VendorItem v where v.tenantId = :tenantId "
            + "and lower(v.packUom) = lower(:code) and v.archivedAt is null")
    long countLiveByPackUom(@org.springframework.data.repository.query.Param("tenantId") UUID tenantId,
                            @org.springframework.data.repository.query.Param("code") String code);

    Page<VendorItem> findByTenantIdAndVendorIdAndArchivedAtIsNull(UUID tenantId, UUID vendorId, Pageable pageable);

    List<VendorItem> findByTenantIdAndVendorIdAndArchivedAtIsNull(UUID tenantId, UUID vendorId);

    List<VendorItem> findByTenantIdAndIngredientIdAndArchivedAtIsNull(UUID tenantId, UUID ingredientId);

    /**
     * Batch variant for {@code OrderSuggestionService} — one query for every low ingredient on a
     * branch, never one lookup per suggestion. Ordered by vendor id so a tie between two equally
     * preferred catalog rows resolves the same way on every call rather than by insertion order.
     */
    List<VendorItem> findByTenantIdAndIngredientIdInAndArchivedAtIsNullOrderByVendorIdAsc(
            UUID tenantId, Collection<UUID> ingredientIds);

    Optional<VendorItem> findByTenantIdAndId(UUID tenantId, UUID id);

    boolean existsByTenantIdAndVendorIdAndVendorSku(UUID tenantId, UUID vendorId, String vendorSku);
}
