package io.restaurantos.purchasing;

import io.restaurantos.purchasing.domain.enums.PoStatus;
import io.restaurantos.purchasing.dto.CreatePurchaseOrderRequest;
import io.restaurantos.purchasing.dto.CreateVendorRequest;
import io.restaurantos.purchasing.dto.MockReceiveRequest;
import io.restaurantos.purchasing.dto.PurchaseOrderDto;
import io.restaurantos.purchasing.dto.VendorDto;
import io.restaurantos.purchasing.exception.ApprovalLimitExceededException;
import io.restaurantos.purchasing.exception.InvalidPoStateException;
import io.restaurantos.purchasing.feign.AuthorizationClient;
import io.restaurantos.purchasing.service.GrnReceiptSimulator;
import io.restaurantos.purchasing.service.PoApprovalService;
import io.restaurantos.purchasing.service.PurchaseOrderService;
import io.restaurantos.purchasing.service.VendorService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

class PurchaseOrderCloseIT extends PurchasingTestBase {

    @Autowired
    private VendorService vendorService;

    @Autowired
    private PurchaseOrderService purchaseOrderService;

    @Autowired
    private PoApprovalService poApprovalService;

    @Autowired
    private GrnReceiptSimulator grnReceiptSimulator;

    @Autowired
    private TenantContext tenantContext;

    private UUID tenantId;
    private UUID branchId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);
        when(featureFlagService.isEnabled(any(), any())).thenReturn(true);
    }

    private PurchaseOrderDto createSentPo(BigDecimal qty) {
        when(authorizationClient.authorize(any())).thenReturn(
                ApiResponse.ok(new AuthorizationClient.AuthorizeResult(true, null)));

        VendorDto vendor = vendorService.create(new CreateVendorRequest(
                "Supplier Co", null, null, null, null, "NET30", null, null, null, null, null));

        PurchaseOrderDto po = purchaseOrderService.create(new CreatePurchaseOrderRequest(
                vendor.id(), branchId, null, null,
                List.of(new CreatePurchaseOrderRequest.Line(
                        UUID.randomUUID(), qty, "kg", 1000L))));

        purchaseOrderService.submit(po.id());
        poApprovalService.approve(po.id());
        return purchaseOrderService.send(po.id());
    }

    @Test
    void fullyReceived_close_transitionsToClosed() {
        PurchaseOrderDto sent = createSentPo(BigDecimal.TEN);
        UUID lineId = sent.lines().get(0).id();

        grnReceiptSimulator.simulateReceive(sent.id(),
                new MockReceiveRequest(List.of(new MockReceiveRequest.Line(lineId, BigDecimal.TEN))),
                "close-idem-full");

        PurchaseOrderDto received = purchaseOrderService.get(sent.id());
        assertThat(received.status()).isEqualTo(PoStatus.FULLY_RECEIVED);

        PurchaseOrderDto closed = purchaseOrderService.close(sent.id(), null);
        assertThat(closed.status()).isEqualTo(PoStatus.CLOSED);
        assertThat(closed.closedAt()).isNotNull();
    }

    @Test
    void partiallyReceived_shortClose_requiresReason() {
        PurchaseOrderDto sent = createSentPo(BigDecimal.TEN);
        UUID lineId = sent.lines().get(0).id();

        grnReceiptSimulator.simulateReceive(sent.id(),
                new MockReceiveRequest(List.of(new MockReceiveRequest.Line(lineId, BigDecimal.valueOf(5)))),
                "close-idem-partial-1");

        PurchaseOrderDto received = purchaseOrderService.get(sent.id());
        assertThat(received.status()).isEqualTo(PoStatus.PARTIALLY_RECEIVED);

        assertThatThrownBy(() -> purchaseOrderService.close(sent.id(), null))
                .isInstanceOf(InvalidPoStateException.class);
    }

    @Test
    void partiallyReceived_shortClose_withReasonAndOpaAllow_closes() {
        PurchaseOrderDto sent = createSentPo(BigDecimal.TEN);
        UUID lineId = sent.lines().get(0).id();

        grnReceiptSimulator.simulateReceive(sent.id(),
                new MockReceiveRequest(List.of(new MockReceiveRequest.Line(lineId, BigDecimal.valueOf(5)))),
                "close-idem-partial-2");

        when(authorizationClient.authorize(any())).thenReturn(
                ApiResponse.ok(new AuthorizationClient.AuthorizeResult(true, null)));

        PurchaseOrderDto closed = purchaseOrderService.close(sent.id(), "Vendor cannot fulfil remainder");
        assertThat(closed.status()).isEqualTo(PoStatus.CLOSED);
        assertThat(closed.closeReason()).isEqualTo("Vendor cannot fulfil remainder");
    }

    @Test
    void partiallyReceived_shortClose_opaDenied() {
        PurchaseOrderDto sent = createSentPo(BigDecimal.TEN);
        UUID lineId = sent.lines().get(0).id();

        grnReceiptSimulator.simulateReceive(sent.id(),
                new MockReceiveRequest(List.of(new MockReceiveRequest.Line(lineId, BigDecimal.valueOf(5)))),
                "close-idem-partial-3");

        when(authorizationClient.authorize(any())).thenReturn(
                ApiResponse.ok(new AuthorizationClient.AuthorizeResult(false, "limit")));

        assertThatThrownBy(() -> purchaseOrderService.close(sent.id(), "Vendor cannot fulfil remainder"))
                .isInstanceOf(ApprovalLimitExceededException.class);
    }

    @Test
    void sentPo_close_rejected() {
        PurchaseOrderDto sent = createSentPo(BigDecimal.TEN);

        assertThatThrownBy(() -> purchaseOrderService.close(sent.id(), null))
                .isInstanceOf(InvalidPoStateException.class);
    }
}
