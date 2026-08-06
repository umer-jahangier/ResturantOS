package io.restaurantos.inventory.service;

import io.restaurantos.inventory.config.InventoryRabbitConfig;
import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import io.restaurantos.inventory.domain.model.InventoryMovement;
import io.restaurantos.inventory.domain.model.StockWastage;
import io.restaurantos.inventory.domain.model.StockWastageLine;
import io.restaurantos.inventory.dto.WastageDtos.RecordWastageRequest;
import io.restaurantos.inventory.dto.WastageDtos.WastageDto;
import io.restaurantos.inventory.dto.WastageDtos.WastageLineDto;
import io.restaurantos.inventory.dto.WastageDtos.WastageLineRequest;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.InventoryMovementRepository;
import io.restaurantos.inventory.repository.StockWastageLineRepository;
import io.restaurantos.inventory.repository.StockWastageRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.event.payload.InventoryEventContract;
import io.restaurantos.shared.event.payload.InventoryEventContract.WastageRecordedPayload;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

/**
 * Writing stock off — spoilage, breakage, expiry, staff meals, customer returns.
 *
 * <p><b>Why this class did not exist.</b> finance-service has carried a WASTAGE_RECORDED consumer,
 * a bound queue and a DLQ since Phase 9, and nothing in the fleet has ever published that event:
 * inventory declared the event-type constant and routing key and never called {@code publish} for
 * them. So account 5220 "Waste &amp; Spoilage" could not receive a single entry, and food-cost
 * percentage was systematically understated by every gram thrown away.
 *
 * <p>Follows the same write shape as {@link StockCountService}: a header + lines, sorted
 * pessimistic locks (Pitfall 6), a signed {@code WASTAGE} movement per line, and ONE event through
 * the transactional outbox as the last statement.
 *
 * <p>Valued at the aggregate moving-average cost, never a lot's own receipt price — the same rule
 * depletion follows, so a kilo thrown away and a kilo sold hit the P&amp;L at the same number.
 */
@Service
public class WastageService {

    private final StockWastageRepository wastageRepository;
    private final StockWastageLineRepository wastageLineRepository;
    private final IngredientBranchStockRepository stockRepository;
    private final InventoryMovementRepository movementRepository;
    private final TenantRegistryService tenantRegistryService;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;

    public WastageService(StockWastageRepository wastageRepository,
                          StockWastageLineRepository wastageLineRepository,
                          IngredientBranchStockRepository stockRepository,
                          InventoryMovementRepository movementRepository,
                          TenantRegistryService tenantRegistryService,
                          EventPublisher eventPublisher,
                          TenantContext tenantContext) {
        this.wastageRepository = wastageRepository;
        this.wastageLineRepository = wastageLineRepository;
        this.stockRepository = stockRepository;
        this.movementRepository = movementRepository;
        this.tenantRegistryService = tenantRegistryService;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
    }

    @Transactional
    public WastageDto record(RecordWastageRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        tenantRegistryService.registerTenant(tenantId);

        StockWastage wastage = new StockWastage();
        wastage.setTenantId(tenantId);
        wastage.setBranchId(request.branchId());
        wastage.setReason(request.reason());
        wastage.setNotes(request.notes());
        wastage.setRecordedAt(Instant.now());
        StockWastage savedWastage = wastageRepository.save(wastage);

        // Sorted-lock deadlock avoidance (Pitfall 6) — lock the ingredient set in natural UUID
        // order, never in per-line encounter order.
        List<WastageLineRequest> sortedLines = new ArrayList<>(request.lines());
        sortedLines.sort(Comparator.comparing(WastageLineRequest::ingredientId));

        List<StockWastageLine> savedLines = new ArrayList<>();
        long totalCostPaisa = 0L;

        for (WastageLineRequest line : sortedLines) {
            IngredientBranchStock stock = stockRepository
                    .findForUpdate(tenantId, request.branchId(), line.ingredientId())
                    .orElseGet(() -> stockRepository.save(
                            newStockRow(tenantId, request.branchId(), line.ingredientId())));

            BigDecimal unitCostPaisa = stock.getAvgCostPaisa();
            long lineCostPaisa = roundCostPaisa(line.qty(), unitCostPaisa);

            // Aggregate qty may go negative on an over-write-off, exactly as depletion allows on
            // oversell (D-02): the physical truth is that the stock is gone either way, and a
            // floor here would silently under-report the loss.
            stock.setQtyOnHand(stock.getQtyOnHand().subtract(line.qty()));
            IngredientBranchStock savedStock = stockRepository.save(stock);

            InventoryMovement movement = new InventoryMovement();
            movement.setTenantId(tenantId);
            movement.setBranchId(request.branchId());
            movement.setIngredientId(line.ingredientId());
            movement.setMovementType("WASTAGE");
            movement.setQty(line.qty().negate());
            movement.setUnitCostPaisa(unitCostPaisa);
            movement.setTotalCostPaisa(lineCostPaisa);
            movement.setReferenceType("WASTAGE");
            movement.setReferenceId(savedWastage.getId());
            movementRepository.save(movement);

            StockWastageLine wastageLine = new StockWastageLine();
            wastageLine.setTenantId(tenantId);
            wastageLine.setWastageId(savedWastage.getId());
            wastageLine.setIngredientId(line.ingredientId());
            wastageLine.setQty(line.qty());
            wastageLine.setUnitCostPaisa(unitCostPaisa);
            wastageLine.setLineCostPaisa(lineCostPaisa);
            savedLines.add(wastageLineRepository.save(wastageLine));

            totalCostPaisa += lineCostPaisa;
            // Deliberately no LOW_STOCK_ALERT here: a write-off is not a consumption signal, and
            // alerting a manager to reorder the thing they just threw away reads as a bug.
            if (savedStock.getQtyOnHand() == null) {
                throw new IllegalStateException("stock row lost its quantity");
            }
        }

        savedWastage.setTotalCostPaisa(totalCostPaisa);
        StockWastage finalWastage = wastageRepository.save(savedWastage);

        // Last statement: ONE event for the whole write-off, through the transactional outbox.
        // Keyed on the header id — finance's WASTAGE recipe dedupes on `wastageId`, which the
        // placeholder payload (keyed on ingredientId) could never have supplied.
        eventPublisher.publish(
                InventoryRabbitConfig.INVENTORY_TOPIC_EXCHANGE,
                InventoryEventContract.WASTAGE_RECORDED_KEY,
                InventoryEventContract.WASTAGE_RECORDED,
                request.branchId(),
                new WastageRecordedPayload(
                        finalWastage.getId(),
                        // The event carries the FIRST line's ingredient for single-line write-offs
                        // (the common case) and null for multi-line ones; the ledger posts one
                        // aggregate entry either way, and the per-ingredient detail lives in
                        // inventory_movements.
                        savedLines.size() == 1 ? savedLines.get(0).getIngredientId() : null,
                        request.branchId(),
                        savedLines.stream().map(StockWastageLine::getQty)
                                .reduce(BigDecimal.ZERO, BigDecimal::add),
                        totalCostPaisa,
                        request.reason()));

        return toDto(finalWastage, savedLines);
    }

    @Transactional(readOnly = true)
    public List<WastageDto> list(UUID branchId) {
        UUID tenantId = tenantContext.requireTenantId();
        return wastageRepository.findByTenantIdAndBranchIdOrderByRecordedAtDesc(tenantId, branchId)
                .stream()
                .map(w -> toDto(w, wastageLineRepository.findByWastageId(w.getId())))
                .toList();
    }

    private static WastageDto toDto(StockWastage wastage, List<StockWastageLine> lines) {
        return new WastageDto(
                wastage.getId(),
                wastage.getBranchId(),
                wastage.getReason(),
                wastage.getNotes(),
                wastage.getRecordedAt(),
                lines.stream()
                        .map(l -> new WastageLineDto(
                                l.getIngredientId(), l.getQty(), l.getUnitCostPaisa(), l.getLineCostPaisa()))
                        .toList(),
                wastage.getTotalCostPaisa());
    }

    private static IngredientBranchStock newStockRow(UUID tenantId, UUID branchId, UUID ingredientId) {
        IngredientBranchStock stock = new IngredientBranchStock();
        stock.setTenantId(tenantId);
        stock.setBranchId(branchId);
        stock.setIngredientId(ingredientId);
        stock.setQtyOnHand(BigDecimal.ZERO);
        stock.setAvgCostPaisa(BigDecimal.ZERO);
        return stock;
    }

    /** A quantity times a per-unit rate is an AMOUNT — whole paisa (V12). */
    private static long roundCostPaisa(BigDecimal qty, BigDecimal unitCostPaisa) {
        return MacCalculator.extendedCostPaisa(qty, unitCostPaisa);
    }
}
