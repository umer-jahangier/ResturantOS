package io.restaurantos.purchasing.service;

import io.restaurantos.purchasing.domain.enums.PoStatus;
import io.restaurantos.purchasing.domain.model.MockGrnReceipt;
import io.restaurantos.purchasing.domain.model.PurchaseOrder;
import io.restaurantos.purchasing.domain.model.PurchaseOrderLine;
import io.restaurantos.purchasing.domain.model.VendorItem;
import io.restaurantos.purchasing.dto.MockReceiveRequest;
import io.restaurantos.purchasing.dto.MockReceiveResponse;
import io.restaurantos.purchasing.exception.InvalidPoStateException;
import io.restaurantos.purchasing.repository.MockGrnReceiptRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderLineRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderRepository;
import io.restaurantos.purchasing.repository.VendorItemRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.event.payload.PurchasingEventContract;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
public class GrnReceiptSimulator {

    private final PurchaseOrderRepository purchaseOrderRepository;
    private final PurchaseOrderLineRepository lineRepository;
    private final MockGrnReceiptRepository mockGrnReceiptRepository;
    private final VendorItemRepository vendorItemRepository;
    private final EventPublisher eventPublisher;
    private final TenantContext tenantContext;

    // No FinanceInternalClient. Purchasing still posts to finance for the vendor invoice
    // (VendorInvoiceService) and the AP payment (ApPaymentService) — those are genuinely its own
    // events. A goods receipt is not: inventory owns it. See simulateReceive.
    public GrnReceiptSimulator(PurchaseOrderRepository purchaseOrderRepository,
                               PurchaseOrderLineRepository lineRepository,
                               MockGrnReceiptRepository mockGrnReceiptRepository,
                               VendorItemRepository vendorItemRepository,
                               EventPublisher eventPublisher,
                               TenantContext tenantContext) {
        this.purchaseOrderRepository = purchaseOrderRepository;
        this.lineRepository = lineRepository;
        this.mockGrnReceiptRepository = mockGrnReceiptRepository;
        this.vendorItemRepository = vendorItemRepository;
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
        List<PurchasingEventContract.GrnLine> grnLines = new ArrayList<>();
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

            VendorItem catalogItem = poLine.getVendorItemId() == null ? null
                    : vendorItemRepository.findByTenantIdAndId(tenantId, poLine.getVendorItemId()).orElse(null);
            grnLines.add(new PurchasingEventContract.GrnLine(
                    poLine.getId(),
                    poLine.getIngredientId(),
                    lineReq.receivedQty(),
                    poLine.getUnitPricePaisa(),
                    null,
                    packFactor(catalogItem),
                    packUom(catalogItem, poLine)));
        }

        // NO direct DR 1300 / CR 1700 here. It used to post one, and finance ALSO posts one when
        // the GRN_RECEIVED published below comes back around as inventory's STOCK_RECEIVED — two
        // entries per receipt, under two different idempotency keys ("GRN"/grnId here and
        // "STOCK_RECEIPT"/lotId there), so neither one's dedupe could see the other. Inventory was
        // overstated and GR/IR held a permanent credit balance of one whole receipt, because the
        // vendor invoice only ever debits 1700 once.
        //
        // Finance owns the entry now, posted from the real stock lot. That is the correct side to
        // keep for three reasons: inventory-service is the authority on stock valuation (it applies
        // the UOM/pack-factor conversion and recomputes moving-average cost, neither of which the
        // qty * unitPrice sum here ever saw — that number is in the vendor's ORDER unit); the entry
        // then ties to physical stock that demonstrably exists; and the manual receipt screen goes
        // through exactly the same path, so both ways of receiving stock post identically.
        updatePoReceiveStatus(po);

        // Last statement: one GRN_RECEIVED for the whole batch, through the transactional outbox.
        // Idempotent downstream on grnId, so a retry cannot double-receive the stock.
        if (!grnLines.isEmpty()) {
            publishGrnReceived(po, batchGrnId, grnLines);
        }

        return new MockReceiveResponse(po.getId(), po.getStatus(), List.of(batchGrnId));
    }

    /**
     * How many pack units one ORDER unit holds — a carton of 10&nbsp;kg is 10. Purchasing owns this
     * half of the purchase-unit conversion because it is catalog data; inventory owns the other
     * half (pack unit → the ingredient's stock unit), because only it has the UOM registry.
     *
     * <p>Null when the line was hand-typed rather than priced from the catalog: the consumer reads
     * that as one, which is what happened for every receipt before this existed.
     */
    private static BigDecimal packFactor(VendorItem catalogItem) {
        return catalogItem == null ? null : catalogItem.getPackUnitsPerOrderUnit();
    }

    /**
     * The unit {@link #packFactor} counts. For a catalog line that is the vendor's pack UOM — never
     * {@code orderUom}, which is the outer unit ("CASE") the price is already quoted in, and never
     * {@code poLine.uom}, which defaults to {@code orderUom} for exactly that reason.
     *
     * <p>A hand-typed line has no catalog row, so its own uom is the only unit anyone stated. It is
     * free text and usually will not resolve; inventory falls back to a factor of one and logs it.
     */
    private static String packUom(VendorItem catalogItem, PurchaseOrderLine poLine) {
        return catalogItem != null ? catalogItem.getPackUom() : poLine.getUom();
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

    /**
     * Tells inventory-service that goods arrived, so it can create the stock lot, move
     * qty_on_hand and recompute moving-average cost through its OWN ReceiptService.
     *
     * <p>This replaces a per-line {@code STOCK_RECEIVED} message published onto
     * {@code inventory.topic} — inventory's own exchange, event name and routing key — with a
     * hand-built map that used {@code qtyReceived} where inventory publishes {@code qty} and
     * carried no cost at all. Nothing consumed it: inventory has only ever had a menu-item
     * consumer and an order-closed consumer. So a goods receipt posted its GR/IR entry to finance
     * and then evaporated, and stock could only ever be entered by hand — which is also why
     * moving-average cost never absorbed a real vendor price.
     *
     * <p>Purchasing now speaks on its own exchange about its own domain event, and inventory keeps
     * sole ownership of the stock write, of MAC, and of STOCK_RECEIVED.
     */
    private void publishGrnReceived(PurchaseOrder po, UUID grnId,
                                    List<PurchasingEventContract.GrnLine> lines) {
        eventPublisher.publish(
                PurchasingEventContract.EXCHANGE,
                PurchasingEventContract.GRN_RECEIVED_KEY,
                PurchasingEventContract.GRN_RECEIVED,
                po.getBranchId(),
                new PurchasingEventContract.GrnReceivedPayload(
                        grnId, po.getId(), po.getBranchId(), po.getVendorId(), LocalDate.now(), lines));
    }
}
