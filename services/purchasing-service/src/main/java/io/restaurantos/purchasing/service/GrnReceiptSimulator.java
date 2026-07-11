package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.domain.enums.PoStatus;
import io.restaurantos.purchasing.domain.model.MockGrnReceipt;
import io.restaurantos.purchasing.domain.model.PurchaseOrder;
import io.restaurantos.purchasing.domain.model.PurchaseOrderLine;
import io.restaurantos.purchasing.domain.model.PurchaseOrderLine;
import io.restaurantos.purchasing.dto.MockReceiveRequest;
import io.restaurantos.purchasing.dto.MockReceiveResponse;
import io.restaurantos.purchasing.exception.InvalidPoStateException;
import io.restaurantos.purchasing.feign.FinanceInternalClient;
import io.restaurantos.purchasing.repository.MockGrnReceiptRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderLineRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class GrnReceiptSimulator {

    private final PurchaseOrderRepository purchaseOrderRepository;
    private final PurchaseOrderLineRepository lineRepository;
    private final MockGrnReceiptRepository mockGrnReceiptRepository;
    private final FinanceInternalClient financeInternalClient;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;

    public GrnReceiptSimulator(PurchaseOrderRepository purchaseOrderRepository,
                               PurchaseOrderLineRepository lineRepository,
                               MockGrnReceiptRepository mockGrnReceiptRepository,
                               FinanceInternalClient financeInternalClient,
                               EventPublisher eventPublisher,
                               TenantContext tenantContext) {
        this.purchaseOrderRepository = purchaseOrderRepository;
        this.lineRepository = lineRepository;
        this.mockGrnReceiptRepository = mockGrnReceiptRepository;
        this.financeInternalClient = financeInternalClient;
        this.eventPublisher = eventPublisher;
        this.tenantContext = tenantContext;
    }

    @Transactional
    public MockReceiveResponse simulateReceive(UUID poId, MockReceiveRequest request, String idempotencyKey) {
        UUID tenantId = tenantContext.requireTenantId();
        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
            var existing = mockGrnReceiptRepository.findByTenantIdAndIdempotencyKey(tenantId, idempotencyKey);
            if (existing.isPresent()) {
                PurchaseOrder po = purchaseOrderRepository.findById(poId).orElseThrow();
                return new MockReceiveResponse(po.getId(), po.getStatus(), List.of(existing.get().getGrnId()));
            }
        }

        PurchaseOrder po = purchaseOrderRepository.findById(poId).orElseThrow();
        if (po.getStatus() != PoStatus.SENT && po.getStatus() != PoStatus.PARTIALLY_RECEIVED) {
            throw new InvalidPoStateException("PO must be SENT or PARTIALLY_RECEIVED to receive goods");
        }

        UUID batchGrnId = UUID.randomUUID();
        long inventoryAmount = 0L;
        for (MockReceiveRequest.Line lineReq : request.lines()) {
            PurchaseOrderLine poLine = lineRepository.findById(lineReq.poLineId()).orElseThrow();
            if (!lineRepository.findByPurchaseOrderId(poId).stream()
                    .anyMatch(l -> l.getId().equals(lineReq.poLineId()))) {
                throw new InvalidPoStateException("PO line does not belong to PO");
            }
            MockGrnReceipt receipt = new MockGrnReceipt();
            receipt.setTenantId(tenantId);
            receipt.setPurchaseOrderId(poId);
            receipt.setPoLineId(lineReq.poLineId());
            receipt.setGrnId(batchGrnId);
            receipt.setReceivedQty(lineReq.receivedQty());
            receipt.setReceivedAt(Instant.now());
            receipt.setIdempotencyKey(idempotencyKey);
            mockGrnReceiptRepository.save(receipt);

            inventoryAmount += lineReq.receivedQty()
                    .multiply(BigDecimal.valueOf(poLine.getUnitPricePaisa()))
                    .setScale(0, RoundingMode.HALF_UP)
                    .longValue();

            publishStockReceived(po, poLine, lineReq.receivedQty(), batchGrnId);
        }

        if (inventoryAmount > 0) {
            financeInternalClient.autoPost(tenantId, new FinanceInternalClient.AutoPostJeRequest(
                    po.getBranchId(),
                    LocalDate.now(),
                    "GRN receipt " + batchGrnId,
                    "GRN",
                    batchGrnId,
                    List.of(
                            new FinanceInternalClient.JeLine("1300", "Inventory", inventoryAmount, 0L),
                            new FinanceInternalClient.JeLine("1700", "GR/IR Clearing", 0L, inventoryAmount))));
        }

        updatePoReceiveStatus(po);
        return new MockReceiveResponse(po.getId(), po.getStatus(), List.of(batchGrnId));
    }

    private void updatePoReceiveStatus(PurchaseOrder po) {
        List<PurchaseOrderLine> lines = lineRepository.findByPurchaseOrderId(po.getId());
        boolean allFullyReceived = true;
        for (PurchaseOrderLine line : lines) {
            BigDecimal received = mockGrnReceiptRepository.sumReceivedQtyByPoLineId(line.getId());
            if (received.compareTo(line.getQty()) < 0) {
                allFullyReceived = false;
                break;
            }
        }
        po.setStatus(allFullyReceived ? PoStatus.FULLY_RECEIVED : PoStatus.PARTIALLY_RECEIVED);
        purchaseOrderRepository.save(po);
    }

    private void publishStockReceived(PurchaseOrder po, PurchaseOrderLine line, BigDecimal qty, UUID grnId) {
        Map<String, Object> payload = new HashMap<>();
        payload.put("poId", po.getId());
        payload.put("poLineId", line.getId());
        payload.put("ingredientId", line.getIngredientId());
        payload.put("qtyReceived", qty);
        payload.put("branchId", po.getBranchId());
        payload.put("grnId", grnId);
        eventPublisher.publish("inventory.topic", "inventory.stock.received", "STOCK_RECEIVED", po.getBranchId(), payload);
    }
}
