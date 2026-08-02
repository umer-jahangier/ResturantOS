package io.restaurantos.inventory.service;

import io.restaurantos.inventory.config.InventoryRabbitConfig;
import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import io.restaurantos.inventory.domain.model.InventoryMovement;
import io.restaurantos.inventory.domain.model.StockCount;
import io.restaurantos.inventory.domain.model.StockCountLine;
import io.restaurantos.inventory.dto.StockCountDtos.CountLineDto;
import io.restaurantos.inventory.dto.StockCountDtos.CountLineRequest;
import io.restaurantos.inventory.dto.StockCountDtos.CreateStockCountRequest;
import io.restaurantos.inventory.dto.StockCountDtos.StockCountDto;
import io.restaurantos.shared.event.payload.InventoryEventContract;
import io.restaurantos.shared.event.payload.InventoryEventContract.CountVarianceLine;
import io.restaurantos.shared.event.payload.InventoryEventContract.CountVariancePostedPayload;
import io.restaurantos.shared.event.payload.InventoryEventContract.LowStockAlertPayload;
import io.restaurantos.inventory.exception.CountVarianceOverCapException;
import io.restaurantos.inventory.exception.CountVarianceOverCapException.OverCapLine;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.InventoryMovementRepository;
import io.restaurantos.inventory.repository.StockCountLineRepository;
import io.restaurantos.inventory.repository.StockCountRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Stock counts with variance posting (INV-06) — a count-sheet post computes per-ingredient
 * variance against the CURRENT system quantity, adjusts {@code qty_on_hand} under the same
 * {@code findForUpdate} PESSIMISTIC_WRITE convention {@link DepletionService}/{@link ReceiptService}/
 * {@link TransferService} use (T-8-RACE), writes a {@code COUNT_VARIANCE} {@code inventory_movements}
 * row per line, queues {@code LOW_STOCK_ALERT} on reorder-point breach (the same check
 * {@code DepletionService} performs, extracted here as a small reusable helper), and publishes
 * {@code COUNT_VARIANCE_POSTED} through the transactional outbox as the LAST statement of the
 * transaction. Count-variance JEs are event-only (Phase 9 posts the GL entry) — this class never
 * calls finance-service directly.
 */
@Service
public class StockCountService {

    private static final BigDecimal ONE_HUNDRED = BigDecimal.valueOf(100);

    private final StockCountRepository stockCountRepository;
    private final StockCountLineRepository stockCountLineRepository;
    private final IngredientBranchStockRepository stockRepository;
    private final InventoryMovementRepository movementRepository;
    private final IngredientRepository ingredientRepository;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;
    private final TenantRegistryService tenantRegistryService;
    private final ItemCategoryService itemCategoryService;

    public StockCountService(StockCountRepository stockCountRepository,
                              StockCountLineRepository stockCountLineRepository,
                              IngredientBranchStockRepository stockRepository,
                              InventoryMovementRepository movementRepository,
                              IngredientRepository ingredientRepository,
                              EventPublisher eventPublisher,
                              TenantContext tenantContext,
                              TenantRegistryService tenantRegistryService,
                              ItemCategoryService itemCategoryService) {
        this.stockCountRepository = stockCountRepository;
        this.stockCountLineRepository = stockCountLineRepository;
        this.stockRepository = stockRepository;
        this.movementRepository = movementRepository;
        this.ingredientRepository = ingredientRepository;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
        this.tenantRegistryService = tenantRegistryService;
        this.itemCategoryService = itemCategoryService;
    }

    @Transactional
    public StockCountDto postCount(CreateStockCountRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        // D6 gap-closure: register this tenant in the RLS-exempt cross-tenant registry (in the
        // same transaction as the count-line stock adjustments below) so ExpirySweepService's
        // ambient-context-free nightly cron trigger can discover it later.
        tenantRegistryService.registerTenant(tenantId);

        StockCount count = new StockCount();
        count.setTenantId(tenantId);
        count.setBranchId(request.branchId());
        count.setStatus("DRAFT");
        count.setCountedAt(Instant.now());
        StockCount savedCount = stockCountRepository.save(count);

        // Sorted-lock deadlock avoidance (Pitfall 6, reused from DepletionService/TransferService):
        // lock the DISTINCT ingredientId set in natural UUID order, never in per-line encounter order.
        List<CountLineRequest> sortedLines = new ArrayList<>(request.lines());
        sortedLines.sort(Comparator.comparing(CountLineRequest::ingredientId));

        List<StockCountLine> savedLines = new ArrayList<>();
        List<CountVarianceLine> eventLines = new ArrayList<>();
        long totalVarianceCostPaisa = 0L;

        // Resolved ONCE per post, not per line: one whole-tenant category walk feeding every
        // line's cap lookup, and one ingredient fetch for the category ids and names the rejection
        // message needs.
        VarianceCaps caps = varianceCaps(tenantId, sortedLines);
        List<OverCapLine> breaches = new ArrayList<>();

        for (CountLineRequest line : sortedLines) {
            IngredientBranchStock stock = stockRepository
                    .findForUpdate(tenantId, request.branchId(), line.ingredientId())
                    .orElseGet(() -> stockRepository.save(
                            newStockRow(tenantId, request.branchId(), line.ingredientId())));

            BigDecimal systemQty = stock.getQtyOnHand();
            BigDecimal varianceQty = line.countedQty().subtract(systemQty);
            long varianceCostPaisa = roundCostPaisa(varianceQty, stock.getAvgCostPaisa());

            BigDecimal variancePct = variancePct(varianceQty, systemQty);
            BigDecimal capPct = caps.capFor(line.ingredientId());
            boolean overCap = exceedsCap(variancePct, capPct);
            String overrideReason = overCap ? trimToNull(line.overrideReason()) : null;
            if (overCap && overrideReason == null) {
                breaches.add(OverCapLine.of(line.ingredientId(), caps.nameFor(line.ingredientId()),
                        variancePct.abs(), capPct));
                // Keep going rather than throwing here, so the response names EVERY over-cap line
                // at once. A counter fixing them one rejected post at a time would be maddening,
                // and the whole transaction rolls back below regardless.
                continue;
            }

            stock.setQtyOnHand(line.countedQty());
            stock.setLastCountedAt(Instant.now());
            IngredientBranchStock savedStock = stockRepository.save(stock);

            InventoryMovement movement = new InventoryMovement();
            movement.setTenantId(tenantId);
            movement.setBranchId(request.branchId());
            movement.setIngredientId(line.ingredientId());
            movement.setMovementType("COUNT_VARIANCE");
            movement.setQty(varianceQty);
            movement.setUnitCostPaisa(savedStock.getAvgCostPaisa());
            movement.setTotalCostPaisa(varianceCostPaisa);
            movement.setReferenceType("STOCK_COUNT");
            movement.setReferenceId(savedCount.getId());
            movementRepository.save(movement);

            StockCountLine countLine = new StockCountLine();
            countLine.setTenantId(tenantId);
            countLine.setCountId(savedCount.getId());
            countLine.setIngredientId(line.ingredientId());
            countLine.setSystemQty(systemQty);
            countLine.setCountedQty(line.countedQty());
            countLine.setVarianceQty(varianceQty);
            countLine.setVarianceCostPaisa(varianceCostPaisa);
            countLine.setVariancePct(variancePct);
            countLine.setCapPct(capPct);
            countLine.setOverrideReason(overrideReason);
            savedLines.add(stockCountLineRepository.save(countLine));

            // Reorder-point breach -> LOW_STOCK_ALERT (extracted helper — same semantics as
            // DepletionService's Step 7, reused here so every stock-mutating flow queues the alert
            // identically).
            publishLowStockAlertIfBreached(savedStock, request.branchId());

            eventLines.add(new CountVarianceLine(line.ingredientId(), varianceQty, varianceCostPaisa,
                    overrideReason != null, overrideReason));
            totalVarianceCostPaisa += varianceCostPaisa;
        }

        // Thrown AFTER the loop so every offending line is reported together. @Transactional rolls
        // back the stock adjustments and movements written for the lines that were within cap —
        // a count posts whole or not at all, never half-applied with the awkward lines dropped.
        if (!breaches.isEmpty()) {
            throw new CountVarianceOverCapException(breaches);
        }

        savedCount.setStatus("POSTED");
        savedCount.setPostedAt(Instant.now());
        StockCount finalCount = stockCountRepository.save(savedCount);

        // Last statement: publish COUNT_VARIANCE_POSTED through the transactional outbox — never
        // before/outside the count mutation (mirrors DepletionService/TransferService's shape).
        eventPublisher.publish(
                InventoryRabbitConfig.INVENTORY_TOPIC_EXCHANGE,
                InventoryEventContract.COUNT_VARIANCE_POSTED_KEY,
                InventoryEventContract.COUNT_VARIANCE_POSTED,
                request.branchId(),
                new CountVariancePostedPayload(finalCount.getId(), request.branchId(), eventLines, totalVarianceCostPaisa));

        return toDto(finalCount, savedLines, totalVarianceCostPaisa);
    }

    /**
     * Reorder-point breach check, extracted as a small reusable helper so the LOW_STOCK_ALERT
     * semantics stay identical to {@link DepletionService}'s inline check: an ingredient with no
     * master-data row (never seeded) is silently skipped, never treated as a breach.
     */
    private void publishLowStockAlertIfBreached(IngredientBranchStock stock, UUID branchId) {
        Optional<Ingredient> ingredient = ingredientRepository.findById(stock.getIngredientId());
        if (ingredient.isPresent()
                && stock.getQtyOnHand().compareTo(ingredient.get().getReorderPoint()) <= 0) {
            eventPublisher.publish(
                    InventoryRabbitConfig.INVENTORY_TOPIC_EXCHANGE,
                    InventoryEventContract.LOW_STOCK_ALERT_KEY,
                    InventoryEventContract.LOW_STOCK_ALERT,
                    branchId,
                    new LowStockAlertPayload(stock.getIngredientId(), branchId, stock.getQtyOnHand(),
                            ingredient.get().getReorderPoint()));
        }
    }

    /**
     * The signed variance as a percentage of the system quantity.
     *
     * <p>Null when system qty is ZERO. A percentage needs a base, and the first count of an item —
     * or one whose stock legitimately ran to nothing — has none. Treating that as an infinite
     * variance would demand an override on every first count, which trains people to type
     * meaningless reasons and quietly destroys the control this cap exists to provide. Uncapped is
     * the honest answer; the line still records its absolute variance and cost like any other.
     */
    private static BigDecimal variancePct(BigDecimal varianceQty, BigDecimal systemQty) {
        if (systemQty.signum() == 0) {
            return null;
        }
        return varianceQty.multiply(ONE_HUNDRED)
                .divide(systemQty.abs(), 2, RoundingMode.HALF_UP);
    }

    /** Uncapped categories and unmeasurable percentages both mean "nothing to exceed". */
    private static boolean exceedsCap(BigDecimal variancePct, BigDecimal capPct) {
        return variancePct != null && capPct != null && variancePct.abs().compareTo(capPct) > 0;
    }

    /**
     * Resolves the variance cap for each ingredient in this count, via its category and that
     * category's ancestors (most-specific-wins, the same walk the GL accounts use).
     *
     * <p>Two batched reads regardless of line count: one ingredient fetch, one whole-tenant
     * category walk. An ingredient with no master-data row — the same case
     * {@link #publishLowStockAlertIfBreached} skips — is uncapped rather than blocked, since there
     * is no category to read a threshold from.
     */
    private VarianceCaps varianceCaps(UUID tenantId, List<CountLineRequest> lines) {
        List<UUID> ingredientIds = lines.stream().map(CountLineRequest::ingredientId).toList();
        Map<UUID, Ingredient> ingredients = new java.util.HashMap<>();
        for (Ingredient ingredient : ingredientRepository.findByTenantIdAndIdIn(tenantId, ingredientIds)) {
            ingredients.put(ingredient.getId(), ingredient);
        }
        return new VarianceCaps(ingredients, itemCategoryService.resolveDefaultsByCategory(tenantId));
    }

    private record VarianceCaps(Map<UUID, Ingredient> ingredients,
                                 Map<UUID, ItemCategoryService.CategoryDefaults> defaultsByCategory) {

        BigDecimal capFor(UUID ingredientId) {
            Ingredient ingredient = ingredients.get(ingredientId);
            if (ingredient == null || ingredient.getCategoryId() == null) {
                return null;
            }
            ItemCategoryService.CategoryDefaults defaults = defaultsByCategory.get(ingredient.getCategoryId());
            return defaults == null ? null : defaults.varianceCapPct();
        }

        String nameFor(UUID ingredientId) {
            Ingredient ingredient = ingredients.get(ingredientId);
            return ingredient == null ? ingredientId.toString() : ingredient.getName();
        }
    }

    private static String trimToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static long roundCostPaisa(BigDecimal varianceQty, long avgCostPaisa) {
        return varianceQty.multiply(BigDecimal.valueOf(avgCostPaisa))
                .setScale(0, RoundingMode.HALF_UP)
                .longValueExact();
    }

    private static IngredientBranchStock newStockRow(UUID tenantId, UUID branchId, UUID ingredientId) {
        IngredientBranchStock stock = new IngredientBranchStock();
        stock.setTenantId(tenantId);
        stock.setBranchId(branchId);
        stock.setIngredientId(ingredientId);
        stock.setQtyOnHand(BigDecimal.ZERO);
        stock.setAvgCostPaisa(0L);
        return stock;
    }

    private static StockCountDto toDto(StockCount count, List<StockCountLine> lines, long totalVarianceCostPaisa) {
        List<CountLineDto> lineDtos = lines.stream()
                .map(l -> new CountLineDto(l.getIngredientId(), l.getSystemQty(), l.getCountedQty(),
                        l.getVarianceQty(), l.getVarianceCostPaisa(),
                        l.getVariancePct(), l.getCapPct(), l.getOverrideReason()))
                .toList();
        return new StockCountDto(count.getId(), count.getBranchId(), count.getStatus(), lineDtos,
                totalVarianceCostPaisa);
    }
}
