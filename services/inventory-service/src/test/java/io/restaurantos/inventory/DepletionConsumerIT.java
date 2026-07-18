package io.restaurantos.inventory;

import io.restaurantos.inventory.consumer.OrderClosedConsumer;
import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import io.restaurantos.inventory.domain.model.InventoryMovement;
import io.restaurantos.inventory.domain.model.Recipe;
import io.restaurantos.inventory.domain.model.RecipeLine;
import io.restaurantos.inventory.domain.model.StockLot;
import io.restaurantos.inventory.event.InventoryEventPayloads.ItemEntry;
import io.restaurantos.inventory.event.InventoryEventPayloads.OrderClosedPayload;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.InventoryMovementRepository;
import io.restaurantos.inventory.repository.RecipeLineRepository;
import io.restaurantos.inventory.repository.RecipeRepository;
import io.restaurantos.inventory.repository.StockLotRepository;
import io.restaurantos.inventory.repository.UnitOfMeasureRepository;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.tenant.TenantContext;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * End-to-end proof of INV-03: an ORDER_CLOSED event drives {@link OrderClosedConsumer#onMessage}
 * through the real Spring-wired {@code DepletionService} against a live Testcontainers Postgres —
 * effective-recipe resolution (D-01), FEFO lot walk with floor-at-zero (D-02), COGS at the
 * aggregate MAC never lot cost (D-04/Pitfall 9), a DEPLETION movement, and STOCK_DEPLETED written
 * to {@code event_outbox} inside the same transaction. Re-delivering the SAME eventId proves
 * exactly-once depletion (T-8-IDEM) — {@link InventoryTestBase} mocks {@code RabbitTemplate}, so
 * STOCK_DEPLETED intent is asserted via the outbox row, not a live broker delivery.
 */
class DepletionConsumerIT extends InventoryTestBase {

    @Autowired TenantContext tenantContext;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired UnitOfMeasureRepository unitOfMeasureRepository;
    @Autowired IngredientBranchStockRepository stockRepository;
    @Autowired StockLotRepository lotRepository;
    @Autowired InventoryMovementRepository movementRepository;
    @Autowired RecipeRepository recipeRepository;
    @Autowired RecipeLineRepository recipeLineRepository;
    @Autowired OutboxRepository outboxRepository;
    @Autowired OrderClosedConsumer orderClosedConsumer;
    @Autowired @Qualifier("eventObjectMapper") ObjectMapper eventObjectMapper;

    UUID tenantId;
    UUID branchId;
    UUID menuItemId;
    UUID ingredientId;
    UUID stockId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        menuItemId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);

        InventoryFixtures.seedUom(unitOfMeasureRepository, tenantId, "UNIT", "Unit", BigDecimal.ONE);
        var ingredient = InventoryFixtures.seedIngredient(
                ingredientRepository, tenantId, "Beef Patty", "SKU-PATTY", "UNIT", BigDecimal.ZERO);
        ingredientId = ingredient.getId();

        // avgCostPaisa=600 deliberately differs from the lot's own receiptUnitCostPaisa=900 below —
        // proves COGS is valued at the aggregate MAC, never the lot's own receipt cost (Pitfall 9).
        var stock = InventoryFixtures.seedStock(
                stockRepository, tenantId, branchId, ingredientId, BigDecimal.valueOf(100), 600L);
        stockId = stock.getId();
        InventoryFixtures.seedLot(lotRepository, tenantId, branchId, ingredientId, stockId,
                BigDecimal.valueOf(100), null, 900L);

        Recipe recipe = new Recipe();
        recipe.setTenantId(tenantId);
        recipe.setMenuItemId(menuItemId);
        recipe.setVersion(1);
        recipe.setCurrent(true);
        recipe.setEffectiveFrom(Instant.now().minus(1, ChronoUnit.DAYS));
        recipe.setYieldServings(BigDecimal.ONE);
        recipe.setName("House Burger");
        Recipe savedRecipe = recipeRepository.save(recipe);

        RecipeLine line = new RecipeLine();
        line.setTenantId(tenantId);
        line.setRecipeId(savedRecipe.getId());
        line.setIngredientId(ingredientId);
        line.setQty(BigDecimal.valueOf(2)); // 2 base units per serving
        line.setUomCode("UNIT");
        line.setYieldPct(BigDecimal.valueOf(100));
        recipeLineRepository.save(line);
    }

    @Test
    void firstDelivery_depletesStockAndPublishesStockDepleted_secondDuplicateDelivery_isNoOp() {
        UUID orderId = UUID.randomUUID();
        UUID eventId = UUID.randomUUID();
        // orderQty=3 -> effectiveBaseQty = (2 * 1 / 1.0) * 3 / 1 = 6 base units.
        OrderClosedPayload payload = orderClosedPayload(orderId, List.of(
                new ItemEntry(menuItemId, "House Burger", 3, 1200L, 3600L)));
        Message message = buildMessage(eventId, tenantId, branchId, payload);

        tenantContext.clear();
        orderClosedConsumer.onMessage(message);

        tenantContext.set(tenantId, branchId, null, null);
        IngredientBranchStock stockAfterFirst = stockRepository
                .findByBranchIdAndIngredientId(branchId, ingredientId).orElseThrow();
        assertThat(stockAfterFirst.getQtyOnHand()).isEqualByComparingTo(BigDecimal.valueOf(94)); // 100 - 6

        StockLot lotAfterFirst = lotRepository.findByStockIdOrderByExpiryDateAsc(stockId).get(0);
        assertThat(lotAfterFirst.getQty()).isEqualByComparingTo(BigDecimal.valueOf(94)); // 100 - 6, FEFO

        List<InventoryMovement> movementsAfterFirst = movementRepository.findByReferenceId(orderId);
        assertThat(movementsAfterFirst).hasSize(1);
        InventoryMovement movement = movementsAfterFirst.get(0);
        assertThat(movement.getMovementType()).isEqualTo("DEPLETION");
        assertThat(movement.getQty()).isEqualByComparingTo(BigDecimal.valueOf(-6));
        assertThat(movement.getUnitCostPaisa()).isEqualTo(600L); // aggregate MAC, not the lot's 900
        assertThat(movement.getTotalCostPaisa()).isEqualTo(3600L); // 6 * 600
        assertThat(movement.getReferenceType()).isEqualTo("ORDER_CLOSED");

        List<OutboxEntry> stockDepletedEntries = outboxRepository.findTop200ByStatusOrderByCreatedAtAsc("PENDING")
                .stream().filter(e -> "STOCK_DEPLETED".equals(e.getEventType())).toList();
        assertThat(stockDepletedEntries).hasSize(1);

        // Duplicate delivery — SAME eventId. processed_events dedup must make this a no-op.
        tenantContext.clear();
        orderClosedConsumer.onMessage(message);

        tenantContext.set(tenantId, branchId, null, null);
        IngredientBranchStock stockAfterDuplicate = stockRepository
                .findByBranchIdAndIngredientId(branchId, ingredientId).orElseThrow();
        assertThat(stockAfterDuplicate.getQtyOnHand()).isEqualByComparingTo(BigDecimal.valueOf(94)); // unchanged

        assertThat(movementRepository.findByReferenceId(orderId)).hasSize(1); // unchanged

        long stockDepletedCountAfterDuplicate = outboxRepository
                .findTop200ByStatusOrderByCreatedAtAsc("PENDING").stream()
                .filter(e -> "STOCK_DEPLETED".equals(e.getEventType())).count();
        assertThat(stockDepletedCountAfterDuplicate).isEqualTo(1); // unchanged — proves T-8-IDEM
    }

    @Test
    void unresolvableRecipe_skipsLine_noMovementNoException() {
        UUID orderId = UUID.randomUUID();
        UUID eventId = UUID.randomUUID();
        UUID menuItemWithNoRecipe = UUID.randomUUID();
        OrderClosedPayload payload = orderClosedPayload(orderId, List.of(
                new ItemEntry(menuItemWithNoRecipe, "Mystery Item", 1, 500L, 500L)));
        Message message = buildMessage(eventId, tenantId, branchId, payload);

        tenantContext.clear();

        // Must not throw — a menu item with no resolvable recipe silently skips the line.
        orderClosedConsumer.onMessage(message);

        tenantContext.set(tenantId, branchId, null, null);
        assertThat(movementRepository.findByReferenceId(orderId)).isEmpty();
    }

    private static OrderClosedPayload orderClosedPayload(UUID orderId, List<ItemEntry> items) {
        return new OrderClosedPayload(
                orderId, "ORD-1001", "DINE_IN", null,
                1000L, 0L, 0L, 100L, 1100L,
                List.of(), items,
                null, null, Instant.now());
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
