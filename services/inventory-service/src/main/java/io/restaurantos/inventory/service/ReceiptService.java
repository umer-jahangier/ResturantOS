package io.restaurantos.inventory.service;

import io.restaurantos.inventory.config.InventoryRabbitConfig;
import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import io.restaurantos.inventory.domain.model.InventoryMovement;
import io.restaurantos.inventory.domain.model.StockLot;
import io.restaurantos.inventory.dto.ReceiptDtos.ReceiptResultDto;
import io.restaurantos.inventory.dto.ReceiptDtos.ReceiveStockRequest;
import io.restaurantos.inventory.event.InventoryEventPayloads;
import io.restaurantos.inventory.event.InventoryEventPayloads.StockReceivedPayload;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.InventoryMovementRepository;
import io.restaurantos.inventory.repository.StockLotRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.UUID;

/**
 * Stock receipts (INV-04) — the counterpart to {@link DepletionService}'s depletion algorithm.
 * {@link #receive} locks the stock row ({@code findForUpdate}), recomputes {@code avg_cost_paisa}
 * via {@link MacCalculator} (HALF_UP, D-02 oversell-reset policy), increases {@code qty_on_hand},
 * creates a FEFO {@code StockLot} (expiry + receipt cost), writes a {@code RECEIPT}
 * {@code inventory_movements} row, and publishes {@code STOCK_RECEIVED} through the transactional
 * outbox as the LAST statement of the transaction — mirrors {@code DepletionService}/
 * {@code OpeningBalanceService}'s exact transactional shape (08-PATTERNS.md).
 */
@Service
public class ReceiptService {

    private final IngredientBranchStockRepository stockRepository;
    private final StockLotRepository lotRepository;
    private final InventoryMovementRepository movementRepository;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;

    public ReceiptService(IngredientBranchStockRepository stockRepository,
                           StockLotRepository lotRepository,
                           InventoryMovementRepository movementRepository,
                           EventPublisher eventPublisher,
                           TenantContext tenantContext) {
        this.stockRepository = stockRepository;
        this.lotRepository = lotRepository;
        this.movementRepository = movementRepository;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
    }

    @Transactional
    public ReceiptResultDto receive(ReceiveStockRequest request) {
        UUID tenantId = tenantContext.requireTenantId();

        IngredientBranchStock stock = stockRepository
                .findForUpdate(tenantId, request.branchId(), request.ingredientId())
                .orElseGet(() -> newStockRow(tenantId, request.branchId(), request.ingredientId()));

        BigDecimal oldQty = stock.getQtyOnHand();
        long newAvgCostPaisa = MacCalculator.recomputeAvgCostPaisa(
                oldQty, stock.getAvgCostPaisa(), request.qty(), request.unitCostPaisa());

        stock.setQtyOnHand(oldQty.add(request.qty()));
        stock.setAvgCostPaisa(newAvgCostPaisa);
        IngredientBranchStock savedStock = stockRepository.save(stock);

        StockLot lot = new StockLot();
        lot.setTenantId(tenantId);
        lot.setBranchId(request.branchId());
        lot.setIngredientId(request.ingredientId());
        lot.setStockId(savedStock.getId());
        lot.setQty(request.qty());
        lot.setExpiryDate(request.expiryDate());
        lot.setReceiptUnitCostPaisa(request.unitCostPaisa());
        StockLot savedLot = lotRepository.save(lot);

        long totalCostPaisa = request.qty()
                .multiply(BigDecimal.valueOf(request.unitCostPaisa()))
                .setScale(0, RoundingMode.HALF_UP)
                .longValueExact();

        InventoryMovement movement = new InventoryMovement();
        movement.setTenantId(tenantId);
        movement.setBranchId(request.branchId());
        movement.setIngredientId(request.ingredientId());
        movement.setMovementType("RECEIPT");
        movement.setQty(request.qty());
        movement.setUnitCostPaisa(request.unitCostPaisa());
        movement.setTotalCostPaisa(totalCostPaisa);
        movement.setReferenceType("RECEIPT");
        movement.setReferenceId(savedLot.getId());
        movementRepository.save(movement);

        // Last statement: publish STOCK_RECEIVED through the transactional outbox, never
        // before/outside the stock mutation (mirrors DepletionService's Step 8).
        eventPublisher.publish(
                InventoryRabbitConfig.INVENTORY_TOPIC_EXCHANGE,
                InventoryEventPayloads.STOCK_RECEIVED_ROUTING_KEY,
                InventoryEventPayloads.STOCK_RECEIVED,
                request.branchId(),
                new StockReceivedPayload(request.ingredientId(), request.branchId(), request.qty(),
                        request.unitCostPaisa(), newAvgCostPaisa, savedLot.getId(), request.expiryDate()));

        return new ReceiptResultDto(savedLot.getId(), savedStock.getQtyOnHand(), newAvgCostPaisa);
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
