package io.restaurantos.purchasing;

import io.restaurantos.purchasing.domain.enums.LineMatchStatus;
import io.restaurantos.purchasing.domain.model.MockGrnReceipt;
import io.restaurantos.purchasing.domain.model.PurchaseOrder;
import io.restaurantos.purchasing.domain.model.PurchaseOrderLine;
import io.restaurantos.purchasing.domain.model.VendorInvoiceLine;
import io.restaurantos.purchasing.domain.model.Vendor;
import io.restaurantos.purchasing.repository.MockGrnReceiptRepository;
import io.restaurantos.purchasing.repository.VendorRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderLineRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderRepository;
import io.restaurantos.purchasing.service.ThreeWayMatchService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class ThreeWayMatchIT extends PurchasingTestBase {

    @Autowired
    private ThreeWayMatchService matchService;

    @Autowired
    private PurchaseOrderRepository purchaseOrderRepository;

    @Autowired
    private PurchaseOrderLineRepository lineRepository;

    @Autowired
    private VendorRepository vendorRepository;

    @Autowired
    private MockGrnReceiptRepository mockGrnReceiptRepository;

    @Autowired
    private TenantContext tenantContext;

    private PurchaseOrderLine poLine;
    private UUID poId;

    @BeforeEach
    void setUp() {
        tenantContext.set(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), null);
        Vendor vendor = new Vendor();
        vendor.setTenantId(tenantContext.requireTenantId());
        vendor.setName("Match Vendor");
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

        poLine = new PurchaseOrderLine();
        poLine.setTenantId(po.getTenantId());
        poLine.setPurchaseOrder(po);
        poLine.setIngredientId(UUID.randomUUID());
        poLine.setQty(BigDecimal.valueOf(100));
        poLine.setUom("kg");
        poLine.setUnitPricePaisa(1000L);
        poLine.setLineTotalPaisa(100_000L);
        poLine = lineRepository.save(poLine);
    }

    @Test
    void f4_missingGrn() {
        VendorInvoiceLine invoiceLine = invoiceLine(BigDecimal.valueOf(100), 1000L);
        assertThat(matchService.matchLine(invoiceLine)).isEqualTo(LineMatchStatus.MISSING_GRN);
    }

    @Test
    void f6_priceDrift() {
        seedGrn(BigDecimal.valueOf(100));
        VendorInvoiceLine invoiceLine = invoiceLine(BigDecimal.valueOf(100), 1050L);
        assertThat(matchService.matchLine(invoiceLine)).isEqualTo(LineMatchStatus.PRICE_OVER);
    }

    @Test
    void f1_happyMatch() {
        seedGrn(BigDecimal.valueOf(100));
        VendorInvoiceLine invoiceLine = invoiceLine(BigDecimal.valueOf(100), 1000L);
        assertThat(matchService.matchLine(invoiceLine)).isEqualTo(LineMatchStatus.OK);
    }

    private void seedGrn(BigDecimal qty) {
        MockGrnReceipt receipt = new MockGrnReceipt();
        receipt.setTenantId(tenantContext.requireTenantId());
        receipt.setPurchaseOrderId(poId);
        receipt.setPoLineId(poLine.getId());
        receipt.setGrnId(UUID.randomUUID());
        receipt.setReceivedQty(qty);
        receipt.setReceivedAt(Instant.now());
        mockGrnReceiptRepository.save(receipt);
    }

    private VendorInvoiceLine invoiceLine(BigDecimal qty, long unitPrice) {
        VendorInvoiceLine line = new VendorInvoiceLine();
        line.setTenantId(tenantContext.requireTenantId());
        line.setPoLineId(poLine.getId());
        line.setQty(qty);
        line.setUnitPricePaisa(unitPrice);
        line.setLineTotalPaisa(qty.multiply(BigDecimal.valueOf(unitPrice)).longValue());
        return line;
    }
}
