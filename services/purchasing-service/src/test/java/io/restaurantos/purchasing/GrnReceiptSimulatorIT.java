package io.restaurantos.purchasing;

import io.restaurantos.purchasing.domain.enums.LineMatchStatus;
import io.restaurantos.purchasing.domain.model.MockGrnReceipt;
import io.restaurantos.purchasing.domain.model.PurchaseOrder;
import io.restaurantos.purchasing.domain.model.PurchaseOrderLine;
import io.restaurantos.purchasing.domain.model.VendorInvoiceLine;
import io.restaurantos.purchasing.dto.MockReceiveRequest;
import io.restaurantos.purchasing.domain.model.Vendor;
import io.restaurantos.purchasing.repository.MockGrnReceiptRepository;
import io.restaurantos.purchasing.repository.VendorRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderLineRepository;
import io.restaurantos.purchasing.repository.PurchaseOrderRepository;
import io.restaurantos.purchasing.service.GrnReceiptSimulator;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
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

    @Test
    void simulateReceive_postsFinanceOnce() {
        grnReceiptSimulator.simulateReceive(poId,
                new MockReceiveRequest(List.of(new MockReceiveRequest.Line(lineId, BigDecimal.TEN))),
                "idem-1");

        assertThat(mockGrnReceiptRepository.sumReceivedQtyByPoLineId(lineId)).isEqualByComparingTo(BigDecimal.TEN);
        verify(financeInternalClient, times(1)).autoPost(any(), any());

        grnReceiptSimulator.simulateReceive(poId,
                new MockReceiveRequest(List.of(new MockReceiveRequest.Line(lineId, BigDecimal.TEN))),
                "idem-1");
        verify(financeInternalClient, times(1)).autoPost(any(), any());
    }
}
