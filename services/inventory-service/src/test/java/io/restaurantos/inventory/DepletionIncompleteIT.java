package io.restaurantos.inventory;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.consumer.OrderClosedConsumer;
import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import io.restaurantos.inventory.domain.model.Recipe;
import io.restaurantos.inventory.domain.model.RecipeLine;
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
import java.util.stream.StreamSupport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * Proves D-03: an ORDER_CLOSED line with no effective recipe never silently vanishes and never
 * blocks/DLQs the message — covered lines still deplete normally, and DEPLETION_INCOMPLETE always
 * publishes through the same transactional outbox as STOCK_DEPLETED when any line was skipped.
 * Mirrors {@link DepletionConsumerIT}'s Testcontainers + hand-built EventEnvelope + direct
 * {@code onMessage(Message)} harness.
 */
class DepletionIncompleteIT extends InventoryTestBase {

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
    UUID ingredientId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);

        InventoryFixtures.seedUom(unitOfMeasureRepository, tenantId, "UNIT", "Unit", BigDecimal.ONE);
        var ingredient = InventoryFixtures.seedIngredient(
                ingredientRepository, tenantId, "Beef Patty", "SKU-PATTY", "UNIT", BigDecimal.ZERO);
        ingredientId = ingredient.getId();

        var stock = InventoryFixtures.seedStock(
                stockRepository, tenantId, branchId, ingredientId, BigDecimal.valueOf(100), 600L);
        InventoryFixtures.seedLot(lotRepository, tenantId, branchId, ingredientId, stock.getId(),
                BigDecimal.valueOf(100), null, 900L);
    }

    @Test
    void partiallyCoveredOrder_depletesCoveredLine_andPublishesBothEvents() {
        UUID menuItemCovered = UUID.randomUUID();
        UUID menuItemUncovered = UUID.randomUUID();
        seedRecipe(menuItemCovered, "House Burger");

        UUID orderId = UUID.randomUUID();
        OrderClosedPayload payload = orderClosedPayload(orderId, List.of(
                new ItemEntry(menuItemCovered, "House Burger", 2, 1200L, 2400L),
                new ItemEntry(menuItemUncovered, "Mystery Item", 1, 500L, 500L)));
        Message message = buildMessage(UUID.randomUUID(), payload);

        tenantContext.clear();
        assertThatCode(() -> orderClosedConsumer.onMessage(message)).doesNotThrowAnyException();

        tenantContext.set(tenantId, branchId, null, null);
        // menuItemCovered: qty=2 -> effectiveBaseQty = (2 base units/serving * 1) * 2 = 4 units.
        IngredientBranchStock stockAfter = stockRepository
                .findByBranchIdAndIngredientId(branchId, ingredientId).orElseThrow();
        assertThat(stockAfter.getQtyOnHand()).isEqualByComparingTo(BigDecimal.valueOf(96)); // 100 - 4

        List<OutboxEntry> stockDepletedEntries = entriesForOrder(orderId, "STOCK_DEPLETED");
        assertThat(stockDepletedEntries).hasSize(1);

        OutboxEntry incomplete = singleDepletionIncompleteEntry(orderId);
        List<UUID> missingMenuItemIds = extractMissingMenuItemIds(incomplete);
        assertThat(missingMenuItemIds).containsExactly(menuItemUncovered);
    }

    @Test
    void fullyUncoveredOrder_noStockDepleted_oneDepletionIncomplete_noException() {
        UUID menuItemA = UUID.randomUUID();
        UUID menuItemB = UUID.randomUUID();

        UUID orderId = UUID.randomUUID();
        OrderClosedPayload payload = orderClosedPayload(orderId, List.of(
                new ItemEntry(menuItemA, "Mystery Item A", 1, 500L, 500L),
                new ItemEntry(menuItemB, "Mystery Item B", 1, 500L, 500L)));
        Message message = buildMessage(UUID.randomUUID(), payload);

        tenantContext.clear();
        assertThatCode(() -> orderClosedConsumer.onMessage(message)).doesNotThrowAnyException();

        tenantContext.set(tenantId, branchId, null, null);
        List<OutboxEntry> stockDepletedEntries = entriesForOrder(orderId, "STOCK_DEPLETED");
        assertThat(stockDepletedEntries).isEmpty();

        OutboxEntry incomplete = singleDepletionIncompleteEntry(orderId);
        List<UUID> missingMenuItemIds = extractMissingMenuItemIds(incomplete);
        assertThat(missingMenuItemIds).containsExactlyInAnyOrder(menuItemA, menuItemB);
    }

    /**
     * The Testcontainers Postgres schema is shared (not re-cleaned) across every {@code @Test}
     * method in this class — {@link InventoryTestBase}'s {@code @BeforeAll} runs once per class,
     * not per method — so every outbox lookup here must be scoped to THIS test's {@code orderId},
     * never a bare eventType filter across the whole table.
     */
    private List<OutboxEntry> entriesForOrder(UUID orderId, String eventType) {
        return outboxRepository.findAll().stream()
                .filter(e -> eventType.equals(e.getEventType()))
                .filter(e -> orderId.equals(extractOrderId(e)))
                .toList();
    }

    private OutboxEntry singleDepletionIncompleteEntry(UUID orderId) {
        List<OutboxEntry> entries = entriesForOrder(orderId, "DEPLETION_INCOMPLETE");
        assertThat(entries).hasSize(1);
        return entries.get(0);
    }

    private UUID extractOrderId(OutboxEntry entry) {
        try {
            JsonNode envelope = eventObjectMapper.readTree(entry.getEnvelopeJson());
            return UUID.fromString(envelope.path("payload").path("orderId").asText());
        } catch (Exception e) {
            throw new IllegalStateException("Failed to parse outbox envelope", e);
        }
    }

    private List<UUID> extractMissingMenuItemIds(OutboxEntry entry) {
        try {
            JsonNode envelope = eventObjectMapper.readTree(entry.getEnvelopeJson());
            JsonNode missing = envelope.path("payload").path("missingMenuItemIds");
            return StreamSupport.stream(missing.spliterator(), false)
                    .map(JsonNode::asText)
                    .map(UUID::fromString)
                    .toList();
        } catch (Exception e) {
            throw new IllegalStateException("Failed to parse DEPLETION_INCOMPLETE envelope", e);
        }
    }

    private void seedRecipe(UUID menuItemId, String name) {
        Recipe recipe = new Recipe();
        recipe.setTenantId(tenantId);
        recipe.setMenuItemId(menuItemId);
        recipe.setVersion(1);
        recipe.setCurrent(true);
        recipe.setEffectiveFrom(Instant.now().minus(1, ChronoUnit.DAYS));
        recipe.setYieldServings(BigDecimal.ONE);
        recipe.setName(name);
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

    private static OrderClosedPayload orderClosedPayload(UUID orderId, List<ItemEntry> items) {
        return new OrderClosedPayload(
                orderId, "ORD-2001", "DINE_IN", null,
                1000L, 0L, 0L, 100L, 1100L,
                List.of(), items,
                null, null, Instant.now());
    }

    private Message buildMessage(UUID eventId, OrderClosedPayload payload) {
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
