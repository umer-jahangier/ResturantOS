package io.restaurantos.inventory;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.consumer.GrnReceivedConsumer;
import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.InventoryMovementRepository;
import io.restaurantos.inventory.repository.StockLotRepository;
import io.restaurantos.inventory.repository.UnitOfMeasureRepository;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.event.payload.InventoryEventContract;
import io.restaurantos.shared.event.payload.PurchasingEventContract;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Goods received against a purchase order become real stock.
 *
 * <p><b>The gap this proves closed.</b> purchasing-service could approve a PO, receive goods, post
 * the GR/IR journal entry and match a vendor invoice — and none of it touched inventory. It
 * published a {@code STOCK_RECEIVED} message onto inventory's OWN exchange, under inventory's own
 * event name and routing key, in a shape inventory does not publish ({@code qtyReceived} where
 * inventory publishes {@code qty}, and no cost at all) — and nothing consumed it, because inventory
 * has only ever had a menu-item consumer and an order-closed consumer. So {@code qty_on_hand},
 * {@code stock_lots} and moving-average cost only ever moved through the manual receipt screen.
 *
 * <p>Drives the REAL {@link GrnReceivedConsumer#onMessage} with the producer's own record,
 * against a live Testcontainers Postgres, exactly as {@code DepletionConsumerIT} does for
 * ORDER_CLOSED.
 */
class GrnReceivedConsumerIT extends InventoryTestBase {

    @Autowired TenantContext tenantContext;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired UnitOfMeasureRepository unitOfMeasureRepository;
    @Autowired IngredientBranchStockRepository stockRepository;
    @Autowired StockLotRepository lotRepository;
    @Autowired InventoryMovementRepository movementRepository;
    @Autowired OutboxRepository outboxRepository;
    @Autowired GrnReceivedConsumer grnReceivedConsumer;
    @Autowired @Qualifier("eventObjectMapper") ObjectMapper eventObjectMapper;

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
                ingredientRepository, tenantId, "Chicken", "CHK-1", "KG", new BigDecimal("5")).getId();
        outboxRepository.deleteAll();
    }

    @Test
    void grnReceived_createsLot_movesQtyOnHand_andRecomputesMovingAverageCost() {
        UUID grnId = UUID.randomUUID();

        grnReceivedConsumer.onMessage(message(UUID.randomUUID(), grnLines(grnId,
                new BigDecimal("10"), 5_000L)));

        IngredientBranchStock stock = stockRepository.findByBranchIdAndIngredientId(branchId, ingredientId)
                .orElseThrow(() -> new AssertionError(
                        "no stock row — the GRN never reached inventory, which is the whole defect"));
        assertThat(stock.getQtyOnHand()).isEqualByComparingTo("10");
        assertThat(stock.getAvgCostPaisa())
                .as("moving-average cost must absorb the PO's contracted price")
                .isEqualTo(5_000L);

        assertThat(lotRepository.findByStockIdOrderByExpiryDateAsc(stock.getId())).hasSize(1);

        // The movement traces back to the purchase order that caused it.
        assertThat(movementRepository.findByReferenceId(grnId))
                .singleElement()
                .satisfies(m -> {
                    assertThat(m.getMovementType()).isEqualTo("RECEIPT");
                    assertThat(m.getReferenceType()).isEqualTo("GRN");
                    assertThat(m.getReferenceId()).isEqualTo(grnId);
                });

        // Inventory — not purchasing — publishes STOCK_RECEIVED, in inventory's own shape.
        assertThat(outboxRepository.findAll())
                .filteredOn(e -> InventoryEventContract.STOCK_RECEIVED.equals(e.getEventType())
                        && tenantId.equals(e.getTenantId()))
                .as("inventory owns STOCK_RECEIVED; purchasing must never publish it")
                .hasSize(1);
    }

    /**
     * A second receipt at a different price moves the weighted average, which is the entire reason
     * the GRN has to carry {@code unitCostPaisa}: before this seam existed, MAC was fed only by
     * hand-typed manual receipts while AP was valued off real vendor invoices.
     */
    @Test
    void secondGrnAtADifferentPrice_movesTheWeightedAverage() {
        grnReceivedConsumer.onMessage(message(UUID.randomUUID(),
                grnLines(UUID.randomUUID(), new BigDecimal("10"), 5_000L)));
        grnReceivedConsumer.onMessage(message(UUID.randomUUID(),
                grnLines(UUID.randomUUID(), new BigDecimal("10"), 7_000L)));

        IngredientBranchStock stock = stockRepository.findByBranchIdAndIngredientId(branchId, ingredientId)
                .orElseThrow();
        assertThat(stock.getQtyOnHand()).isEqualByComparingTo("20");
        assertThat(stock.getAvgCostPaisa())
                .as("(10*5000 + 10*7000) / 20")
                .isEqualTo(6_000L);
    }

    /** Purchasing may retry freely: the same eventId must not double-receive the stock. */
    @Test
    void redeliveringTheSameEvent_isANoOp() {
        UUID eventId = UUID.randomUUID();
        Message msg = message(eventId, grnLines(UUID.randomUUID(), new BigDecimal("10"), 5_000L));

        grnReceivedConsumer.onMessage(msg);
        grnReceivedConsumer.onMessage(msg);

        assertThat(stockRepository.findByBranchIdAndIngredientId(branchId, ingredientId)
                .orElseThrow()
                .getQtyOnHand())
                .as("redelivery must not receive the goods twice")
                .isEqualByComparingTo("10");
        UUID stockId = stockRepository.findByBranchIdAndIngredientId(branchId, ingredientId)
                .orElseThrow().getId();
        assertThat(lotRepository.findByStockIdOrderByExpiryDateAsc(stockId)).hasSize(1);
    }

    /**
     * A PO line raised against free text rather than a catalog item has nothing to receive INTO.
     * Skipping it is correct; silently failing the whole batch is not.
     */
    @Test
    void lineWithNoIngredient_isSkippedWithoutFailingTheBatch() {
        UUID grnId = UUID.randomUUID();
        PurchasingEventContract.GrnReceivedPayload payload = new PurchasingEventContract.GrnReceivedPayload(
                grnId, UUID.randomUUID(), branchId, UUID.randomUUID(), null,
                List.of(
                        new PurchasingEventContract.GrnLine(
                                UUID.randomUUID(), null, new BigDecimal("3"), 1_000L, null),
                        new PurchasingEventContract.GrnLine(
                                UUID.randomUUID(), ingredientId, new BigDecimal("10"), 5_000L, null)));

        grnReceivedConsumer.onMessage(message(UUID.randomUUID(), payload));

        assertThat(stockRepository.findByBranchIdAndIngredientId(branchId, ingredientId)
                .orElseThrow()
                .getQtyOnHand())
                .isEqualByComparingTo("10");
    }

    private PurchasingEventContract.GrnReceivedPayload grnLines(UUID grnId, BigDecimal qty, long unitCostPaisa) {
        return new PurchasingEventContract.GrnReceivedPayload(
                grnId, UUID.randomUUID(), branchId, UUID.randomUUID(), null,
                List.of(new PurchasingEventContract.GrnLine(
                        UUID.randomUUID(), ingredientId, qty, unitCostPaisa, null)));
    }

    private Message message(UUID eventId, PurchasingEventContract.GrnReceivedPayload payload) {
        EventEnvelope<PurchasingEventContract.GrnReceivedPayload> envelope = new EventEnvelope<>(
                eventId, PurchasingEventContract.GRN_RECEIVED, tenantId, branchId,
                Instant.now(), UUID.randomUUID(), 1, "purchasing-service-test", payload);
        try {
            return MessageBuilder.withBody(eventObjectMapper.writeValueAsBytes(envelope)).build();
        } catch (Exception e) {
            throw new IllegalStateException("Failed to serialize test EventEnvelope", e);
        }
    }
}
