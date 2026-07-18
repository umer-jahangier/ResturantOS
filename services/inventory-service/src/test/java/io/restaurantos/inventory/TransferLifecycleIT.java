package io.restaurantos.inventory;

import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import io.restaurantos.inventory.domain.model.InventoryMovement;
import io.restaurantos.inventory.dto.TransferDtos.CreateTransferRequest;
import io.restaurantos.inventory.dto.TransferDtos.ReceiveLineRequest;
import io.restaurantos.inventory.dto.TransferDtos.ReceiveTransferRequest;
import io.restaurantos.inventory.dto.TransferDtos.TransferDto;
import io.restaurantos.inventory.dto.TransferDtos.TransferLineRequest;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.InventoryMovementRepository;
import io.restaurantos.inventory.service.TransferService;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * INV-05 end-to-end: ship decrements the source branch's stock and writes TRANSFER_OUT +
 * TRANSFER_SHIPPED (in-transit valuation); receiving the full shipped qty increments the
 * destination branch's stock, recomputes destination MAC, writes TRANSFER_IN + TRANSFER_RECEIVED,
 * no variance; receiving less than shipped records variance_qty and writes TRANSFER_VARIANCE.
 * Drives {@link TransferService} directly (bean-level, no HTTP/OPA) against a live Testcontainers
 * Postgres — mirrors {@code MacRecomputeIT}'s precedent.
 */
class TransferLifecycleIT extends InventoryTestBase {

    @Autowired TenantContext tenantContext;
    @Autowired TransferService transferService;
    @Autowired IngredientRepository ingredientRepository;
    @Autowired IngredientBranchStockRepository stockRepository;
    @Autowired InventoryMovementRepository movementRepository;
    @Autowired OutboxRepository outboxRepository;

    UUID tenantId;
    UUID fromBranchId;
    UUID toBranchId;
    UUID ingredientId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        fromBranchId = UUID.randomUUID();
        toBranchId = UUID.randomUUID();
        tenantContext.set(tenantId, fromBranchId, null, null);

        ingredientId = InventoryFixtures.seedIngredient(
                ingredientRepository, tenantId, "Chicken Breast", "SKU-XFER-001", "KG", BigDecimal.ZERO).getId();

        InventoryFixtures.seedStock(stockRepository, tenantId, fromBranchId, ingredientId,
                BigDecimal.valueOf(50), 400L);
    }

    @Test
    void shippingDecrementsSourceStock_writesTransferOutMovement_andPublishesTransferShipped() {
        TransferDto shipped = transferService.ship(new CreateTransferRequest(
                fromBranchId, toBranchId, List.of(new TransferLineRequest(ingredientId, BigDecimal.valueOf(20)))));

        assertThat(shipped.status()).isEqualTo("SHIPPED");
        assertThat(shipped.lines()).hasSize(1);
        assertThat(shipped.lines().get(0).qtyShipped()).isEqualByComparingTo(BigDecimal.valueOf(20));
        assertThat(shipped.lines().get(0).unitCostPaisa()).isEqualTo(400L);

        IngredientBranchStock sourceStock = stockRepository
                .findByBranchIdAndIngredientId(fromBranchId, ingredientId).orElseThrow();
        assertThat(sourceStock.getQtyOnHand()).isEqualByComparingTo(BigDecimal.valueOf(30)); // 50 - 20

        List<InventoryMovement> outMovements = movementRepository.findByReferenceId(shipped.transferId());
        assertThat(outMovements).hasSize(1);
        assertThat(outMovements.get(0).getMovementType()).isEqualTo("TRANSFER_OUT");
        assertThat(outMovements.get(0).getQty()).isEqualByComparingTo(BigDecimal.valueOf(-20));
        assertThat(outMovements.get(0).getUnitCostPaisa()).isEqualTo(400L);

        // Scoped by tenantId (unique per test, freshly randomized in setUp) AND eventType —
        // event_outbox has no RLS (shared infra table) and InventoryTestBase's Flyway clean()
        // runs once per test CLASS (@BeforeAll), not per method, so multiple test methods in this
        // class accumulate rows in the same table; an eventType-only filter would leak counts
        // across sibling test methods that each publish TRANSFER_SHIPPED.
        List<OutboxEntry> shippedEntries = outboxRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId()) && "TRANSFER_SHIPPED".equals(e.getEventType())).toList();
        assertThat(shippedEntries).hasSize(1);
    }

    @Test
    void receivingFullQty_incrementsDestinationStock_recomputesMac_noVariance() {
        InventoryFixtures.seedStock(stockRepository, tenantId, toBranchId, ingredientId,
                BigDecimal.valueOf(10), 300L);

        TransferDto shipped = transferService.ship(new CreateTransferRequest(
                fromBranchId, toBranchId, List.of(new TransferLineRequest(ingredientId, BigDecimal.valueOf(20)))));

        TransferDto received = transferService.receive(new ReceiveTransferRequest(
                shipped.transferId(), List.of(new ReceiveLineRequest(ingredientId, BigDecimal.valueOf(20)))));

        assertThat(received.status()).isEqualTo("RECEIVED");
        assertThat(received.lines().get(0).qtyReceived()).isEqualByComparingTo(BigDecimal.valueOf(20));
        assertThat(received.lines().get(0).varianceQty()).isEqualByComparingTo(BigDecimal.ZERO);

        // Destination MAC recompute: (10*300 + 20*400) / 30 = (3000 + 8000) / 30 = 366.67 -> 367 HALF_UP
        IngredientBranchStock destStock = stockRepository
                .findByBranchIdAndIngredientId(toBranchId, ingredientId).orElseThrow();
        assertThat(destStock.getQtyOnHand()).isEqualByComparingTo(BigDecimal.valueOf(30)); // 10 + 20
        assertThat(destStock.getAvgCostPaisa()).isEqualTo(367L);

        List<InventoryMovement> inMovements = movementRepository.findByReferenceId(shipped.transferId()).stream()
                .filter(m -> "TRANSFER_IN".equals(m.getMovementType())).toList();
        assertThat(inMovements).hasSize(1);
        assertThat(inMovements.get(0).getQty()).isEqualByComparingTo(BigDecimal.valueOf(20));

        List<OutboxEntry> receivedEntries = outboxRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId()) && "TRANSFER_RECEIVED".equals(e.getEventType())).toList();
        assertThat(receivedEntries).hasSize(1);

        long varianceEntries = outboxRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId()) && "TRANSFER_VARIANCE".equals(e.getEventType())).count();
        assertThat(varianceEntries).isZero();
    }

    @Test
    void receivingLessThanShipped_recordsVarianceQty_andPublishesTransferVariance() {
        TransferDto shipped = transferService.ship(new CreateTransferRequest(
                fromBranchId, toBranchId, List.of(new TransferLineRequest(ingredientId, BigDecimal.valueOf(20)))));

        TransferDto received = transferService.receive(new ReceiveTransferRequest(
                shipped.transferId(), List.of(new ReceiveLineRequest(ingredientId, BigDecimal.valueOf(15)))));

        assertThat(received.status()).isEqualTo("RECEIVED");
        assertThat(received.lines().get(0).qtyReceived()).isEqualByComparingTo(BigDecimal.valueOf(15));
        assertThat(received.lines().get(0).varianceQty()).isEqualByComparingTo(BigDecimal.valueOf(5)); // 20 - 15

        List<OutboxEntry> varianceEntries = outboxRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId()) && "TRANSFER_VARIANCE".equals(e.getEventType())).toList();
        assertThat(varianceEntries).hasSize(1);

        IngredientBranchStock destStock = stockRepository
                .findByBranchIdAndIngredientId(toBranchId, ingredientId).orElseThrow();
        assertThat(destStock.getQtyOnHand()).isEqualByComparingTo(BigDecimal.valueOf(15)); // only what arrived
    }
}
