package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.domain.model.Vendor;
import io.restaurantos.purchasing.domain.model.VendorItem;
import io.restaurantos.purchasing.domain.model.VendorItemPrice;
import io.restaurantos.purchasing.dto.CreatePurchaseOrderRequest;
import io.restaurantos.purchasing.dto.OrderSuggestionDto;
import io.restaurantos.purchasing.dto.OrderSuggestionDto.CreateFromSuggestionsRequest;
import io.restaurantos.purchasing.dto.PurchaseOrderDto;
import io.restaurantos.purchasing.dto.OrderSuggestionDto.OrderSuggestionsResponse;
import io.restaurantos.purchasing.dto.OrderSuggestionDto.VendorGroup;
import io.restaurantos.purchasing.exception.InventoryUnavailableException;
import io.restaurantos.purchasing.exception.VendorItemCatalogMismatchException;
import io.restaurantos.purchasing.feign.InventoryReorderClient;
import io.restaurantos.purchasing.feign.InventoryReorderClient.ReorderShortfall;
import io.restaurantos.purchasing.repository.VendorItemPriceRepository;
import io.restaurantos.purchasing.repository.VendorItemRepository;
import io.restaurantos.purchasing.repository.VendorRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Turns "what is low" into "what to buy, from whom".
 *
 * <p>Inventory owns the first half ({@code on-hand} vs {@code par}); purchasing owns the second
 * (which supplier, in what pack, at what price). This service is the join, and it is the first
 * consumer of {@code ingredients.par_level} and {@code item_categories.exclude_from_po_suggestions}
 * anywhere in the system — both were settable for a phase and read by nothing, so a manager could
 * record "keep 25 kg on the shelf" and have it change no behaviour at all.
 *
 * <p>Every ambiguity is REPORTED, never guessed. Two suppliers for one ingredient, or a catalog
 * entry with no current price, produce a row carrying a reason rather than an arbitrary pick — a
 * suggestion someone will act on without checking has to be one the system can actually justify.
 */
@Service
@Transactional(readOnly = true)
public class OrderSuggestionService {

    private static final String NO_VENDOR =
            "No supplier set up for this item. Add it to a vendor's catalogue first.";
    private static final String AMBIGUOUS_VENDOR =
            "Several suppliers sell this and none is marked preferred. Mark one to order it automatically.";
    private static final String NO_PRICE =
            "This supplier has no current price for the item, so the order value can't be worked out.";

    private final InventoryReorderClient inventoryReorderClient;
    private final VendorItemRepository vendorItemRepository;
    private final VendorItemPriceRepository vendorItemPriceRepository;
    private final VendorRepository vendorRepository;
    private final PurchaseOrderService purchaseOrderService;
    private final TenantContext tenantContext;

    public OrderSuggestionService(InventoryReorderClient inventoryReorderClient,
                                   VendorItemRepository vendorItemRepository,
                                   VendorItemPriceRepository vendorItemPriceRepository,
                                   VendorRepository vendorRepository,
                                   PurchaseOrderService purchaseOrderService,
                                   TenantContext tenantContext) {
        this.inventoryReorderClient = inventoryReorderClient;
        this.vendorItemRepository = vendorItemRepository;
        this.vendorItemPriceRepository = vendorItemPriceRepository;
        this.vendorRepository = vendorRepository;
        this.purchaseOrderService = purchaseOrderService;
        this.tenantContext = tenantContext;
    }

    public OrderSuggestionsResponse suggestForBranch(UUID branchId) {
        UUID tenantId = tenantContext.requireTenantId();

        List<ReorderShortfall> shortfalls = fetchShortfalls(branchId);
        if (shortfalls.isEmpty()) {
            return new OrderSuggestionsResponse(branchId, List.of(), List.of(), 0, 0L);
        }

        // Three bounded queries for the whole page, regardless of how many items are low: the
        // catalog rows for exactly the shortfall ingredients, their current prices, and the
        // vendors those rows belong to.
        Map<UUID, List<VendorItem>> catalogByIngredient = catalogFor(tenantId, shortfalls);
        List<UUID> vendorItemIds = catalogByIngredient.values().stream()
                .flatMap(List::stream)
                .map(VendorItem::getId)
                .toList();
        Map<UUID, VendorItemPrice> priceByVendorItem = currentPrices(tenantId, vendorItemIds, branchId);
        Map<UUID, Vendor> vendorsById = vendorsFor(tenantId, catalogByIngredient);

        List<OrderSuggestionDto> resolved = new ArrayList<>();
        for (ReorderShortfall shortfall : shortfalls) {
            resolved.add(resolve(shortfall, catalogByIngredient.getOrDefault(shortfall.ingredientId(), List.of()),
                    priceByVendorItem, vendorsById));
        }

        return group(branchId, resolved);
    }

    /**
     * Creates one DRAFT purchase order per vendor from the lines the buyer accepted.
     *
     * <p>Grouping happens here rather than in the browser because a purchase order goes to exactly
     * one supplier: a buyer accepting eight lines across three vendors means three orders, and
     * making the frontend split them would put that rule in the wrong place.
     *
     * <p>Delegates to {@link PurchaseOrderService#create} unchanged — the catalog path it already
     * has derives ingredient, unit and price from {@code vendorItemId}, so a suggested order is
     * indistinguishable from a hand-typed one once created, including for approval thresholds.
     */
    @Transactional
    public List<PurchaseOrderDto> createDrafts(CreateFromSuggestionsRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        if (request.lines() == null || request.lines().isEmpty()) {
            return List.of();
        }

        List<UUID> vendorItemIds = request.lines().stream()
                .map(CreateFromSuggestionsRequest.AcceptedLine::vendorItemId)
                .distinct()
                .toList();
        Map<UUID, VendorItem> catalogById = vendorItemRepository.findAllById(vendorItemIds).stream()
                .filter(item -> tenantId.equals(item.getTenantId()))
                .collect(Collectors.toMap(VendorItem::getId, Function.identity()));

        // Preserve the order the lines arrived in within each vendor, so a created draft reads in
        // the same sequence the buyer reviewed.
        Map<UUID, List<CreatePurchaseOrderRequest.Line>> linesByVendor = new LinkedHashMap<>();
        for (CreateFromSuggestionsRequest.AcceptedLine accepted : request.lines()) {
            VendorItem item = catalogById.get(accepted.vendorItemId());
            if (item == null) {
                // Same refusal a hand-typed PO gets for a foreign/archived/nonexistent catalog id.
                throw new VendorItemCatalogMismatchException(
                        "vendorItemId " + accepted.vendorItemId() + " is not in this tenant's catalogue");
            }
            linesByVendor
                    .computeIfAbsent(item.getVendorId(), key -> new ArrayList<>())
                    // uom and unitPricePaisa deliberately null: PurchaseOrderService fills both from
                    // the catalogue, so the draft carries the price a PO would have used anyway
                    // rather than one this screen cached.
                    .add(new CreatePurchaseOrderRequest.Line(
                            accepted.vendorItemId(), null, accepted.qty(), null, null));
        }

        List<PurchaseOrderDto> drafts = new ArrayList<>(linesByVendor.size());
        for (Map.Entry<UUID, List<CreatePurchaseOrderRequest.Line>> entry : linesByVendor.entrySet()) {
            drafts.add(purchaseOrderService.create(new CreatePurchaseOrderRequest(
                    entry.getKey(), request.branchId(), null,
                    "Created from order suggestions", entry.getValue())));
        }
        return drafts;
    }

    // ---- inventory seam ----

    /**
     * Fails closed. A partial suggestion list is worse than none: someone would order from it,
     * and the items it silently omitted are exactly the ones about to run out.
     */
    private List<ReorderShortfall> fetchShortfalls(UUID branchId) {
        try {
            InventoryReorderClient.ReorderShortfallsResponse response =
                    inventoryReorderClient.getShortfalls(branchId);
            return response == null || response.items() == null ? List.of() : response.items();
        } catch (RuntimeException ex) {
            throw new InventoryUnavailableException(
                    "Can't work out what to order — inventory is unavailable. Please try again.", ex);
        }
    }

    // ---- the join ----

    private OrderSuggestionDto resolve(ReorderShortfall shortfall, List<VendorItem> catalog,
                                        Map<UUID, VendorItemPrice> priceByVendorItem,
                                        Map<UUID, Vendor> vendorsById) {
        // An upstream block (no par level set) travels through unchanged. Re-deciding it here
        // would put two different explanations of the same row in two services.
        if (shortfall.blockedReason() != null || shortfall.suggestedQty() == null) {
            return blocked(shortfall, shortfall.blockedReason());
        }
        if (catalog.isEmpty()) {
            return blocked(shortfall, NO_VENDOR);
        }

        VendorItem chosen = choose(catalog);
        if (chosen == null) {
            return blocked(shortfall, AMBIGUOUS_VENDOR);
        }

        VendorItemPrice price = priceByVendorItem.get(chosen.getId());
        if (price == null) {
            return blocked(shortfall, NO_PRICE);
        }

        BigDecimal orderQty = orderQty(shortfall.suggestedQty(), chosen);
        Vendor vendor = vendorsById.get(chosen.getVendorId());
        long unitPricePaisa = price.getUnitPricePaisa();
        long lineTotalPaisa = orderQty.multiply(BigDecimal.valueOf(unitPricePaisa))
                .setScale(0, RoundingMode.HALF_UP)
                .longValueExact();

        return new OrderSuggestionDto(
                shortfall.ingredientId(), shortfall.ingredientName(), shortfall.sku(),
                shortfall.categoryName(),
                shortfall.qtyOnHand(), shortfall.reorderPoint(), shortfall.parLevel(),
                shortfall.baseUomCode(), shortfall.suggestedQty(),
                chosen.getVendorId(), vendor == null ? null : vendor.getName(),
                chosen.getId(), chosen.getVendorSku(), chosen.getPackDescription(),
                chosen.getOrderUom(), orderQty, unitPricePaisa, lineTotalPaisa,
                leadTime(chosen, vendor),
                null);
    }

    /**
     * The preferred catalog row wins. Without one, a single row is unambiguous and is used; two or
     * more is a genuine choice only a buyer can make, so it is handed back rather than guessed at.
     *
     * <p>Several rows marked preferred is a data problem, not a decision: the vendor-name ordering
     * imposed by {@link #catalogFor} makes the pick at least deterministic rather than
     * insertion-ordered.
     */
    private static VendorItem choose(List<VendorItem> catalog) {
        List<VendorItem> preferred = catalog.stream().filter(VendorItem::isPreferred).toList();
        if (!preferred.isEmpty()) {
            return preferred.get(0);
        }
        return catalog.size() == 1 ? catalog.get(0) : null;
    }

    /**
     * Converts a stock-unit shortfall into whole purchasable units.
     *
     * <p>Rounds UP at every step, which is the only safe direction: rounding a 15 kg shortfall down
     * to one 10 kg case leaves the shelf below par on the day the delivery arrives, which is the
     * exact situation this list exists to prevent. Buying slightly more is a carrying cost; buying
     * slightly less is a stockout.
     *
     * <p>Order: pack size first (how many stock units come in one order unit), then the supplier's
     * order multiple (they ship in sixes), then their minimum order. Minimum comes last because it
     * is a floor on the final number, not an input to the arithmetic.
     */
    private static BigDecimal orderQty(BigDecimal shortfallInStockUom, VendorItem item) {
        BigDecimal perOrderUnit = item.getQtyPerOrderUnitInStockUom();
        // Null means the catalog never recorded a conversion — treat the order unit as the stock
        // unit rather than skipping the row, so "order 15 kg" still beats "we can't tell you".
        if (perOrderUnit == null || perOrderUnit.signum() <= 0) {
            perOrderUnit = BigDecimal.ONE;
        }

        BigDecimal units = shortfallInStockUom.divide(perOrderUnit, 0, RoundingMode.CEILING);

        BigDecimal multiple = item.getOrderMultiple();
        if (multiple != null && multiple.signum() > 0) {
            units = units.divide(multiple, 0, RoundingMode.CEILING).multiply(multiple);
        }

        BigDecimal minimum = item.getMinOrderQty();
        if (minimum != null && minimum.compareTo(units) > 0) {
            units = minimum;
        }

        return units.stripTrailingZeros().scale() < 0 ? units.setScale(0) : units;
    }

    /** The catalog row's own lead time when it has one — a supplier's headline figure does not
     * always hold for every item they sell (a special order takes longer than a staple). */
    private static Integer leadTime(VendorItem item, Vendor vendor) {
        if (item.getLeadTimeDays() != null) {
            return item.getLeadTimeDays();
        }
        return vendor == null ? null : vendor.getLeadTimeDays();
    }

    private static OrderSuggestionDto blocked(ReorderShortfall shortfall, String reason) {
        return new OrderSuggestionDto(
                shortfall.ingredientId(), shortfall.ingredientName(), shortfall.sku(),
                shortfall.categoryName(),
                shortfall.qtyOnHand(), shortfall.reorderPoint(), shortfall.parLevel(),
                shortfall.baseUomCode(), shortfall.suggestedQty(),
                null, null, null, null, null, null, null, null, null, null,
                reason);
    }

    // ---- lookups ----

    private Map<UUID, List<VendorItem>> catalogFor(UUID tenantId, List<ReorderShortfall> shortfalls) {
        List<UUID> ingredientIds = shortfalls.stream().map(ReorderShortfall::ingredientId).distinct().toList();
        Map<UUID, List<VendorItem>> byIngredient = new HashMap<>();
        for (VendorItem item : vendorItemRepository
                .findByTenantIdAndIngredientIdInAndArchivedAtIsNullOrderByVendorIdAsc(tenantId, ingredientIds)) {
            byIngredient.computeIfAbsent(item.getIngredientId(), key -> new ArrayList<>()).add(item);
        }
        return byIngredient;
    }

    /**
     * Resolved for the branch the suggestions are FOR, through {@link CurrentPriceResolver} — the
     * same rule {@code PurchaseOrderService} derives a line price by, so an estimate still survives
     * contact with the PO it becomes. It previously discarded branch prices outright, which met
     * that goal only because the PO path discarded them too; both were wrong together.
     */
    private Map<UUID, VendorItemPrice> currentPrices(UUID tenantId, List<UUID> vendorItemIds, UUID branchId) {
        if (vendorItemIds.isEmpty()) {
            return Map.of();
        }
        return CurrentPriceResolver.byVendorItem(
                vendorItemPriceRepository.findCurrentForVendorItems(tenantId, vendorItemIds, Instant.now()),
                branchId);
    }

    private Map<UUID, Vendor> vendorsFor(UUID tenantId, Map<UUID, List<VendorItem>> catalogByIngredient) {
        List<UUID> vendorIds = catalogByIngredient.values().stream()
                .flatMap(List::stream)
                .map(VendorItem::getVendorId)
                .distinct()
                .toList();
        if (vendorIds.isEmpty()) {
            return Map.of();
        }
        return vendorRepository.findAllById(vendorIds).stream()
                .filter(vendor -> tenantId.equals(vendor.getTenantId()))
                .collect(Collectors.toMap(Vendor::getId, Function.identity()));
    }

    // ---- grouping ----

    private static OrderSuggestionsResponse group(UUID branchId, List<OrderSuggestionDto> resolved) {
        Map<UUID, List<OrderSuggestionDto>> byVendor = new LinkedHashMap<>();
        List<OrderSuggestionDto> unassigned = new ArrayList<>();

        for (OrderSuggestionDto suggestion : resolved.stream()
                .sorted(Comparator.comparing(dto -> dto.ingredientName().toLowerCase(Locale.ROOT)))
                .toList()) {
            if (suggestion.orderable()) {
                byVendor.computeIfAbsent(suggestion.vendorId(), key -> new ArrayList<>()).add(suggestion);
            } else {
                unassigned.add(suggestion);
            }
        }

        List<VendorGroup> groups = byVendor.entrySet().stream()
                .map(entry -> {
                    List<OrderSuggestionDto> lines = entry.getValue();
                    long total = lines.stream().mapToLong(OrderSuggestionDto::lineTotalPaisa).sum();
                    OrderSuggestionDto first = lines.get(0);
                    return new VendorGroup(entry.getKey(), first.vendorName(), first.leadTimeDays(), total, lines);
                })
                .sorted(Comparator.comparing(g -> g.vendorName() == null
                        ? "" : g.vendorName().toLowerCase(Locale.ROOT)))
                .toList();

        long estimatedTotalPaisa = groups.stream().mapToLong(VendorGroup::estimatedTotalPaisa).sum();
        return new OrderSuggestionsResponse(branchId, groups, unassigned, unassigned.size(), estimatedTotalPaisa);
    }
}
