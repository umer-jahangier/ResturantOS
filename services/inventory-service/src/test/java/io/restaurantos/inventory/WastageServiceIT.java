package io.restaurantos.inventory;

import io.restaurantos.inventory.dto.WastageDtos.RecordWastageRequest;
import io.restaurantos.inventory.dto.WastageDtos.WastageDto;
import io.restaurantos.inventory.dto.WastageDtos.WastageLineRequest;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.InventoryMovementRepository;
import io.restaurantos.inventory.repository.UnitOfMeasureRepository;
import io.restaurantos.inventory.service.WastageService;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.event.payload.InventoryEventContract;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Wastage: the producer half of a seam finance has had a consumer for since Phase 9.
 *
 * <p>finance-service has carried a WASTAGE_RECORDED consumer, a bound queue and a DLQ all along,
 * and nothing in the fleet ever published that event — inventory declared the event-type constant
 * and routing key and never called {@code publish} for them. So account 5220 "Waste &amp; Spoilage"
 * could not receive a single entry, and food-cost percentage was understated by everything thrown
 * away.
 */
class WastageServiceIT extends InventoryTestBase {

    @Autowired TenantContext tenantContext;
    @Autowired WastageService wastageService;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired UnitOfMeasureRepository unitOfMeasureRepository;
    @Autowired IngredientBranchStockRepository stockRepository;
    @Autowired InventoryMovementRepository movementRepository;
    @Autowired OutboxRepository outboxRepository;

    UUID tenantId;
    UUID branchId;
    UUID ingredientId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);

        InventoryFixtures.seedUom(unitOfMeasureRepository, tenantId, "KG", "Kilogram", BigDecimal.ONE);
        ingredientId = InventoryFixtures.seedIngredient(
                ingredientRepository, tenantId, "Chicken", "CHK-W", "KG", new BigDecimal("5")).getId();
        InventoryFixtures.seedStock(stockRepository, tenantId, branchId, ingredientId,
                new BigDecimal("100"), 5_000L);
        outboxRepository.deleteAll();
    }

    @Test
    void recordingWastage_dropsStock_writesASignedMovement_andPublishesWithAWastageId() {
        WastageDto result = wastageService.record(new RecordWastageRequest(
                branchId, "SPOILAGE", "walk-in failed overnight",
                List.of(new WastageLineRequest(ingredientId, new BigDecimal("10")))));

        // Valued at the aggregate moving-average cost — the same rule depletion follows, so a kilo
        // thrown away and a kilo sold hit the P&L at the same number.
        assertThat(result.totalCostPaisa()).isEqualTo(50_000L);
        assertThat(result.lines()).singleElement()
                .satisfies(l -> assertThat(l.unitCostPaisa()).isEqualByComparingTo("5000"));

        assertThat(stockRepository.findByBranchIdAndIngredientId(branchId, ingredientId)
                .orElseThrow().getQtyOnHand())
                .isEqualByComparingTo("90");

        assertThat(movementRepository.findByReferenceId(result.wastageId()))
                .singleElement()
                .satisfies(m -> {
                    assertThat(m.getMovementType()).isEqualTo("WASTAGE");
                    // Signed negative: stock left the building.
                    assertThat(m.getQty()).isEqualByComparingTo("-10");
                    assertThat(m.getTotalCostPaisa()).isEqualTo(50_000L);
                });

        // The event finance has been waiting for, carrying the wastageId its recipe dedupes on —
        // the field the old placeholder payload (keyed on ingredientId) could never have supplied.
        assertThat(outboxRepository.findAll())
                .filteredOn(e -> InventoryEventContract.WASTAGE_RECORDED.equals(e.getEventType())
                        && tenantId.equals(e.getTenantId()))
                .singleElement()
                .satisfies(e -> assertThat(e.getEnvelopeJson())
                        .contains(result.wastageId().toString())
                        .contains("\"costPaisa\":50000"));
    }

    @Test
    void multiLineWastage_sumsToOneTotal_andPublishesOneEvent() {
        UUID second = InventoryFixtures.seedIngredient(
                ingredientRepository, tenantId, "Rice", "RICE-W", "KG", new BigDecimal("5")).getId();
        InventoryFixtures.seedStock(stockRepository, tenantId, branchId, second,
                new BigDecimal("50"), 2_000L);

        WastageDto result = wastageService.record(new RecordWastageRequest(
                branchId, "EXPIRY", null,
                List.of(new WastageLineRequest(ingredientId, new BigDecimal("2")),
                        new WastageLineRequest(second, new BigDecimal("3")))));

        assertThat(result.totalCostPaisa()).isEqualTo(2 * 5_000L + 3 * 2_000L);
        assertThat(result.lines()).hasSize(2);

        // ONE event for the whole write-off — the per-ingredient detail lives in inventory_movements.
        assertThat(outboxRepository.findAll())
                .filteredOn(e -> InventoryEventContract.WASTAGE_RECORDED.equals(e.getEventType())
                        && tenantId.equals(e.getTenantId()))
                .hasSize(1);
    }

    /**
     * Writing off more than is on hand drives the aggregate negative, exactly as oversell does on
     * depletion (D-02). The physical truth is that the stock is gone either way, and flooring here
     * would silently under-report the loss.
     */
    @Test
    void writingOffMoreThanOnHand_goesNegativeRatherThanUnderReporting() {
        WastageDto result = wastageService.record(new RecordWastageRequest(
                branchId, "BREAKAGE", null,
                List.of(new WastageLineRequest(ingredientId, new BigDecimal("150")))));

        assertThat(result.totalCostPaisa()).isEqualTo(750_000L);
        assertThat(stockRepository.findByBranchIdAndIngredientId(branchId, ingredientId)
                .orElseThrow().getQtyOnHand())
                .isEqualByComparingTo("-50");
    }

    /** A write-off is not a consumption signal — alerting a reorder for what was just binned is noise. */
    @Test
    void wastage_doesNotRaiseALowStockAlert() {
        wastageService.record(new RecordWastageRequest(
                branchId, "SPOILAGE", null,
                List.of(new WastageLineRequest(ingredientId, new BigDecimal("99")))));

        assertThat(outboxRepository.findAll())
                .filteredOn(e -> InventoryEventContract.LOW_STOCK_ALERT.equals(e.getEventType())
                        && tenantId.equals(e.getTenantId()))
                .isEmpty();
    }

    @Test
    void listReturnsTheWriteOffsForABranch() {
        wastageService.record(new RecordWastageRequest(branchId, "SPOILAGE", null,
                List.of(new WastageLineRequest(ingredientId, new BigDecimal("1")))));
        wastageService.record(new RecordWastageRequest(branchId, "STAFF_MEAL", null,
                List.of(new WastageLineRequest(ingredientId, new BigDecimal("2")))));

        assertThat(wastageService.list(branchId)).hasSize(2)
                .allSatisfy(w -> assertThat(w.lines()).isNotEmpty());
    }
}
