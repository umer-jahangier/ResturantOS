package io.restaurantos.inventory.service;

import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import io.restaurantos.inventory.domain.model.InventoryMovement;
import io.restaurantos.inventory.domain.model.StockLot;
import io.restaurantos.inventory.dto.InventoryDtos.RecordOpeningBalanceRequest;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.InventoryMovementRepository;
import io.restaurantos.inventory.repository.StockLotRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.UUID;

/**
 * Records the opening on-hand quantity + unit cost for an ingredient at a branch (INV-07, D-02/D-04).
 * Sets {@code ingredient_branch_stock.qty_on_hand}/{@code avg_cost_paisa} via {@link MacCalculator},
 * seeds a {@code stock_lots} row so FEFO has physical inventory to walk, and writes a single
 * {@code OPENING_BALANCE} row to {@code inventory_movements}. No event is published for opening
 * balance — internal movement only (08-CONTEXT.md).
 */
@Service
public class OpeningBalanceService {

    private final IngredientBranchStockRepository stockRepository;
    private final StockLotRepository lotRepository;
    private final InventoryMovementRepository movementRepository;
    private final TenantContext tenantContext;

    public OpeningBalanceService(IngredientBranchStockRepository stockRepository,
                                  StockLotRepository lotRepository,
                                  InventoryMovementRepository movementRepository,
                                  TenantContext tenantContext) {
        this.stockRepository = stockRepository;
        this.lotRepository = lotRepository;
        this.movementRepository = movementRepository;
        this.tenantContext = tenantContext;
    }

    @Transactional
    public void recordOpeningBalance(RecordOpeningBalanceRequest request) {
        UUID tenantId = tenantContext.requireTenantId();

        IngredientBranchStock stock = stockRepository
                .findForUpdate(tenantId, request.branchId(), request.ingredientId())
                .orElseGet(() -> newStockRow(tenantId, request.branchId(), request.ingredientId()));

        BigDecimal existingQty = stock.getQtyOnHand();
        long newAvgCostPaisa = MacCalculator.recomputeAvgCostPaisa(
                existingQty, stock.getAvgCostPaisa(), request.qty(), request.unitCostPaisa());

        stock.setQtyOnHand(existingQty.add(request.qty()));
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
        lotRepository.save(lot);

        long totalCostPaisa = request.qty()
                .multiply(BigDecimal.valueOf(request.unitCostPaisa()))
                .setScale(0, RoundingMode.HALF_UP)
                .longValueExact();

        InventoryMovement movement = new InventoryMovement();
        movement.setTenantId(tenantId);
        movement.setBranchId(request.branchId());
        movement.setIngredientId(request.ingredientId());
        movement.setMovementType("OPENING_BALANCE");
        movement.setQty(request.qty());
        movement.setUnitCostPaisa(request.unitCostPaisa());
        movement.setTotalCostPaisa(totalCostPaisa);
        movement.setReferenceType("OPENING_BALANCE");
        movementRepository.save(movement);
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
