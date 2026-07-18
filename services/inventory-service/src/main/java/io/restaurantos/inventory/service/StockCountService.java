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
import io.restaurantos.inventory.event.InventoryEventPayloads;
import io.restaurantos.inventory.event.InventoryEventPayloads.CountVarianceLine;
import io.restaurantos.inventory.event.InventoryEventPayloads.CountVariancePostedPayload;
import io.restaurantos.inventory.event.InventoryEventPayloads.LowStockAlertPayload;
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

    private final StockCountRepository stockCountRepository;
    private final StockCountLineRepository stockCountLineRepository;
    private final IngredientBranchStockRepository stockRepository;
    private final InventoryMovementRepository movementRepository;
    private final IngredientRepository ingredientRepository;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;

    public StockCountService(StockCountRepository stockCountRepository,
                              StockCountLineRepository stockCountLineRepository,
                              IngredientBranchStockRepository stockRepository,
                              InventoryMovementRepository movementRepository,
                              IngredientRepository ingredientRepository,
                              EventPublisher eventPublisher,
                              TenantContext tenantContext) {
        this.stockCountRepository = stockCountRepository;
        this.stockCountLineRepository = stockCountLineRepository;
        this.stockRepository = stockRepository;
        this.movementRepository = movementRepository;
        this.ingredientRepository = ingredientRepository;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
    }

    @Transactional
    public StockCountDto postCount(CreateStockCountRequest request) {
        UUID tenantId = tenantContext.requireTenantId();

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

        for (CountLineRequest line : sortedLines) {
            IngredientBranchStock stock = stockRepository
                    .findForUpdate(tenantId, request.branchId(), line.ingredientId())
                    .orElseGet(() -> stockRepository.save(
                            newStockRow(tenantId, request.branchId(), line.ingredientId())));

            BigDecimal systemQty = stock.getQtyOnHand();
            BigDecimal varianceQty = line.countedQty().subtract(systemQty);
            long varianceCostPaisa = roundCostPaisa(varianceQty, stock.getAvgCostPaisa());

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
            savedLines.add(stockCountLineRepository.save(countLine));

            // Reorder-point breach -> LOW_STOCK_ALERT (extracted helper — same semantics as
            // DepletionService's Step 7, reused here so every stock-mutating flow queues the alert
            // identically).
            publishLowStockAlertIfBreached(savedStock, request.branchId());

            eventLines.add(new CountVarianceLine(line.ingredientId(), varianceQty, varianceCostPaisa));
            totalVarianceCostPaisa += varianceCostPaisa;
        }

        savedCount.setStatus("POSTED");
        savedCount.setPostedAt(Instant.now());
        StockCount finalCount = stockCountRepository.save(savedCount);

        // Last statement: publish COUNT_VARIANCE_POSTED through the transactional outbox — never
        // before/outside the count mutation (mirrors DepletionService/TransferService's shape).
        eventPublisher.publish(
                InventoryRabbitConfig.INVENTORY_TOPIC_EXCHANGE,
                InventoryEventPayloads.COUNT_VARIANCE_POSTED_ROUTING_KEY,
                InventoryEventPayloads.COUNT_VARIANCE_POSTED,
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
                    InventoryEventPayloads.LOW_STOCK_ALERT_ROUTING_KEY,
                    InventoryEventPayloads.LOW_STOCK_ALERT,
                    branchId,
                    new LowStockAlertPayload(stock.getIngredientId(), branchId, stock.getQtyOnHand(),
                            ingredient.get().getReorderPoint()));
        }
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
                        l.getVarianceQty(), l.getVarianceCostPaisa()))
                .toList();
        return new StockCountDto(count.getId(), count.getBranchId(), count.getStatus(), lineDtos,
                totalVarianceCostPaisa);
    }
}
