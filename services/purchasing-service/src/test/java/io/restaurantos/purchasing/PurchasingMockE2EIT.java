package io.restaurantos.purchasing;

import io.restaurantos.purchasing.domain.enums.InvoiceStatus;
import io.restaurantos.purchasing.domain.enums.PoStatus;
import io.restaurantos.purchasing.dto.CreateApPaymentRequest;
import io.restaurantos.purchasing.dto.CreatePurchaseOrderRequest;
import io.restaurantos.purchasing.dto.CreateVendorInvoiceRequest;
import io.restaurantos.purchasing.dto.CreateVendorRequest;
import io.restaurantos.purchasing.dto.MockReceiveRequest;
import io.restaurantos.purchasing.dto.PurchaseOrderDto;
import io.restaurantos.purchasing.dto.VendorDto;
import io.restaurantos.purchasing.dto.VendorInvoiceDto;
import io.restaurantos.purchasing.feign.AuthorizationClient;
import io.restaurantos.purchasing.service.ApPaymentService;
import io.restaurantos.purchasing.service.GrnReceiptSimulator;
import io.restaurantos.purchasing.service.PoApprovalService;
import io.restaurantos.purchasing.service.PurchaseOrderService;
import io.restaurantos.purchasing.service.VendorInvoiceService;
import io.restaurantos.purchasing.service.VendorService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

class PurchasingMockE2EIT extends PurchasingTestBase {

    @Autowired
    private VendorService vendorService;
    @Autowired
    private PurchaseOrderService purchaseOrderService;
    @Autowired
    private PoApprovalService poApprovalService;
    @Autowired
    private GrnReceiptSimulator grnReceiptSimulator;
    @Autowired
    private VendorInvoiceService vendorInvoiceService;
    @Autowired
    private ApPaymentService apPaymentService;
    @Autowired
    private TenantContext tenantContext;

    private UUID branchId;
    private PurchaseOrderDto po;

    @BeforeEach
    void setUp() {
        branchId = UUID.randomUUID();
        tenantContext.set(UUID.randomUUID(), branchId, UUID.randomUUID(), null);
        when(featureFlagService.isEnabled(any(), any())).thenReturn(true);
        when(authorizationClient.authorize(any())).thenReturn(
                ApiResponse.ok(new AuthorizationClient.AuthorizeResult(true, null)));
        when(financeInternalClient.autoPost(any(), any())).thenReturn(
                ApiResponse.ok(new io.restaurantos.purchasing.feign.FinanceInternalClient.JePostResponse(
                        UUID.randomUUID(), "JE-1")));

        VendorDto vendor = vendorService.create(new CreateVendorRequest(
                "Fresh Foods", null, null, null, null, "NET30", null, null, null, null, null));
        po = purchaseOrderService.create(new CreatePurchaseOrderRequest(
                vendor.id(), branchId, LocalDate.now().plusDays(1), null,
                List.of(new CreatePurchaseOrderRequest.Line(
                        UUID.randomUUID(), BigDecimal.valueOf(100), "kg", 1000L))));
        po = purchaseOrderService.submit(po.id());
        po = poApprovalService.approve(po.id());
        po = purchaseOrderService.send(po.id());
    }

    @Test
    void f1_fullFlow() {
        UUID lineId = po.lines().getFirst().id();
        grnReceiptSimulator.simulateReceive(po.id(),
                new MockReceiveRequest(List.of(new MockReceiveRequest.Line(lineId, BigDecimal.valueOf(100)))),
                "grn-f1");

        VendorInvoiceDto invoice = vendorInvoiceService.create(new CreateVendorInvoiceRequest(
                po.id(), "INV-F1", LocalDate.now(), 0L,
                List.of(new CreateVendorInvoiceRequest.Line(lineId, BigDecimal.valueOf(100), 1000L))));
        assertThat(invoice.status()).isEqualTo(InvoiceStatus.MATCHED);

        apPaymentService.create(new CreateApPaymentRequest(
                invoice.id(), LocalDate.now(), null, "1110"), "pay-f1");
        VendorInvoiceDto paid = vendorInvoiceService.get(invoice.id());
        assertThat(paid.status()).isEqualTo(InvoiceStatus.PAID);
    }

    @Test
    void f4_noGrn_mismatched() {
        UUID lineId = po.lines().getFirst().id();
        VendorInvoiceDto invoice = vendorInvoiceService.create(new CreateVendorInvoiceRequest(
                po.id(), "INV-F4", LocalDate.now(), 0L,
                List.of(new CreateVendorInvoiceRequest.Line(lineId, BigDecimal.valueOf(100), 1000L))));
        assertThat(invoice.status()).isEqualTo(InvoiceStatus.MISMATCHED);
        assertThat(invoice.lines().getFirst().matchStatus().name()).isEqualTo("MISSING_GRN");
    }

    @Test
    void f6_priceDrift_mismatchedUntilOverride() {
        UUID lineId = po.lines().getFirst().id();
        grnReceiptSimulator.simulateReceive(po.id(),
                new MockReceiveRequest(List.of(new MockReceiveRequest.Line(lineId, BigDecimal.valueOf(100)))),
                "grn-f6");

        VendorInvoiceDto invoice = vendorInvoiceService.create(new CreateVendorInvoiceRequest(
                po.id(), "INV-F6", LocalDate.now(), 0L,
                List.of(new CreateVendorInvoiceRequest.Line(lineId, BigDecimal.valueOf(100), 1050L))));
        assertThat(invoice.status()).isEqualTo(InvoiceStatus.MISMATCHED);

        VendorInvoiceDto overridden = vendorInvoiceService.overrideMatch(invoice.id(), "Manager approved variance");
        assertThat(overridden.status()).isEqualTo(InvoiceStatus.APPROVED_FOR_PAYMENT);
    }
}
