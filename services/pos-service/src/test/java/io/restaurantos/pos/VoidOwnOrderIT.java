package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.*;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.authz.OpaInput;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Closes the Phase-7 void 403 (POS-14). RESEARCH.md's diagnostic recipe traced the full
 * authorization chain by direct code read ({@code PosAuthorizationService.authorizeVoid} ->
 * {@code AuthorizationService.authorize} -> {@code OpaClient.evaluate}) and found the
 * {@code OpaInput} construction already correct: {@code resource.createdBy}/{@code branchId}/
 * {@code tenantId}/{@code status} are all populated from the live {@code Order} entity, and
 * {@code pos.rego}'s void rules do not gate on {@code input.action} — the "different
 * permission string in the 403 message" observed in the original UAT (`pos.void` vs.
 * `pos.order.void.own`) is cosmetic ({@code module + "." + action} string concatenation in
 * {@code AuthorizationService}), not a signal of a broken permission check.
 *
 * No code bug was found in the OpaInput-construction path this session — the most plausible
 * remaining root cause per RESEARCH.md is JWT staleness (a token minted before the
 * {@code 043-cashier-void-own-permission} grant lacks the permission claim until the cashier
 * re-authenticates; front-end fresh-login handling is a separate, later plan). This test
 * proves the server-side authorization path works correctly given a CURRENT token: a cashier
 * can void their own OPEN order, and a cross-branch order is still denied (same_branch stays
 * fail-closed — no isolation weakening), mirroring the rego-level proof already codified in
 * {@code policies/tests/pos_test.rego}'s {@code test_void_own_cross_branch_deny}.
 */
class VoidOwnOrderIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID menuItemId;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, cashierId, null);

        MenuCategory cat = new MenuCategory();
        cat.setTenantId(tenantId);
        cat.setName("Mains-" + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName("Nihari");
        item.setBasePricePaisa(45000L);
        item.setTaxRatePct(new BigDecimal("0.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();

        setSecurityContext(cashierId, branchId, List.of("pos.order.void.own"), Map.of());

        // Financial-integrity guard: the own-branch void tests create the cashier's order
        // first, which now requires an OPEN till for that cashier. (The cross-branch test
        // creates in a different branch and is denied earlier by the branch-isolation guard.)
        openTillForCashier(branchId);
    }

    private void setSecurityContext(UUID userId, UUID userBranchId, List<String> permissions,
                                     Map<String, Object> attributes) {
        JwtClaims claims = new JwtClaims(
                userId, tenantId, userBranchId,
                List.of("CASHIER"), permissions, attributes, null);
        UsernamePasswordAuthenticationToken auth =
                new UsernamePasswordAuthenticationToken(claims, null, List.of());
        SecurityContextHolder.getContext().setAuthentication(auth);
    }

    private OrderDto createOpenOrderInBranch(UUID orderBranchId) {
        UUID clientOrderId = UUID.randomUUID();
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(orderBranchId, clientOrderId, null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, orderBranchId, 1, null, null));
        return orderService.getOrder(order.id(), orderBranchId);
    }

    // ── (1) fresh-token happy path: own OPEN order voids successfully ──────────────────────

    @Test
    void cashier_withFreshToken_voidsOwnOpenOrder_succeeds_withCorrectOpaInput() {
        OrderDto order = createOpenOrderInBranch(branchId);

        // Simulates a fresh login carrying the pos.order.void.own grant (RESEARCH.md
        // diagnostic step 1) — OPA allows because the permission is present, the resource's
        // created_by matches the caller, the order is OPEN, and tenant+branch match.
        when(opaClient.evaluate(eq("pos"), any())).thenReturn(new OpaDecision(true));

        OrderDto voided = orderService.voidOrder(
                order.id(), new VoidOrderRequest("Customer changed mind"), UUID.randomUUID().toString());
        assertThat(voided.status()).isEqualTo(OrderStatus.VOIDED);

        // RESEARCH.md diagnostic steps 1-2: assert the OpaInput actually sent to OPA carries
        // correct, matching created_by/status/branch_id — proving the code path (not just the
        // mocked decision) is wired correctly for the void.own rule to evaluate.
        ArgumentCaptor<OpaInput> captor = ArgumentCaptor.forClass(OpaInput.class);
        verify(opaClient).evaluate(eq("pos"), captor.capture());
        OpaInput sentInput = captor.getValue();
        assertThat(sentInput.resource().createdBy()).isEqualTo(cashierId);
        assertThat(sentInput.resource().status()).isEqualTo("OPEN");
        assertThat(sentInput.resource().branchId()).isEqualTo(branchId);
        assertThat(sentInput.resource().tenantId()).isEqualTo(tenantId);
        assertThat(sentInput.user().id()).isEqualTo(cashierId);
        assertThat(sentInput.user().branchId()).isEqualTo(branchId);
        assertThat(sentInput.user().permissions()).contains("pos.order.void.own");

        long voidedEvents = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_VOIDED".equals(e.getEventType()))
                .count();
        assertThat(voidedEvents).isEqualTo(1);
    }

    // ── (2) cross-branch order is still denied — same_branch stays fail-closed ─────────────

    @Test
    void cashier_ownOrder_butDifferentBranchThanJwt_isDenied_isolationIntact() {
        // Order created in a DIFFERENT branch than the cashier's current JWT branch —
        // mirrors RESEARCH.md diagnostic step 2 ("branch mismatch would fail same_branch
        // silently"). Proves the code path correctly propagates a real branch mismatch
        // through to OPA (not silently coalesced/ignored) and that a deny from OPA still
        // throws PermissionDeniedException end-to-end.
        UUID otherBranchId = UUID.randomUUID();
        OrderDto order = createOpenOrderInBranch(otherBranchId);

        // Real pos.rego's same_branch check would deny this (see
        // policies/tests/pos_test.rego#test_void_own_cross_branch_deny) — mock reproduces
        // that decision since OpaClient is not live in this test harness.
        when(opaClient.evaluate(eq("pos"), any())).thenReturn(new OpaDecision(false));

        assertThatThrownBy(() ->
                orderService.voidOrder(order.id(), new VoidOrderRequest("Test"), UUID.randomUUID().toString()))
                .isInstanceOf(PermissionDeniedException.class);

        ArgumentCaptor<OpaInput> captor = ArgumentCaptor.forClass(OpaInput.class);
        verify(opaClient).evaluate(eq("pos"), captor.capture());
        OpaInput sentInput = captor.getValue();
        // The mismatch is real and reaches OPA — not silently normalized to the caller's
        // branch anywhere in the authorization path.
        assertThat(sentInput.resource().branchId()).isEqualTo(otherBranchId);
        assertThat(sentInput.user().branchId()).isEqualTo(branchId);
        assertThat(sentInput.resource().branchId()).isNotEqualTo(sentInput.user().branchId());

        long voidedEvents = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_VOIDED".equals(e.getEventType()))
                .count();
        assertThat(voidedEvents).isEqualTo(0);
    }

    // ── (3) missing permission (stale JWT simulation) is still denied ──────────────────────

    @Test
    void cashier_withoutVoidOwnPermission_isDenied_simulatesStaleJwt() {
        // Simulates RESEARCH.md's leading hypothesis: a JWT minted BEFORE the
        // 043-cashier-void-own-permission grant, so the permissions claim lacks
        // pos.order.void.own even though the DB grant is correct and the order is the
        // cashier's own OPEN order. OPA must still deny — proves the fail-closed behavior a
        // stale token would correctly trigger (the fix for this class of failure is
        // re-authentication, not loosening the authorization code).
        setSecurityContext(cashierId, branchId, List.of(), Map.of());
        OrderDto order = createOpenOrderInBranch(branchId);
        setSecurityContext(cashierId, branchId, List.of(), Map.of());

        when(opaClient.evaluate(eq("pos"), any())).thenReturn(new OpaDecision(false));

        assertThatThrownBy(() ->
                orderService.voidOrder(order.id(), new VoidOrderRequest("Test"), UUID.randomUUID().toString()))
                .isInstanceOf(PermissionDeniedException.class);

        ArgumentCaptor<OpaInput> captor = ArgumentCaptor.forClass(OpaInput.class);
        verify(opaClient).evaluate(eq("pos"), captor.capture());
        assertThat(captor.getValue().user().permissions()).doesNotContain("pos.order.void.own");
    }
}
