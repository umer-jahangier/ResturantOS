package io.restaurantos.purchasing;

import io.restaurantos.purchasing.domain.enums.PoStatus;
import io.restaurantos.purchasing.dto.CreatePurchaseOrderRequest;
import io.restaurantos.purchasing.dto.CreateVendorRequest;
import io.restaurantos.purchasing.dto.MockReceiveRequest;
import io.restaurantos.purchasing.dto.PurchaseOrderDto;
import io.restaurantos.purchasing.dto.VendorDto;
import io.restaurantos.purchasing.exception.ApprovalLimitExceededException;
import io.restaurantos.purchasing.opa.OpaBackedAuthorizationClient;
import io.restaurantos.purchasing.opa.RealOpaTestConfig;
import io.restaurantos.purchasing.opa.TestPrincipal;
import io.restaurantos.purchasing.service.GrnReceiptSimulator;
import io.restaurantos.purchasing.service.PoApprovalService;
import io.restaurantos.purchasing.service.PurchaseOrderService;
import io.restaurantos.purchasing.service.VendorService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 10-08: proves PO approve and PO short-close are decided by a REAL OPA container running the
 * REAL {@code policies/} bundle — not a mock. This is the fix for standing lesson 10-06-A:
 * {@link PurchaseOrderApprovalIT} and {@link PurchaseOrderCloseIT} both {@code @MockitoBean} the
 * {@code AuthorizationClient} and stub {@code allow=true}, which is exactly how 18 green ITs
 * coexisted with a policy that denied 100% of real requests (the action-string mismatch fixed
 * in 10-07). No {@code @MockitoBean AuthorizationClient} is declared in this class. The
 * {@code authorizationClient} mock field is inherited from {@link PurchasingTestBase} (removing
 * it would require touching a shared base class used by every other purchasing IT), but it is
 * never stubbed with a canned {@code allow=true/false} answer here — {@link #setUp()} wires it
 * to delegate every call to a real {@link OpaBackedAuthorizationClient} talking to the
 * {@link RealOpaTestConfig} Testcontainers OPA instance, so every authorize() call in this class
 * still round-trips through the real {@code policies/} bundle.
 */
@Import(RealOpaTestConfig.class)
class PurchasingOpaPolicyIT extends PurchasingTestBase {

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

    @Autowired
    private TestPrincipal testPrincipal;

    private UUID tenantId;
    private UUID branchId;
    private OpaBackedAuthorizationClient realOpaClient;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);
        when(featureFlagService.isEnabled(any(), any())).thenReturn(true);

        // Delegate every call through to a real OPA-backed implementation instead of stubbing a
        // canned allow/deny — the whole point of this IT is that the real rego decides.
        realOpaClient = new OpaBackedAuthorizationClient(RealOpaTestConfig.opaBaseUrl(), testPrincipal);
        when(authorizationClient.authorize(any())).thenAnswer(inv -> realOpaClient.authorize(inv.getArgument(0)));

        // Default principal: same tenant/branch as the resource, full permission, generous limit.
        // Individual tests narrow this down to exercise a specific deny path.
        setPrincipal(tenantId, branchId, List.of("vendor.po.approve", "vendor.po.close"),
                Map.of("approval_limit_paisa", 100_000_000L));
    }

    private void setPrincipal(UUID tId, UUID bId, List<String> permissions, Map<String, Object> attributes) {
        testPrincipal.setUserId(UUID.randomUUID());
        testPrincipal.setTenantId(tId);
        testPrincipal.setBranchId(bId);
        testPrincipal.setPermissions(permissions);
        testPrincipal.setAttributes(attributes);
    }

    private PurchaseOrderDto createSubmittedPo(long unitPricePaisa) {
        VendorDto vendor = vendorService.create(new CreateVendorRequest(
                "Supplier Co", null, null, null, null, "NET30", null, null, null, null, null));

        PurchaseOrderDto po = purchaseOrderService.create(new CreatePurchaseOrderRequest(
                vendor.id(), branchId, null, null,
                List.of(new CreatePurchaseOrderRequest.Line(
                        UUID.randomUUID(), BigDecimal.TEN, "kg", unitPricePaisa))));

        return purchaseOrderService.submit(po.id());
    }

    private PurchaseOrderDto createPartiallyReceivedPo() {
        setPrincipal(tenantId, branchId, List.of("vendor.po.approve"),
                Map.of("approval_limit_paisa", 100_000_000L));

        PurchaseOrderDto submitted = createSubmittedPo(1_000L);
        poApprovalService.approve(submitted.id());
        PurchaseOrderDto sent = purchaseOrderService.send(submitted.id());

        UUID lineId = sent.lines().get(0).id();
        grnReceiptSimulator.simulateReceive(sent.id(),
                new MockReceiveRequest(List.of(new MockReceiveRequest.Line(lineId, BigDecimal.valueOf(5)))),
                "opa-it-" + UUID.randomUUID());

        PurchaseOrderDto received = purchaseOrderService.get(sent.id());
        assertThat(received.status()).isEqualTo(PoStatus.PARTIALLY_RECEIVED);
        return received;
    }

    // ---- approve_po ----

    @Test
    void approve_allowedByRealPolicy_whenWithinApprovalLimit() {
        // Principal has vendor.po.approve and approval_limit_paisa (100,000,000) well above
        // the PO total (10,000 paisa). Sent action is "approve_po" (PoApprovalService's
        // OPA_ACTION_APPROVE_PO constant). MUST FAIL if that constant is reverted to the dotted
        // permission code "vendor.po.approve" — vendor.rego's approve_po rule only matches the
        // short verb, so a reverted action string hits `default allow := false` and this
        // assertion turns red. (Verified manually — see 10-08-SUMMARY.md negative control.)
        PurchaseOrderDto submitted = createSubmittedPo(1_000L);

        PurchaseOrderDto approved = poApprovalService.approve(submitted.id());

        assertThat(approved.status()).isEqualTo(PoStatus.APPROVED);
    }

    @Test
    void approve_deniedByRealPolicy_whenOverApprovalLimit() {
        setPrincipal(tenantId, branchId, List.of("vendor.po.approve"),
                Map.of("approval_limit_paisa", 1L));

        PurchaseOrderDto submitted = createSubmittedPo(1_000L);

        assertThatThrownBy(() -> poApprovalService.approve(submitted.id()))
                .isInstanceOf(ApprovalLimitExceededException.class);

        PurchaseOrderDto unchanged = purchaseOrderService.get(submitted.id());
        assertThat(unchanged.status()).isEqualTo(PoStatus.PENDING_APPROVAL);
        verify(eventPublisher, never()).publish(any(), any(), eq("PO_APPROVED"), any(), any());
    }

    @Test
    void approve_deniedByRealPolicy_whenPermissionMissing() {
        setPrincipal(tenantId, branchId, List.of(),
                Map.of("approval_limit_paisa", 100_000_000L));

        PurchaseOrderDto submitted = createSubmittedPo(1_000L);

        assertThatThrownBy(() -> poApprovalService.approve(submitted.id()))
                .isInstanceOf(ApprovalLimitExceededException.class);
        assertThat(purchaseOrderService.get(submitted.id()).status()).isEqualTo(PoStatus.PENDING_APPROVAL);
    }

    @Test
    void approve_deniedByRealPolicy_whenCrossTenant() {
        PurchaseOrderDto submitted = createSubmittedPo(1_000L);

        // Resource (the PO) belongs to `tenantId`; principal claims a different tenant.
        setPrincipal(UUID.randomUUID(), branchId, List.of("vendor.po.approve"),
                Map.of("approval_limit_paisa", 100_000_000L));

        assertThatThrownBy(() -> poApprovalService.approve(submitted.id()))
                .isInstanceOf(ApprovalLimitExceededException.class);
        assertThat(purchaseOrderService.get(submitted.id()).status()).isEqualTo(PoStatus.PENDING_APPROVAL);
    }

    // ---- close_po ----

    @Test
    void close_allowedByRealPolicy_forShortClose() {
        PurchaseOrderDto partiallyReceived = createPartiallyReceivedPo();

        setPrincipal(tenantId, branchId, List.of("vendor.po.close"),
                Map.of("approval_limit_paisa", 100_000_000L));

        PurchaseOrderDto closed = purchaseOrderService.close(partiallyReceived.id(), "Vendor cannot fulfil remainder");

        assertThat(closed.status()).isEqualTo(PoStatus.CLOSED);
        assertThat(closed.closeReason()).isEqualTo("Vendor cannot fulfil remainder");
    }

    @Test
    void close_deniedByRealPolicy_whenPermissionMissing() {
        PurchaseOrderDto partiallyReceived = createPartiallyReceivedPo();

        setPrincipal(tenantId, branchId, List.of(),
                Map.of("approval_limit_paisa", 100_000_000L));

        assertThatThrownBy(() -> purchaseOrderService.close(partiallyReceived.id(), "Vendor cannot fulfil remainder"))
                .isInstanceOf(ApprovalLimitExceededException.class);

        assertThat(purchaseOrderService.get(partiallyReceived.id()).status())
                .isEqualTo(PoStatus.PARTIALLY_RECEIVED);
    }
}
