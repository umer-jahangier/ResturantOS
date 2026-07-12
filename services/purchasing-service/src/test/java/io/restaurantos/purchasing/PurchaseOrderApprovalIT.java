package io.restaurantos.purchasing;

import io.restaurantos.purchasing.domain.enums.PoStatus;
import io.restaurantos.purchasing.dto.CreatePurchaseOrderRequest;
import io.restaurantos.purchasing.dto.CreateVendorRequest;
import io.restaurantos.purchasing.dto.PurchaseOrderDto;
import io.restaurantos.purchasing.dto.VendorDto;
import io.restaurantos.purchasing.exception.ApprovalLimitExceededException;
import io.restaurantos.purchasing.exception.DuplicateApproverException;
import io.restaurantos.purchasing.feign.AuthorizationClient;
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

class PurchaseOrderApprovalIT extends PurchasingTestBase {

    @Autowired
    private VendorService vendorService;

    @Autowired
    private PurchaseOrderService purchaseOrderService;

    @Autowired
    private PoApprovalService poApprovalService;

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

    @Test
    void submitApprove_happyPath() {
        when(authorizationClient.authorize(any())).thenReturn(
                ApiResponse.ok(new AuthorizationClient.AuthorizeResult(true, null)));

        VendorDto vendor = vendorService.create(new CreateVendorRequest(
                "Supplier Co", null, null, null, null, "NET30", null, null, null, null, null));

        PurchaseOrderDto po = purchaseOrderService.create(new CreatePurchaseOrderRequest(
                vendor.id(), branchId, null, null,
                List.of(new CreatePurchaseOrderRequest.Line(
                        UUID.randomUUID(), BigDecimal.TEN, "kg", 1000L))));

        PurchaseOrderDto submitted = purchaseOrderService.submit(po.id());
        assertThat(submitted.status()).isEqualTo(PoStatus.PENDING_APPROVAL);

        PurchaseOrderDto approved = poApprovalService.approve(po.id());
        assertThat(approved.status()).isEqualTo(PoStatus.APPROVED);
    }

    @Test
    void approve_deniedByOpa() {
        when(authorizationClient.authorize(any())).thenReturn(
                ApiResponse.ok(new AuthorizationClient.AuthorizeResult(false, "limit")));

        VendorDto vendor = vendorService.create(new CreateVendorRequest(
                "Supplier Co", null, null, null, null, "NET30", null, null, null, null, null));

        PurchaseOrderDto po = purchaseOrderService.create(new CreatePurchaseOrderRequest(
                vendor.id(), branchId, null, null,
                List.of(new CreatePurchaseOrderRequest.Line(
                        UUID.randomUUID(), BigDecimal.ONE, "kg", 1000L))));

        purchaseOrderService.submit(po.id());
        assertThatThrownBy(() -> poApprovalService.approve(po.id()))
                .isInstanceOf(ApprovalLimitExceededException.class);
    }

    @Test
    void twoTierPo_sameApproverTwice_rejectedAsDuplicate() {
        when(authorizationClient.authorize(any())).thenReturn(
                ApiResponse.ok(new AuthorizationClient.AuthorizeResult(true, null)));

        VendorDto vendor = vendorService.create(new CreateVendorRequest(
                "Supplier Co", null, null, null, null, "NET30", null, null, null, null, null));

        // 60,000,00 paisa lands in tier 2 (500,000.01 - 2,000,000.00 paisa) -> requiredTiers == 2
        PurchaseOrderDto po = purchaseOrderService.create(new CreatePurchaseOrderRequest(
                vendor.id(), branchId, null, null,
                List.of(new CreatePurchaseOrderRequest.Line(
                        UUID.randomUUID(), BigDecimal.TEN, "kg", 6_000_000L))));

        PurchaseOrderDto submitted = purchaseOrderService.submit(po.id());
        assertThat(submitted.requiredTiers()).isEqualTo(2);

        PurchaseOrderDto afterFirstApproval = poApprovalService.approve(po.id());
        assertThat(afterFirstApproval.tiersApproved()).isEqualTo(1);
        assertThat(afterFirstApproval.status()).isEqualTo(PoStatus.PENDING_APPROVAL);

        assertThatThrownBy(() -> poApprovalService.approve(po.id()))
                .isInstanceOf(DuplicateApproverException.class);

        PurchaseOrderDto unchanged = purchaseOrderService.get(po.id());
        assertThat(unchanged.tiersApproved()).isEqualTo(1);
        assertThat(unchanged.status()).isEqualTo(PoStatus.PENDING_APPROVAL);
    }

    @Test
    void twoTierPo_distinctApprovers_approvesFully() {
        when(authorizationClient.authorize(any())).thenReturn(
                ApiResponse.ok(new AuthorizationClient.AuthorizeResult(true, null)));

        VendorDto vendor = vendorService.create(new CreateVendorRequest(
                "Supplier Co", null, null, null, null, "NET30", null, null, null, null, null));

        PurchaseOrderDto po = purchaseOrderService.create(new CreatePurchaseOrderRequest(
                vendor.id(), branchId, null, null,
                List.of(new CreatePurchaseOrderRequest.Line(
                        UUID.randomUUID(), BigDecimal.TEN, "kg", 6_000_000L))));

        PurchaseOrderDto submitted = purchaseOrderService.submit(po.id());
        assertThat(submitted.requiredTiers()).isEqualTo(2);

        poApprovalService.approve(po.id());

        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);
        PurchaseOrderDto approved = poApprovalService.approve(po.id());
        assertThat(approved.tiersApproved()).isEqualTo(2);
        assertThat(approved.status()).isEqualTo(PoStatus.APPROVED);
    }
}
