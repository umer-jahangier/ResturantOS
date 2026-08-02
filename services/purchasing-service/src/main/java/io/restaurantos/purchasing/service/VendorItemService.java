package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.domain.model.Vendor;
import io.restaurantos.purchasing.domain.model.VendorCategory;
import io.restaurantos.purchasing.domain.model.VendorItem;
import io.restaurantos.purchasing.domain.model.VendorItemPrice;
import io.restaurantos.purchasing.dto.CreateVendorItemRequest;
import io.restaurantos.purchasing.dto.RecordVendorItemPriceRequest;
import io.restaurantos.purchasing.dto.UpdateVendorItemRequest;
import io.restaurantos.purchasing.dto.VendorCategoryDto;
import io.restaurantos.purchasing.dto.VendorItemDto;
import io.restaurantos.purchasing.dto.VendorItemPriceDto;
import io.restaurantos.purchasing.repository.VendorCategoryRepository;
import io.restaurantos.purchasing.repository.VendorItemPriceRepository;
import io.restaurantos.purchasing.repository.VendorItemRepository;
import io.restaurantos.purchasing.repository.VendorRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Vendor item catalog CRUD (PUR-07). The vendor's catalog is the system of record that lets a PO
 * line be priced and three-way matched — {@code vendor_catalogues} predates this service and has
 * never had Java behind it. Price mutation NEVER happens here; it is delegated entirely to
 * {@link VendorItemPriceService}, whose append-only shape must not be reproduced in this class.
 */
@Service
@Transactional(readOnly = true)
public class VendorItemService {

    private final VendorItemRepository vendorItemRepository;
    private final VendorItemPriceRepository vendorItemPriceRepository;
    private final VendorCategoryRepository vendorCategoryRepository;
    private final VendorRepository vendorRepository;
    private final TenantContext tenantContext;
    private final VendorItemPriceService vendorItemPriceService;
    private final IngredientReferenceValidator ingredientReferenceValidator;

    public VendorItemService(VendorItemRepository vendorItemRepository,
                              VendorItemPriceRepository vendorItemPriceRepository,
                              VendorCategoryRepository vendorCategoryRepository,
                              VendorRepository vendorRepository,
                              TenantContext tenantContext,
                              VendorItemPriceService vendorItemPriceService,
                              IngredientReferenceValidator ingredientReferenceValidator) {
        this.vendorItemRepository = vendorItemRepository;
        this.vendorItemPriceRepository = vendorItemPriceRepository;
        this.vendorCategoryRepository = vendorCategoryRepository;
        this.vendorRepository = vendorRepository;
        this.tenantContext = tenantContext;
        this.vendorItemPriceService = vendorItemPriceService;
        this.ingredientReferenceValidator = ingredientReferenceValidator;
    }

    public Page<VendorItemDto> list(UUID vendorId, Pageable pageable) {
        UUID tenantId = tenantContext.requireTenantId();
        requireVendor(tenantId, vendorId);

        Page<VendorItem> page = vendorItemRepository.findByTenantIdAndVendorIdAndArchivedAtIsNull(
                tenantId, vendorId, pageable);

        List<UUID> ids = page.getContent().stream().map(VendorItem::getId).toList();
        Map<UUID, VendorItemPrice> currentByItem = currentPricesByItem(tenantId, ids);

        return page.map(item -> toDto(item, currentByItem.get(item.getId())));
    }

    @Transactional
    public VendorItemDto create(UUID vendorId, CreateVendorItemRequest req) {
        UUID tenantId = tenantContext.requireTenantId();
        requireVendor(tenantId, vendorId);

        // T-08.2-044: the referenced ingredient lives in inventory-service (no cross-database FK is
        // possible), so verify it resolves to a live ingredient in this tenant before persisting a
        // catalog row that would otherwise carry a dangling/foreign reference onto PO lines and
        // spend analytics. Authoritative under integration-mode=feign; a permissive no-op in mock.
        ingredientReferenceValidator.requireIngredientInTenant(req.ingredientId());

        if (vendorItemRepository.existsByTenantIdAndVendorIdAndVendorSku(tenantId, vendorId, req.vendorSku())) {
            throw new StateInvalidException("Duplicate vendor SKU for this vendor: " + req.vendorSku());
        }

        VendorItem item = new VendorItem();
        item.setTenantId(tenantId);
        item.setVendorId(vendorId);
        item.setIngredientId(req.ingredientId());
        item.setVendorSku(req.vendorSku());
        item.setVendorDescription(req.vendorDescription());
        item.setGtin(req.gtin());
        item.setOrderUom(req.orderUom());
        item.setPackDescription(req.packDescription());
        item.setPackQty(req.packQty());
        item.setPackUom(req.packUom());
        // One order unit holds packQty pack units, by definition. The pack-unit-to-stock-unit leg
        // is NOT applied here and never can be — inventory owns the UOM registry — so the GRN event
        // carries this factor and packUom together and inventory finishes the conversion.
        item.setQtyPerOrderUnitInStockUom(req.packQty());
        item.setMinOrderQty(req.minOrderQty());
        item.setOrderMultiple(req.orderMultiple());
        item.setLeadTimeDays(req.leadTimeDays());
        item.setPreferred(Boolean.TRUE.equals(req.preferred()));
        item.setCatchWeight(Boolean.TRUE.equals(req.catchWeight()));

        VendorItem saved = vendorItemRepository.save(item);

        VendorItemPriceDto currentPrice = null;
        if (req.initialUnitPricePaisa() != null) {
            currentPrice = vendorItemPriceService.recordNewPrice(saved.getId(), new RecordVendorItemPriceRequest(
                    req.initialUnitPricePaisa(),
                    req.initialPriceUom() != null && !req.initialPriceUom().isBlank()
                            ? req.initialPriceUom() : req.orderUom(),
                    req.initialPriceEffectiveFrom(),
                    null,
                    false,
                    "CATALOG"));
        }

        return toDto(saved, currentPrice);
    }

    @Transactional
    public VendorItemDto update(UUID id, UpdateVendorItemRequest req) {
        UUID tenantId = tenantContext.requireTenantId();
        VendorItem item = vendorItemRepository.findByTenantIdAndId(tenantId, id)
                .orElseThrow(() -> new ResourceNotFoundException("VendorItem", id));

        item.setVendorSku(req.vendorSku());
        item.setVendorDescription(req.vendorDescription());
        item.setGtin(req.gtin());
        item.setOrderUom(req.orderUom());
        item.setPackDescription(req.packDescription());
        item.setPackQty(req.packQty());
        item.setPackUom(req.packUom());
        item.setQtyPerOrderUnitInStockUom(req.packQty());
        item.setMinOrderQty(req.minOrderQty());
        item.setOrderMultiple(req.orderMultiple());
        item.setLeadTimeDays(req.leadTimeDays());
        item.setPreferred(Boolean.TRUE.equals(req.preferred()));
        item.setCatchWeight(Boolean.TRUE.equals(req.catchWeight()));

        VendorItem saved = vendorItemRepository.save(item);
        return toDto(saved, currentPricesByItem(tenantId, List.of(saved.getId())).get(saved.getId()));
    }

    @Transactional
    public VendorItemDto archive(UUID id) {
        UUID tenantId = tenantContext.requireTenantId();
        VendorItem item = vendorItemRepository.findByTenantIdAndId(tenantId, id)
                .orElseThrow(() -> new ResourceNotFoundException("VendorItem", id));
        item.setArchivedAt(Instant.now());
        VendorItem saved = vendorItemRepository.save(item);
        return toDto(saved, currentPricesByItem(tenantId, List.of(saved.getId())).get(saved.getId()));
    }

    public List<VendorCategoryDto> listCategories(UUID vendorId) {
        UUID tenantId = tenantContext.requireTenantId();
        requireVendor(tenantId, vendorId);
        return vendorCategoryRepository.findByTenantIdAndVendorId(tenantId, vendorId).stream()
                .map(VendorItemService::toCategoryDto)
                .toList();
    }

    @Transactional
    public List<VendorCategoryDto> replaceCategories(UUID vendorId, List<VendorCategoryDto> categories) {
        UUID tenantId = tenantContext.requireTenantId();
        requireVendor(tenantId, vendorId);

        vendorCategoryRepository.deleteByTenantIdAndVendorId(tenantId, vendorId);

        List<VendorCategory> entities = categories.stream().map(dto -> {
            VendorCategory category = new VendorCategory();
            category.setTenantId(tenantId);
            category.setVendorId(vendorId);
            category.setCategoryId(dto.categoryId());
            category.setCategoryName(dto.categoryName());
            category.setPreferred(dto.preferred());
            return category;
        }).toList();

        return vendorCategoryRepository.saveAll(entities).stream()
                .map(VendorItemService::toCategoryDto)
                .toList();
    }

    private Vendor requireVendor(UUID tenantId, UUID vendorId) {
        Vendor vendor = vendorRepository.findById(vendorId)
                .filter(v -> tenantId.equals(v.getTenantId()))
                .orElseThrow(() -> new ResourceNotFoundException("Vendor", vendorId));
        return vendor;
    }

    /**
     * The current price per vendor item for the CALLER'S branch, in ONE batched call — that
     * branch's own price where one is recorded, the tenant-wide price otherwise
     * ({@link CurrentPriceResolver}).
     */
    private Map<UUID, VendorItemPrice> currentPricesByItem(UUID tenantId, List<UUID> vendorItemIds) {
        if (vendorItemIds.isEmpty()) {
            return Map.of();
        }
        return CurrentPriceResolver.byVendorItem(
                vendorItemPriceRepository.findCurrentForVendorItems(tenantId, vendorItemIds, Instant.now()),
                tenantContext.getBranchId().orElse(null));
    }

    private static VendorItemDto toDto(VendorItem v, VendorItemPrice currentPrice) {
        return new VendorItemDto(
                v.getId(), v.getVendorId(), v.getIngredientId(), v.getVendorSku(), v.getVendorDescription(),
                v.getOrderUom(), v.getPackDescription(), v.getPackQty(), v.getPackUom(), v.getMinOrderQty(),
                v.getOrderMultiple(), v.getLeadTimeDays(), v.isPreferred(), v.isCatchWeight(), v.getArchivedAt(),
                currentPrice != null ? currentPrice.getUnitPricePaisa() : null,
                currentPrice != null ? currentPrice.getPriceUom() : null,
                currentPrice != null ? currentPrice.getEffectiveFrom() : null);
    }

    private static VendorItemDto toDto(VendorItem v, VendorItemPriceDto currentPrice) {
        return new VendorItemDto(
                v.getId(), v.getVendorId(), v.getIngredientId(), v.getVendorSku(), v.getVendorDescription(),
                v.getOrderUom(), v.getPackDescription(), v.getPackQty(), v.getPackUom(), v.getMinOrderQty(),
                v.getOrderMultiple(), v.getLeadTimeDays(), v.isPreferred(), v.isCatchWeight(), v.getArchivedAt(),
                currentPrice != null ? currentPrice.unitPricePaisa() : null,
                currentPrice != null ? currentPrice.priceUom() : null,
                currentPrice != null ? currentPrice.effectiveFrom() : null);
    }

    private static VendorCategoryDto toCategoryDto(VendorCategory c) {
        return new VendorCategoryDto(c.getCategoryId(), c.getCategoryName(), c.isPreferred());
    }
}
