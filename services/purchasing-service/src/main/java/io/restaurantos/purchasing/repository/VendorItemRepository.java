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
