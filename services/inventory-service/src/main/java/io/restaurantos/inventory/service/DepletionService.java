package io.restaurantos.inventory.service;

import io.restaurantos.inventory.config.InventoryRabbitConfig;
import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import io.restaurantos.inventory.domain.model.InventoryMovement;
import io.restaurantos.inventory.domain.model.Recipe;
import io.restaurantos.inventory.domain.model.RecipeLine;
import io.restaurantos.inventory.domain.model.StockLot;
import io.restaurantos.inventory.domain.model.UnitOfMeasure;
import io.restaurantos.inventory.event.InventoryEventPayloads;
import io.restaurantos.inventory.event.InventoryEventPayloads.DepletedLine;
import io.restaurantos.inventory.event.InventoryEventPayloads.ItemEntry;
import io.restaurantos.inventory.event.InventoryEventPayloads.LowStockAlertPayload;
import io.restaurantos.inventory.event.InventoryEventPayloads.OrderClosedPayload;
import io.restaurantos.inventory.event.InventoryEventPayloads.StockDepletedPayload;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.InventoryMovementRepository;
import io.restaurantos.inventory.repository.RecipeLineRepository;
import io.restaurantos.inventory.repository.StockLotRepository;
import io.restaurantos.inventory.repository.UnitOfMeasureRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeSet;
import java.util.UUID;

/**
 * The ORDER_CLOSED depletion consumer's domain service (INV-03 — the correctness crux of
 * Phase 8): resolves the effective recipe version at the order's {@code closedAt} (D-01), converts
 * each recipe line to base quantity (M2.4 {@code effective_base_qty}), locks the distinct touched
 * ingredients in a deterministic sorted order (Pitfall 6 — deadlock avoidance), walks each
 * ingredient's lots FEFO while flooring every lot at zero (D-02), decrements the AGGREGATE
 * {@code qty_on_hand} by the full required quantity even when lots are insufficient (oversell is
 * allowed to go negative), values COGS at the aggregate moving-average cost — never a lot's own
 * receipt cost (D-04 / Pitfall 9) — writes a DEPLETION movement per ingredient, queues
 * {@code LOW_STOCK_ALERT} on reorder-point breach, and publishes {@code STOCK_DEPLETED} through the
 * transactional outbox as the last statement of the same transaction.
 */
@Service
public class DepletionService {

    private static final Logger log = LoggerFactory.getLogger(DepletionService.class);

    private final RecipeService recipeService;
    private final RecipeLineRepository recipeLineRepository;
    private final UnitOfMeasureRepository unitOfMeasureRepository;
    private final IngredientBranchStockRepository stockRepository;
    private final StockLotRepository lotRepository;
    private final InventoryMovementRepository movementRepository;
    private final IngredientRepository ingredientRepository;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;

    public DepletionService(RecipeService recipeService,
                             RecipeLineRepository recipeLineRepository,
                             UnitOfMeasureRepository unitOfMeasureRepository,
                             IngredientBranchStockRepository stockRepository,
                             StockLotRepository lotRepository,
                             InventoryMovementRepository movementRepository,
                             IngredientRepository ingredientRepository,
                             EventPublisher eventPublisher,
                             TenantContext tenantContext) {
        this.recipeService = recipeService;
        this.recipeLineRepository = recipeLineRepository;
        this.unitOfMeasureRepository = unitOfMeasureRepository;
        this.stockRepository = stockRepository;
        this.lotRepository = lotRepository;
        this.movementRepository = movementRepository;
        this.ingredientRepository = ingredientRepository;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
    }

    @Transactional
    public void deplete(UUID branchId, OrderClosedPayload payload) {
        UUID tenantId = tenantContext.requireTenantId();

        // Steps 1-2: resolve each item's effective recipe at closedAt (D-01), convert every line
        // to base qty (M2.4), and accumulate the required qty per ingredientId across every
        // resolved line (summing when several menu items/lines share an ingredient).
        Map<UUID, BigDecimal> requiredByIngredient = new HashMap<>();
        for (ItemEntry item : payload.items()) {
            Optional<Recipe> recipeOpt = recipeService.resolveEffectiveRecipe(item.menuItemId(), payload.closedAt());
            if (recipeOpt.isEmpty()) {
                // Claude's-Discretion (08-CONTEXT.md): missing recipe -> skip the line, no error.
                log.info("DepletionService: no effective recipe for menuItemId={} at closedAt={} — skipping line",
                        item.menuItemId(), payload.closedAt());
                continue;
            }
            Recipe recipe = recipeOpt.get();
            for (RecipeLine line : recipeLineRepository.findByRecipeId(recipe.getId())) {
                BigDecimal toBaseFactor = unitOfMeasureRepository.findByCode(line.getUomCode())
                        .map(UnitOfMeasure::getToBaseFactor)
                        .orElseThrow(() -> new IllegalStateException(
                                "Unknown UOM code on recipe line: " + line.getUomCode()));
                BigDecimal effectiveQty = UomConverter.effectiveBaseQty(
                        line, item.qty(), recipe.getYieldServings(), toBaseFactor);
                requiredByIngredient.merge(line.getIngredientId(), effectiveQty, BigDecimal::add);
            }
        }

        if (requiredByIngredient.isEmpty()) {
            log.info("DepletionService: orderId={} — no ingredients to deplete (no resolvable recipes)",
                    payload.orderId());
            return;
        }

        // Step 3: pre-sort the DISTINCT ingredientId set (natural UUID order) before locking —
        // never lock lazily in per-recipe-line encounter order (Pitfall 6 deadlock avoidance).
        List<UUID> sortedIngredientIds = new ArrayList<>(new TreeSet<>(requiredByIngredient.keySet()));

        List<DepletedLine> depletedLines = new ArrayList<>();
        long totalCogsPaisa = 0L;

        for (UUID ingredientId : sortedIngredientIds) {
            BigDecimal required = requiredByIngredient.get(ingredientId);

            // orElseGet SAVES immediately (not just constructs) so stock.getId() is populated before
            // the FEFO lot lookup below — an ingredient that was never opening-balanced/received yet
            // still depletes (and correctly goes negative, D-02) instead of throwing.
            IngredientBranchStock stock = stockRepository.findForUpdate(tenantId, branchId, ingredientId)
                    .orElseGet(() -> stockRepository.save(newStockRow(tenantId, branchId, ingredientId)));

            // Step 4: FEFO lot walk, flooring each lot at zero (D-02 + D-04 composed).
            walkFefoAndFloor(lotRepository.findByStockIdOrderByExpiryDateAsc(stock.getId()), required);

            // The AGGREGATE on-hand drops by the FULL required qty regardless of lot sufficiency —
            // oversell is allowed to drive qty_on_hand negative (D-02), even though no lot row ever
            // goes below zero individually.
            stock.setQtyOnHand(stock.getQtyOnHand().subtract(required));
            IngredientBranchStock savedStock = stockRepository.save(stock);

            // Step 5: COGS at the aggregate MAC — NEVER a lot's own receipt cost (D-04 / Pitfall 9).
            long cogsPaisa = computeCogsPaisa(required, savedStock.getAvgCostPaisa());

            // Step 6: DEPLETION movement (signed-negative qty).
            InventoryMovement movement = new InventoryMovement();
            movement.setTenantId(tenantId);
            movement.setBranchId(branchId);
            movement.setIngredientId(ingredientId);
            movement.setMovementType("DEPLETION");
            movement.setQty(required.negate());
            movement.setUnitCostPaisa(savedStock.getAvgCostPaisa());
            movement.setTotalCostPaisa(cogsPaisa);
            movement.setReferenceType("ORDER_CLOSED");
            movement.setReferenceId(payload.orderId());
            movementRepository.save(movement);

            // Step 7: reorder-point breach -> LOW_STOCK_ALERT.
            Optional<Ingredient> ingredient = ingredientRepository.findById(ingredientId);
            if (ingredient.isPresent()
                    && savedStock.getQtyOnHand().compareTo(ingredient.get().getReorderPoint()) <= 0) {
                eventPublisher.publish(
                        InventoryRabbitConfig.INVENTORY_TOPIC_EXCHANGE,
                        InventoryEventPayloads.LOW_STOCK_ALERT_ROUTING_KEY,
                        InventoryEventPayloads.LOW_STOCK_ALERT,
                        branchId,
                        new LowStockAlertPayload(ingredientId, branchId, savedStock.getQtyOnHand(),
                                ingredient.get().getReorderPoint()));
            }

            depletedLines.add(new DepletedLine(ingredientId, required, cogsPaisa));
            totalCogsPaisa += cogsPaisa;
        }

        // Step 8: publish STOCK_DEPLETED through the transactional outbox — the LAST statement in
        // this transaction (never before/outside the depletion mutation). eventId is generated
        // fresh inside DomainEventPublisher.publish; never copied from the inbound envelope.
        eventPublisher.publish(
                InventoryRabbitConfig.INVENTORY_TOPIC_EXCHANGE,
                InventoryEventPayloads.STOCK_DEPLETED_ROUTING_KEY,
                InventoryEventPayloads.STOCK_DEPLETED,
                branchId,
                new StockDepletedPayload(payload.orderId(), depletedLines, totalCogsPaisa));
    }

    /**
     * FEFO lot walk (D-02 + D-04 composed): sorts the given lots oldest-expiry-first (NULL expiry
     * — non-perishable — sorts last, mirroring {@code StockLotRepository}'s default NULLS LAST
     * query ordering), then subtracts {@code min(lot.qty, remaining)} from each lot in turn,
     * flooring every lot at zero. Any unsatisfied {@code remaining} left over after the walk is
     * informational only — the caller always decrements the AGGREGATE {@code qty_on_hand} by the
     * FULL original {@code demand}, never by what the lots could actually supply.
     *
     * <p>Exposed {@code public static} so {@code FefoLotWalkTest} can drive it directly without a
     * Spring context or mocked repositories (mirrors {@link MacCalculator}'s test seam).
     */
    public static void walkFefoAndFloor(List<StockLot> lots, BigDecimal demand) {
        List<StockLot> ordered = lots.stream()
                .sorted(Comparator.comparing(StockLot::getExpiryDate, Comparator.nullsLast(Comparator.naturalOrder())))
                .toList();
        BigDecimal remaining = demand;
        for (StockLot lot : ordered) {
            if (remaining.signum() <= 0) {
                break;
            }
            BigDecimal take = lot.getQty().min(remaining);
            lot.setQty(lot.getQty().subtract(take));
            remaining = remaining.subtract(take);
        }
    }

    /**
     * COGS = {@code effectiveBaseQty x avg_cost_paisa} (the aggregate MAC), rounded HALF_UP —
     * mirrors {@code MoneyUtils.fromPkr}, never {@code MoneyUtils.taxPerLine}'s floored rounding.
     * Deliberately takes only the aggregate {@code avgCostPaisa}, never a lot, so it is structurally
     * impossible to re-derive COGS from a lot's own receipt cost field on {@code stock_lots} (Pitfall 9).
     *
     * <p>Exposed {@code public static} so {@code DepletionCogsTest} can drive it directly.
     */
    public static long computeCogsPaisa(BigDecimal effectiveBaseQty, long avgCostPaisa) {
        return effectiveBaseQty.multiply(BigDecimal.valueOf(avgCostPaisa))
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
}
