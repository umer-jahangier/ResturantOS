package io.restaurantos.inventory;

import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import io.restaurantos.inventory.domain.model.StockLot;
import io.restaurantos.inventory.domain.model.UnitOfMeasure;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.StockLotRepository;
import io.restaurantos.inventory.repository.UnitOfMeasureRepository;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Reusable domain-row seed helpers for every downstream Phase-8 feature IT (depletion, receipts,
 * transfers, counts). Entity-dependent (unlike {@link TestFixtures}), so it lives alongside the
 * domain model rather than in the entity-independent harness.
 *
 * <p>Callers must have already activated a {@link io.restaurantos.shared.tenant.TenantContext}
 * for the seeding tenant/branch (e.g. via {@code TestFixtures.activateTenantContext}) — the
 * repositories saved here go through {@code TenantAwareDataSource}, which reads the GUC from the
 * active TenantContext on connection checkout. {@code tenantId} is still set explicitly on each
 * entity because it is never auto-populated by an entity listener (mirrors every controller in
 * this repo, e.g. {@code KdsController.getStations}'s manual {@code setTenantId(...)}).
 */
public final class InventoryFixtures {

    private InventoryFixtures() {}

    public static UnitOfMeasure seedUom(UnitOfMeasureRepository repository, UUID tenantId,
                                         String code, String name, BigDecimal toBaseFactor) {
        UnitOfMeasure uom = new UnitOfMeasure();
        uom.setTenantId(tenantId);
        uom.setCode(code);
        uom.setName(name);
        uom.setToBaseFactor(toBaseFactor);
        return repository.save(uom);
    }

    public static Ingredient seedIngredient(IngredientRepository repository, UUID tenantId,
                                             String name, String sku, String baseUomCode,
                                             BigDecimal reorderPoint) {
        Ingredient ingredient = new Ingredient();
        ingredient.setTenantId(tenantId);
        ingredient.setName(name);
        ingredient.setSku(sku);
        ingredient.setBaseUomCode(baseUomCode);
        ingredient.setReorderPoint(reorderPoint);
        ingredient.setActive(true);
        return repository.save(ingredient);
    }

    public static IngredientBranchStock seedStock(IngredientBranchStockRepository repository,
                                                   UUID tenantId, UUID branchId, UUID ingredientId,
                                                   BigDecimal qtyOnHand, long avgCostPaisa) {
        IngredientBranchStock stock = new IngredientBranchStock();
        stock.setTenantId(tenantId);
        stock.setBranchId(branchId);
        stock.setIngredientId(ingredientId);
        stock.setQtyOnHand(qtyOnHand);
        stock.setAvgCostPaisa(avgCostPaisa);
        return repository.save(stock);
    }

    public static StockLot seedLot(StockLotRepository repository, UUID tenantId, UUID branchId,
                                    UUID ingredientId, UUID stockId, BigDecimal qty,
                                    LocalDate expiryDate, long receiptUnitCostPaisa) {
        StockLot lot = new StockLot();
        lot.setTenantId(tenantId);
        lot.setBranchId(branchId);
        lot.setIngredientId(ingredientId);
        lot.setStockId(stockId);
        lot.setQty(qty);
        lot.setExpiryDate(expiryDate);
        lot.setReceiptUnitCostPaisa(receiptUnitCostPaisa);
        return repository.save(lot);
    }
}
