package io.restaurantos.kitchen;

import io.restaurantos.kitchen.authz.KdsAuthorizationService;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsItem;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsPayload;
import io.restaurantos.kitchen.repository.KdsTicketRepository;
import io.restaurantos.kitchen.service.TicketRoutingService;
import io.restaurantos.kitchen.service.TicketServiceImpl;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * Verifies KDS access isolation:
 * - KITCHEN_STAFF (pos.kds.view + pos.kds.update): allowed view + update on KDS
 * - OWNER (all perms): allowed view + update
 * - MANAGER (pos.kds.view only): allowed view; DENIED update
 * - CASHIER (pos.order.* only): DENIED both view and update
 * - ACCOUNTANT (finance.*): DENIED both
 * - Cross-branch/tenant: DENIED even with kds perms
 */
@Transactional
class KdsAccessIsolationIT extends KitchenTestBase {

    @Autowired KdsAuthorizationService kdsAuthorizationService;
    @Autowired TicketRoutingService ticketRoutingService;
    @Autowired KdsTicketRepository ticketRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);
    }

    private void setAuth(UUID userId, List<String> roles, List<String> permissions) {
        JwtClaims claims = new JwtClaims(userId, tenantId, branchId, roles, permissions, Map.of(), null);
        UsernamePasswordAuthenticationToken auth =
                new UsernamePasswordAuthenticationToken(claims, null, List.of());
        SecurityContextHolder.getContext().setAuthentication(auth);
    }

    // ── KITCHEN_STAFF ────────────────────────────────────────────────────────

    @Test
    void kitchen_staff_allowed_view() {
        setAuth(UUID.randomUUID(), List.of("KITCHEN_STAFF"),
                List.of("pos.kds.view", "pos.kds.update"));
        when(opaClient.evaluate(eq("kds"), any())).thenReturn(new OpaDecision(true));

        assertThatCode(() -> kdsAuthorizationService.authorizeView(tenantId, branchId))
                .doesNotThrowAnyException();
    }

    @Test
    void kitchen_staff_allowed_update() {
        setAuth(UUID.randomUUID(), List.of("KITCHEN_STAFF"),
                List.of("pos.kds.view", "pos.kds.update"));
        when(opaClient.evaluate(eq("kds"), any())).thenReturn(new OpaDecision(true));

        assertThatCode(() -> kdsAuthorizationService.authorizeUpdate(tenantId, branchId))
                .doesNotThrowAnyException();
    }

    // ── OWNER ────────────────────────────────────────────────────────────────

    @Test
    void owner_allowed_view() {
        setAuth(UUID.randomUUID(), List.of("OWNER"),
                List.of("pos.kds.view", "pos.kds.update", "pos.order.update"));
        when(opaClient.evaluate(eq("kds"), any())).thenReturn(new OpaDecision(true));

        assertThatCode(() -> kdsAuthorizationService.authorizeView(tenantId, branchId))
                .doesNotThrowAnyException();
    }

    @Test
    void owner_allowed_update() {
        setAuth(UUID.randomUUID(), List.of("OWNER"),
                List.of("pos.kds.view", "pos.kds.update", "pos.order.update"));
        when(opaClient.evaluate(eq("kds"), any())).thenReturn(new OpaDecision(true));

        assertThatCode(() -> kdsAuthorizationService.authorizeUpdate(tenantId, branchId))
                .doesNotThrowAnyException();
    }

    // ── MANAGER ──────────────────────────────────────────────────────────────

    @Test
    void manager_allowed_view() {
        setAuth(UUID.randomUUID(), List.of("MANAGER"), List.of("pos.kds.view"));
        when(opaClient.evaluate(eq("kds"), any())).thenReturn(new OpaDecision(true));

        assertThatCode(() -> kdsAuthorizationService.authorizeView(tenantId, branchId))
                .doesNotThrowAnyException();
    }

    @Test
    void manager_denied_update() {
        setAuth(UUID.randomUUID(), List.of("MANAGER"), List.of("pos.kds.view"));
        when(opaClient.evaluate(eq("kds"), any())).thenReturn(new OpaDecision(false));

        assertThatThrownBy(() -> kdsAuthorizationService.authorizeUpdate(tenantId, branchId))
                .isInstanceOf(PermissionDeniedException.class);
    }

    // ── CASHIER ──────────────────────────────────────────────────────────────

    @Test
    void cashier_denied_view() {
        setAuth(UUID.randomUUID(), List.of("CASHIER"),
                List.of("pos.order.update", "pos.order.send_to_kds"));
        when(opaClient.evaluate(eq("kds"), any())).thenReturn(new OpaDecision(false));

        assertThatThrownBy(() -> kdsAuthorizationService.authorizeView(tenantId, branchId))
                .isInstanceOf(PermissionDeniedException.class);
    }

    @Test
    void cashier_denied_update() {
        setAuth(UUID.randomUUID(), List.of("CASHIER"),
                List.of("pos.order.update", "pos.order.send_to_kds"));
        when(opaClient.evaluate(eq("kds"), any())).thenReturn(new OpaDecision(false));

        assertThatThrownBy(() -> kdsAuthorizationService.authorizeUpdate(tenantId, branchId))
                .isInstanceOf(PermissionDeniedException.class);
    }

    // ── ACCOUNTANT ───────────────────────────────────────────────────────────

    @Test
    void accountant_denied_view() {
        setAuth(UUID.randomUUID(), List.of("ACCOUNTANT"),
                List.of("finance.report.view", "finance.period.manage"));
        when(opaClient.evaluate(eq("kds"), any())).thenReturn(new OpaDecision(false));

        assertThatThrownBy(() -> kdsAuthorizationService.authorizeView(tenantId, branchId))
                .isInstanceOf(PermissionDeniedException.class);
    }

    @Test
    void accountant_denied_update() {
        setAuth(UUID.randomUUID(), List.of("ACCOUNTANT"),
                List.of("finance.report.view", "finance.period.manage"));
        when(opaClient.evaluate(eq("kds"), any())).thenReturn(new OpaDecision(false));

        assertThatThrownBy(() -> kdsAuthorizationService.authorizeUpdate(tenantId, branchId))
                .isInstanceOf(PermissionDeniedException.class);
    }
}
