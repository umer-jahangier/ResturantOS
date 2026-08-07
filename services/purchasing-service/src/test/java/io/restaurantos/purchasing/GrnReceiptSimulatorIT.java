package io.restaurantos.purchasing;

import io.restaurantos.purchasing.domain.enums.LineMatchStatus;
import io.restaurantos.purchasing.domain.model.MockGrnReceipt;
import io.restaurantos.purchasing.domain.model.PurchaseOrder;
import io.restaurantos.purchasing.domain.model.PurchaseOrderLine;
import io.restaurantos.purchasing.domain.model.VendorInvoiceLine;
import io.restaurantos.purchasing.domain.model.VendorItem;
import io.restaurantos.purchasing.dto.MockReceiveRequest;
import io.restaurantos.purchasing.domain.model.Vendor;
import io.restaurantos.purchasing.repository.MockGrnReceiptRepository;
import io.restaurantos.purchasing.repository.VendorItemRepository;
import io.restaurantos.purchasing.repository.VendorRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderLineRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderRepository;
import io.restaurantos.purchasing.feign.FinanceInternalClient;
import io.restaurantos.purchasing.service.GrnReceiptSimulator;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.event.payload.PurchasingEventContract;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class GrnReceiptSimulatorIT extends PurchasingTestBase {

    @Autowired
    private GrnReceiptSimulator grnReceiptSimulator;

    @Autowired
    private PurchaseOrderRepository purchaseOrderRepository;

    @Autowired
    private PurchaseOrderLineRepository lineRepository;

    @Autowired
    private VendorRepository vendorRepository;

    @Autowired
    private MockGrnReceiptRepository mockGrnReceiptRepository;

    @Autowired
    private VendorItemRepository vendorItemRepository;

    @Autowired
    private TenantContext tenantContext;

    private UUID poId;
    private UUID lineId;

    @BeforeEach
    void setUp() {
        tenantContext.set(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), null);
        when(financeInternalClient.autoPost(any(), any())).thenReturn(
                ApiResponse.ok(new io.restaurantos.purchasing.feign.FinanceInternalClient.JePostResponse(
                        UUID.randomUUID(), "JE-1")));

        Vendor vendor = new Vendor();
        vendor.setTenantId(tenantContext.requireTenantId());
        vendor.setName("Test Vendor");
        vendor.setPaymentTerms("NET30");
        vendor = vendorRepository.save(vendor);

        PurchaseOrder po = new PurchaseOrder();
        po.setTenantId(tenantContext.requireTenantId());
        po.setVendorId(vendor.getId());
        po.setBranchId(tenantContext.getBranchId().orElseThrow());
        po.setStatus(io.restaurantos.purchasing.domain.enums.PoStatus.SENT);
        po.setTotalPaisa(10_000L);
        po = purchaseOrderRepository.save(po);
        poId = po.getId();

        PurchaseOrderLine line = new PurchaseOrderLine();
        line.setTenantId(po.getTenantId());
        line.setPurchaseOrder(po);
        line.setIngredientId(UUID.randomUUID());
        line.setQty(BigDecimal.TEN);
        line.setUom("kg");
        line.setUnitPricePaisa(1000L);
        line.setLineTotalPaisa(10_000L);
        line = lineRepository.save(line);
        lineId = line.getId();
    }

    /**
     * ONE goods receipt must produce exactly ONE {@code DR 1300 / CR 1700} pair in the ledger.
     *
     * <p><b>The defect this pins.</b> A receipt used to post GR/IR TWICE, under two different
     * idempotency keys, so neither one's dedupe could see the other:
     *
     * <ol>
     *   <li>{@code GrnReceiptSimulator} called finance directly over Feign with
     *       {@code sourceType="GRN", sourceId=grnId} — {@code DR 1300 / CR 1700}.</li>
     *   <li>The same method then published {@code GRN_RECEIVED}, which inventory turns into a real
     *       stock lot and re-publishes as {@code STOCK_RECEIVED}; finance's
     *       {@code postStockReceipt} posts {@code sourceType="STOCK_RECEIPT", sourceId=lotId} —
     *       {@code DR 1300 / CR 1700} again.</li>
     * </ol>
     *
     * <p>The vendor invoice then debits 1700 once, so GR/IR kept a permanent credit balance of one
     * whole receipt and inventory was overstated by the same amount, on every PO ever received.
     *
     * <p>Step 1 is the one that had to go. Inventory owns stock valuation — it applies the UOM and
     * pack-factor conversion and recomputes moving-average cost — so its lot cost is the authoritative
     * number, while purchasing's {@code receivedQty * unitPricePaisa} is denominated in the vendor's
     * ORDER unit and never saw that conversion. Posting from the lot also ties every ledger entry to
     * physical stock that demonstrably exists.
     */
    @Test
    void oneReceipt_producesExactlyOneGrIrPosting() {
        grnReceiptSimulator.simulateReceive(poId,
                new MockReceiveRequest(List.of(new MockReceiveRequest.Line(lineId, BigDecimal.TEN))),
                "idem-1");

        assertThat(mockGrnReceiptRepository.sumReceivedQtyByPoLineId(lineId)).isEqualByComparingTo(BigDecimal.TEN);

        long fromPurchasingDirect = capturedGrIrAutoPosts();
        long viaGrnReceivedThenStockReceived = capturedGrnReceivedEvents();

        System.out.printf(
                "[UAT] GR/IR postings for ONE receipt: purchasing-direct=%d, "
                        + "via GRN_RECEIVED->STOCK_RECEIVED=%d, total=%d%n",
                fromPurchasingDirect, viaGrnReceivedThenStockReceived,
                fromPurchasingDirect + viaGrnReceivedThenStockReceived);

        assertThat(fromPurchasingDirect)
                .as("purchasing must not post 1300/1700 itself — inventory owns the valuation and "
                        + "finance posts it from the real stock lot off STOCK_RECEIVED")
                .isZero();
        assertThat(viaGrnReceivedThenStockReceived)
                .as("exactly one GRN_RECEIVED, which is the single path to the single GR/IR entry")
                .isEqualTo(1);
        assertThat(fromPurchasingDirect + viaGrnReceivedThenStockReceived)
                .as("one receipt, one DR 1300 / CR 1700")
                .isEqualTo(1);
    }

    /**
     * A repeated idempotency key must not receive the stock twice — the guarantee the old
     * {@code simulateReceive_postsFinanceOnce} was really testing, expressed against the effects
     * that still exist now that purchasing no longer posts to finance itself.
     */
    @Test
    void repeatedIdempotencyKey_doesNotReceiveTwice() {
        MockReceiveRequest request =
                new MockReceiveRequest(List.of(new MockReceiveRequest.Line(lineId, BigDecimal.TEN)));

        grnReceiptSimulator.simulateReceive(poId, request, "idem-1");
        grnReceiptSimulator.simulateReceive(poId, request, "idem-1");

        assertThat(mockGrnReceiptRepository.sumReceivedQtyByPoLineId(lineId))
                .as("the second call short-circuits on the idempotency key")
                .isEqualByComparingTo(BigDecimal.TEN);
        assertThat(capturedGrnReceivedEvents())
                .as("and publishes no second GRN_RECEIVED, so inventory cannot double-receive")
                .isEqualTo(1);
        assertThat(capturedGrIrAutoPosts()).isZero();
    }

    /** How many {@code DR 1300 / CR 1700} entries purchasing pushed to finance over Feign. */
    private long capturedGrIrAutoPosts() {
        ArgumentCaptor<FinanceInternalClient.AutoPostJeRequest> captor =
                ArgumentCaptor.forClass(FinanceInternalClient.AutoPostJeRequest.class);
        verify(financeInternalClient, atLeast(0)).autoPost(any(), captor.capture());
        return captor.getAllValues().stream()
                .filter(r -> r.lines().stream().anyMatch(l -> "1700".equals(l.accountCode())))
                .count();
    }

    /** How many GRN_RECEIVED events were published — each becomes one GR/IR entry downstream. */
    private long capturedGrnReceivedEvents() {
        return mockingDetails(eventPublisher).getInvocations().stream()
                .filter(i -> "publish".equals(i.getMethod().getName()))
                .filter(i -> PurchasingEventContract.GRN_RECEIVED.equals(i.getArgument(2)))
                .count();
    }

    /**
     * The GRN must carry the vendor's pack size and pack unit, not just a bare quantity.
     *
     * <p>Purchasing quantities are in the vendor's ORDER unit — a case, a sack, a carton. Without
     * those two fields inventory has no way to know that "4" means 20&nbsp;kg, so a receipt of four
     * 5&nbsp;kg cases of a gram-stocked ingredient added 4 to {@code qty_on_hand} and priced one
     * gram at the cost of a whole case. Purchasing supplies the pack size because it is catalog
     * data; inventory converts the pack unit to the stock unit because it owns the unit registry.
     */
    @Test
    void grnEvent_carriesThePackSizeAndPackUnitFromTheVendorCatalog() {
        UUID tenantId = tenantContext.requireTenantId();
        VendorItem catalogItem = new VendorItem();
        catalogItem.setTenantId(tenantId);
        catalogItem.setVendorId(purchaseOrderRepository.findById(poId).orElseThrow().getVendorId());
        catalogItem.setIngredientId(lineRepository.findById(lineId).orElseThrow().getIngredientId());
        catalogItem.setVendorSku("SKU-CASE-5KG");
        catalogItem.setOrderUom("CASE");
        catalogItem.setPackQty(new BigDecimal("5"));
        catalogItem.setPackUom("KG");
        catalogItem.setPackUnitsPerOrderUnit(new BigDecimal("5"));
        catalogItem = vendorItemRepository.save(catalogItem);

        PurchaseOrderLine line = lineRepository.findById(lineId).orElseThrow();
        line.setVendorItemId(catalogItem.getId());
        lineRepository.save(line);

        grnReceiptSimulator.simulateReceive(poId,
                new MockReceiveRequest(List.of(new MockReceiveRequest.Line(lineId, new BigDecimal("4")))),
                "idem-pack");

        PurchasingEventContract.GrnLine published = publishedGrnLine();
        assertThat(published.qtyPerOrderUnit())
                .as("inventory cannot convert a quantity whose pack size it was never told")
                .isEqualByComparingTo("5");
        assertThat(published.qtyUomCode())
                .as("the PACK unit, never orderUom — the price is already quoted per CASE")
                .isEqualTo("KG");

        // The two helpers on the contract, on real data: 4 cases of 5 kg at PKR 3,100.00 a case.
        assertThat(published.qtyInPackUom()).isEqualByComparingTo("20");
        assertThat(published.unitCostPerPackUomPaisa()).isEqualByComparingTo("200");
    }

    /** A hand-typed line has no catalog row; the event must still publish, with no pack factor. */
    @Test
    void lineWithoutACatalogRow_publishesWithNoPackFactor() {
        grnReceiptSimulator.simulateReceive(poId,
                new MockReceiveRequest(List.of(new MockReceiveRequest.Line(lineId, BigDecimal.TEN))),
                "idem-nocatalog");

        PurchasingEventContract.GrnLine published = publishedGrnLine();
        assertThat(published.qtyPerOrderUnit()).isNull();
        assertThat(published.qtyUomCode())
                .as("the line's own uom is the only unit anyone stated")
                .isEqualTo("kg");
        assertThat(published.qtyInPackUom())
                .as("no pack size means one — exactly what every receipt did before this existed")
                .isEqualByComparingTo("10");
    }

    private PurchasingEventContract.GrnLine publishedGrnLine() {
        ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
        verify(eventPublisher).publish(
                eq(PurchasingEventContract.EXCHANGE),
                eq(PurchasingEventContract.GRN_RECEIVED_KEY),
                eq(PurchasingEventContract.GRN_RECEIVED),
                any(), payload.capture());
        return ((PurchasingEventContract.GrnReceivedPayload) payload.getValue()).lines().getFirst();
    }
}
