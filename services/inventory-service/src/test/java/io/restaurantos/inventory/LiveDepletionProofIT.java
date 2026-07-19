package io.restaurantos.inventory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.consumer.OrderClosedConsumer;
import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import io.restaurantos.inventory.domain.model.InventoryMovement;
import io.restaurantos.inventory.domain.model.StockLot;
import io.restaurantos.inventory.dto.RecipeDtos.CoverageResponse;
import io.restaurantos.inventory.dto.RecipeDtos.CreateRecipeVersionRequest;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeLineRequest;
import io.restaurantos.inventory.event.InventoryEventPayloads.ItemEntry;
import io.restaurantos.inventory.event.InventoryEventPayloads.MenuItemUpsertedPayload;
import io.restaurantos.inventory.event.InventoryEventPayloads.OrderClosedPayload;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.InventoryMovementRepository;
import io.restaurantos.inventory.repository.StockLotRepository;
import io.restaurantos.inventory.repository.UnitOfMeasureRepository;
import io.restaurantos.inventory.service.DepletionService;
import io.restaurantos.inventory.service.MenuItemCatalogService;
import io.restaurantos.inventory.service.RecipeService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 08.1-05 (INV-12 capstone proof): drives the FULL activated loop with real service components,
 * in production order — {@code MenuItemCatalogService.upsert} (simulating a consumed
 * MENU_ITEM_UPSERTED sync event, 08.1-02) -&gt; {@code RecipeService.createVersion} (the real
 * catalog-validated recipe-authoring path, NOT a direct {@code RecipeRepository.save} — unlike
 * {@link DepletionConsumerIT}, which pre-seeds a Recipe row directly and is intentionally left
 * unmodified) -&gt; {@code OrderClosedConsumer.onMessage} (the real {@code @RabbitListener} method,
 * NOT {@code DepletionService.deplete} called directly). Asserts FEFO depletion, a DEPLETION
 * {@code inventory_movements} row, and a {@code STOCK_DEPLETED} outbox payload whose
 * {@code totalCogsPaisa} is compared against a value this test computes INDEPENDENTLY via
 * {@link DepletionService#computeCogsPaisa} (T-085-02 / Pitfall 9 guard) — never "some decrease".
 * Finally closes the loop back to 08.1-03's {@code RecipeService.getCoverage()} report.
 */
class LiveDepletionProofIT extends InventoryTestBase {

    @Autowired TenantContext tenantContext;
    @Autowired MenuItemCatalogService menuItemCatalogService;
    @Autowired RecipeService recipeService;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired UnitOfMeasureRepository unitOfMeasureRepository;
    @Autowired IngredientBranchStockRepository stockRepository;
    @Autowired StockLotRepository lotRepository;
    @Autowired InventoryMovementRepository movementRepository;
    @Autowired OutboxRepository outboxRepository;
    @Autowired OrderClosedConsumer orderClosedConsumer;
    @Autowired @Qualifier("eventObjectMapper") ObjectMapper eventObjectMapper;

    private static final BigDecimal SEEDED_QTY_ON_HAND = BigDecimal.valueOf(50);
    private static final long SEEDED_AVG_COST_PAISA = 850L;
    private static final BigDecimal RECIPE_QTY_PER_SERVING = BigDecimal.valueOf(2); // base units/serving
    private static final int ORDER_QTY = 4;

    UUID tenantId;
    UUID branchId;
    UUID ingredientId;
    UUID stockId;

    @BeforeEach
    void setUp() {
        TestFixtures.TenantBranch tb = TestFixtures.newTenantBranch();
        tenantId = tb.tenantId();
        branchId = tb.branchId();
        TestFixtures.activateTenantContext(tenantContext, tenantId, branchId, null);

        InventoryFixtures.seedUom(unitOfMeasureRepository, tenantId, "UNIT", "Unit", BigDecimal.ONE);
        Ingredient ingredient = InventoryFixtures.seedIngredient(
                ingredientRepository, tenantId, "Chicken Breast", "SKU-CHICKEN", "UNIT", BigDecimal.ZERO);
        ingredientId = ingredient.getId();

        IngredientBranchStock stock = InventoryFixtures.seedStock(
                stockRepository, tenantId, branchId, ingredientId, SEEDED_QTY_ON_HAND, SEEDED_AVG_COST_PAISA);
        stockId = stock.getId();
        // receiptUnitCostPaisa (1200) deliberately differs from the seeded avg cost (850) — proves
        // COGS is valued at the aggregate MAC, never the lot's own receipt cost (D-04/Pitfall 9).
        InventoryFixtures.seedLot(lotRepository, tenantId, branchId, ingredientId, stockId,
                SEEDED_QTY_ON_HAND, null, 1200L);
    }

    @Test
    void catalogSyncedRecipeAuthoredAndRealConsumer_depletesFefoAndPublishesAggregateMacCogs() throws Exception {
        UUID menuItemId = UUID.randomUUID();

        // (1) Simulate the REAL consumed MENU_ITEM_UPSERTED sync event — the ONLY place a catalog
        // row is created (never a direct MenuItemCatalogRepository insert).
        menuItemCatalogService.upsert(new MenuItemUpsertedPayload(
                menuItemId, "Chicken Karahi", UUID.randomUUID(), "Mains", true, 45000L, Instant.now()));

        // (2) Author the recipe through the REAL catalog-validated RecipeService.createVersion —
        // must NOT throw, proving the 08.1-02 catalog validation passes for a properly-synced item.
        recipeService.createVersion(new CreateRecipeVersionRequest(
                menuItemId, BigDecimal.ONE, null, "Karahi Recipe",
                List.of(new RecipeLineRequest(ingredientId, RECIPE_QTY_PER_SERVING, "UNIT", BigDecimal.valueOf(100)))));

        // (3) Build a real ORDER_CLOSED payload and consume it through the REAL
        // OrderClosedConsumer.onMessage — never DepletionService.deplete called directly.
        UUID orderId = UUID.randomUUID();
        OrderClosedPayload payload = new OrderClosedPayload(
                orderId, "ORD-2001", "DINE_IN", null,
                4000L, 0L, 0L, 400L, 4400L,
                List.of(), List.of(new ItemEntry(menuItemId, "Chicken Karahi", ORDER_QTY, 1100L, 4400L)),
                null, null, Instant.now());
        Message message = buildMessage(UUID.randomUUID(), tenantId, branchId, payload);

        tenantContext.clear();
        orderClosedConsumer.onMessage(message);
        tenantContext.set(tenantId, branchId, null, null);

        // Independently-computed expected base qty mirroring UomConverter.effectiveBaseQty with
        // toBaseFactor=1, yieldPct=100% (fraction 1.0), recipe.yieldServings=1:
        // (2 * 1 * 4) / (1.0 * 1) = 8.0000 base units.
        BigDecimal expectedBaseQty = RECIPE_QTY_PER_SERVING
                .multiply(BigDecimal.valueOf(ORDER_QTY))
                .setScale(4, RoundingMode.HALF_UP);

        IngredientBranchStock stockAfter = stockRepository
                .findByBranchIdAndIngredientId(branchId, ingredientId).orElseThrow();
        assertThat(stockAfter.getQtyOnHand())
                .isEqualByComparingTo(SEEDED_QTY_ON_HAND.subtract(expectedBaseQty)); // 50 - 8 = 42

        // Single-lot case — FEFO trivially drains the whole demand from the one lot.
        StockLot lotAfter = lotRepository.findByStockIdOrderByExpiryDateAsc(stockId).get(0);
        assertThat(lotAfter.getQty())
                .isEqualByComparingTo(SEEDED_QTY_ON_HAND.subtract(expectedBaseQty));

        long expectedCogsPaisa = DepletionService.computeCogsPaisa(expectedBaseQty, SEEDED_AVG_COST_PAISA);

        List<InventoryMovement> movements = movementRepository.findByReferenceId(orderId);
        assertThat(movements).hasSize(1);
        InventoryMovement movement = movements.get(0);
        assertThat(movement.getMovementType()).isEqualTo("DEPLETION");
        assertThat(movement.getReferenceType()).isEqualTo("ORDER_CLOSED");
        assertThat(movement.getReferenceId()).isEqualTo(orderId);
        assertThat(movement.getQty()).isEqualByComparingTo(expectedBaseQty.negate());
        assertThat(movement.getUnitCostPaisa()).isEqualTo(SEEDED_AVG_COST_PAISA);
        assertThat(movement.getTotalCostPaisa()).isEqualTo(expectedCogsPaisa);

        // Query ALL outbox rows (not filtered by status="PENDING") — the live OutboxRelay may have
        // already flipped this row's status to "SENT" via the mocked RabbitTemplate by the time
        // this assertion runs (mirrors DepletionConsumerIT's precedent).
        List<OutboxEntry> stockDepletedEntries = outboxRepository.findAll().stream()
                .filter(e -> "STOCK_DEPLETED".equals(e.getEventType()))
                .toList();
        assertThat(stockDepletedEntries).hasSize(1);
        JsonNode stockDepletedPayload = eventObjectMapper
                .readTree(stockDepletedEntries.get(0).getEnvelopeJson()).get("payload");
        assertThat(stockDepletedPayload.get("totalCogsPaisa").asLong()).isEqualTo(expectedCogsPaisa);

        // (4) Close the loop back to 08.1-03's coverage report — the item is now fully covered.
        CoverageResponse coverage = recipeService.getCoverage();
        assertThat(coverage.missing()).noneMatch(m -> m.menuItemId().equals(menuItemId));
    }

    private Message buildMessage(UUID eventId, UUID tenantId, UUID branchId, OrderClosedPayload payload) {
        EventEnvelope<OrderClosedPayload> envelope = new EventEnvelope<>(
                eventId, "ORDER_CLOSED", tenantId, branchId,
                Instant.now(), UUID.randomUUID(), 1, "pos-service-test", payload);
        try {
            byte[] body = eventObjectMapper.writeValueAsBytes(envelope);
            return MessageBuilder.withBody(body).build();
        } catch (Exception e) {
            throw new IllegalStateException("Failed to serialize test EventEnvelope", e);
        }
    }
}
