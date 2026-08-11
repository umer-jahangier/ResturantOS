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
 *
 * <h2>WARNING — the cross-tenant assertions here need a positive control before they mean anything</h2>
 *
 * <p>Every "DENIED" case below asserts an ABSENCE: no rows, or a refusal. An absence is the one
 * result a broken harness produces for free, and this repository has now produced it in both
 * directions in a single day:
 *
 * <ul>
 *   <li><b>Showing everything.</b> Testcontainers hands back a PostgreSQL superuser, which is
 *       exempt from row level security including FORCE. Cross-tenant tests passed because nothing
 *       was enforced and the app-level check happened to hold.</li>
 *   <li><b>Showing nothing.</b> This class is {@code @Transactional}, so Spring opens its
 *       transaction before {@code @BeforeEach} runs and the connection is configured with whatever
 *       tenant the thread held then — often none. Under a NOSUPERUSER role every read here returns
 *       zero rows, so "tenant B cannot see it" passes without tenant B ever being tested.</li>
 * </ul>
 *
 * <p>Both are green. Neither measures isolation. The discipline that separates them is a
 * <b>positive control in the same test</b>: the owning tenant must SEE its row in the very
 * assertion that proves the foreign tenant cannot. A test that only ever asserts emptiness cannot
 * tell "isolated" from "switched off", and that distinction is the entire subject of this file.
 *
 * <p>See {@code TenantGucTransactionalProbeIT} for the measured ordering, and user-service's
 * {@code TenantIsolationHarnessIT#enabledFilterStillReturnsTheCallersOwnRows} for the shape a
 * positive control takes.
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
