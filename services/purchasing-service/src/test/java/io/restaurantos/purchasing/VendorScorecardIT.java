package io.restaurantos.purchasing;

import io.restaurantos.purchasing.domain.enums.InvoiceStatus;
import io.restaurantos.purchasing.domain.enums.PoStatus;
import io.restaurantos.purchasing.domain.model.MockGrnReceipt;
import io.restaurantos.purchasing.domain.model.PurchaseOrder;
import io.restaurantos.purchasing.domain.model.PurchaseOrderLine;
import io.restaurantos.purchasing.domain.model.Vendor;
import io.restaurantos.purchasing.domain.model.VendorInvoice;
import io.restaurantos.purchasing.domain.model.VendorInvoiceLine;
import io.restaurantos.purchasing.dto.VendorScorecardDto;
import io.restaurantos.purchasing.repository.MockGrnReceiptRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderLineRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderRepository;
import io.restaurantos.purchasing.repository.VendorInvoiceRepository;
import io.restaurantos.purchasing.repository.VendorRepository;
import io.restaurantos.purchasing.service.VendorAnalyticsService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

/**
 * PUR-05: proves the scorecard's third metric — spend-weighted price variance per vendor — alongside
 * its two pre-existing metrics (on-time delivery, fill rate), which must not regress.
 */
class VendorScorecardIT extends PurchasingTestBase {

    @Autowired
    private VendorAnalyticsService vendorAnalyticsService;

    @Autowired
    private VendorRepository vendorRepository;

    @Autowired
    private PurchaseOrderRepository purchaseOrderRepository;

    @Autowired
    private PurchaseOrderLineRepository lineRepository;

    @Autowired
    private MockGrnReceiptRepository mockGrnReceiptRepository;

    @Autowired
    private VendorInvoiceRepository invoiceRepository;

    @Autowired
    private TenantContext tenantContext;

    private UUID tenantId;
    private UUID branchId;
    private UUID vendorId;
    private PurchaseOrder po;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);

        Vendor vendor = new Vendor();
        vendor.setTenantId(tenantId);
        vendor.setName("Variance Vendor");
        vendor.setPaymentTerms("NET30");
        vendor = vendorRepository.save(vendor);
        vendorId = vendor.getId();

        po = new PurchaseOrder();
        po.setTenantId(tenantId);
        po.setVendorId(vendorId);
        po.setBranchId(branchId);
        po.setStatus(PoStatus.SENT);
        po.setExpectedDeliveryDate(LocalDate.now().plusDays(1));
        po.setTotalPaisa(0L);
        po = purchaseOrderRepository.save(po);

        // Full mock receipt, received before the deadline -> on-time & filled.
        MockGrnReceipt receipt = new MockGrnReceipt();
        receipt.setTenantId(tenantId);
        receipt.setPurchaseOrderId(po.getId());
        receipt.setPoLineId(UUID.randomUUID());
        receipt.setGrnId(UUID.randomUUID());
        receipt.setReceivedQty(BigDecimal.TEN);
        receipt.setReceivedAt(Instant.now());
        mockGrnReceiptRepository.save(receipt);
    }

    @Test
    void scorecard_computesSpendWeightedPriceVariance_withoutRegressingOtherMetrics() {
        // Small line: PO price 1000, invoice price 1050 -> +5% variance, weight 10,500.
        PurchaseOrderLine smallPoLine = newPoLine(1000L, BigDecimal.TEN);
        // Large line: PO price 1000, invoice price 1000 (0% variance), weight 1,000,000 -> dominates the mean.
        PurchaseOrderLine largePoLine = newPoLine(1000L, BigDecimal.valueOf(1000));

        VendorInvoice invoice = new VendorInvoice();
        invoice.setTenantId(tenantId);
        invoice.setVendorId(vendorId);
        invoice.setPurchaseOrderId(po.getId());
        invoice.setBranchId(branchId);
        invoice.setInvoiceNo("INV-VARIANCE-1");
        invoice.setInvoiceDate(LocalDate.now());
        invoice.setStatus(InvoiceStatus.MATCHED);
        invoice.setInputTaxPaisa(0L);

        addLine(invoice, smallPoLine.getId(), 1050L, BigDecimal.TEN, 10_500L);
        addLine(invoice, largePoLine.getId(), 1000L, BigDecimal.valueOf(1000), 1_000_000L);
        invoice.setTotalPaisa(10_500L + 1_000_000L);
        invoiceRepository.save(invoice);

        VendorScorecardDto scorecard = vendorAnalyticsService.scorecard(vendorId, branchId);

        // Weighted mean = (5.0 * 10,500 + 0.0 * 1,000,000) / 1,010,500 ≈ 0.052% — far below the naive
        // (unweighted) average of 2.5%, proving the large near-zero-variance line dominates the mean.
        assertThat(scorecard.priceVariancePct()).isCloseTo(0.052, within(0.05));
        assertThat(scorecard.priceVariancePct()).isLessThan(1.0);

        // PUR-05's first two metrics must not regress: 1 PO, 1 receipt before the deadline.
        assertThat(scorecard.fillRatePct()).isEqualTo(100.0);
        assertThat(scorecard.onTimeDeliveryPct()).isEqualTo(100.0);
    }

    @Test
    void scorecard_returnsZeroVariance_whenVendorHasNoQualifyingLines() {
        VendorScorecardDto scorecard = vendorAnalyticsService.scorecard(vendorId, branchId);

        assertThat(scorecard.priceVariancePct()).isEqualTo(0.0);
    }

    private PurchaseOrderLine newPoLine(long unitPricePaisa, BigDecimal qty) {
        PurchaseOrderLine line = new PurchaseOrderLine();
        line.setTenantId(tenantId);
        line.setPurchaseOrder(po);
        line.setIngredientId(UUID.randomUUID());
        line.setQty(qty);
        line.setUom("kg");
        line.setUnitPricePaisa(unitPricePaisa);
        line.setLineTotalPaisa(qty.multiply(BigDecimal.valueOf(unitPricePaisa)).longValue());
        return lineRepository.save(line);
    }

    private void addLine(VendorInvoice invoice, UUID poLineId, long unitPricePaisa, BigDecimal qty, long lineTotalPaisa) {
        VendorInvoiceLine line = new VendorInvoiceLine();
        line.setTenantId(tenantId);
        line.setInvoice(invoice);
        line.setPoLineId(poLineId);
        line.setQty(qty);
        line.setUnitPricePaisa(unitPricePaisa);
        line.setLineTotalPaisa(lineTotalPaisa);
        invoice.getLines().add(line);
    }
}
