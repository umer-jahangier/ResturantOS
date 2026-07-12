package io.restaurantos.kitchen;

import io.restaurantos.kitchen.domain.enums.TicketItemStatus;
import io.restaurantos.kitchen.domain.model.KdsTicket;
import io.restaurantos.kitchen.dto.KdsTicketDto;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsItem;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsPayload;
import io.restaurantos.kitchen.repository.KdsTicketRepository;
import io.restaurantos.kitchen.service.TicketRoutingService;
import io.restaurantos.kitchen.web.KdsController;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Verifies the explicit item-status endpoint (KDS-04, D-12):
 * - Walks a ticket item New(PENDING) -> Started(ACCEPTED) -> Preparing(PREPARING) -> Ready(READY)
 *   via markItemStatus (wrapping, not the 2-step bump)
 * - Rejects an invalid transition (e.g. skipping straight to READY) with StateInvalidException
 * - Requires pos.kds.update (OPA authorizeUpdate) — a viewer-only principal is denied
 * - Each successful transition publishes KITCHEN_ITEM_STATUS_CHANGED (inherited from
 *   markItemStatus, 07.3-02) into the outbox
 */
@Transactional
class ItemStatusEndpointIT extends KitchenTestBase {

    @Autowired KdsController kdsController;
    @Autowired TicketRoutingService ticketRoutingService;
    @Autowired KdsTicketRepository ticketRepository;
    @Autowired OutboxRepository outboxRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID orderId;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        orderId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);

        // KdsController is @RequiresFeature("FEATURE_KDS") — calling it directly (unlike the
        // other ITs, which call service beans and never trigger this class-level AOP aspect)
        // routes through RedisFeatureFlagService, which needs a non-null opsForValue() on the
        // mocked StringRedisTemplate (otherwise it NPEs before authz/transition logic runs).
        @SuppressWarnings("unchecked")
        ValueOperations<String, String> valueOps = mock(ValueOperations.class);
        when(stringRedisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get(any())).thenReturn("true");
    }

    private void setAuth(List<String> roles, List<String> permissions) {
        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, branchId, roles, permissions, Map.of(), null);
        UsernamePasswordAuthenticationToken auth =
                new UsernamePasswordAuthenticationToken(claims, null, List.of());
        SecurityContextHolder.getContext().setAuthentication(auth);
    }

    private KdsTicket routeSingleItemTicket(String orderNo) {
        OrderSentToKdsPayload payload = new OrderSentToKdsPayload(
                orderId, tenantId, branchId, orderNo,
                List.of(new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Burger", 1, "GRILL", List.of(), null)),
                1, null, null);
        ticketRoutingService.route(payload, orderNo);
        return ticketRepository.findByOrderId(orderId).get(0);
    }

    @Test
    void walksFullLifecycle_pendingToAcceptedToPreparingToReady() {
        KdsTicket ticket = routeSingleItemTicket("ORD-ITEMSTATUS-001");
        UUID itemId = ticket.getItems().get(0).getId();

        setAuth(List.of("KITCHEN_STAFF"), List.of("pos.kds.view", "pos.kds.update"));
        when(opaClient.evaluate(eq("kds"), any())).thenReturn(new OpaDecision(true));

        KdsTicketDto afterAccepted = kdsController.setItemStatus(
                ticket.getId(), itemId, branchId,
                new KdsController.ItemStatusRequest(TicketItemStatus.ACCEPTED),
                authClaims()).getBody();
        assertThat(afterAccepted.items().get(0).status()).isEqualTo(TicketItemStatus.ACCEPTED);

        KdsTicketDto afterPreparing = kdsController.setItemStatus(
                ticket.getId(), itemId, branchId,
                new KdsController.ItemStatusRequest(TicketItemStatus.PREPARING),
                authClaims()).getBody();
        assertThat(afterPreparing.items().get(0).status()).isEqualTo(TicketItemStatus.PREPARING);

        KdsTicketDto afterReady = kdsController.setItemStatus(
                ticket.getId(), itemId, branchId,
                new KdsController.ItemStatusRequest(TicketItemStatus.READY),
                authClaims()).getBody();
        assertThat(afterReady.items().get(0).status()).isEqualTo(TicketItemStatus.READY);

        // Each of the 3 transitions publishes KITCHEN_ITEM_STATUS_CHANGED (inherited from
        // markItemStatus, 07.3-02).
        long statusChangedEvents = outboxRepository.findAll().stream()
                .filter(e -> "KITCHEN_ITEM_STATUS_CHANGED".equals(e.getEventType()))
                .count();
        assertThat(statusChangedEvents).isEqualTo(3);
    }

    @Test
    void invalidTransition_pendingDirectToReady_isRejected() {
        KdsTicket ticket = routeSingleItemTicket("ORD-ITEMSTATUS-002");
        UUID itemId = ticket.getItems().get(0).getId();

        setAuth(List.of("KITCHEN_STAFF"), List.of("pos.kds.view", "pos.kds.update"));
        when(opaClient.evaluate(eq("kds"), any())).thenReturn(new OpaDecision(true));

        assertThatThrownBy(() -> kdsController.setItemStatus(
                ticket.getId(), itemId, branchId,
                new KdsController.ItemStatusRequest(TicketItemStatus.READY),
                authClaims()))
                .isInstanceOf(StateInvalidException.class);
    }

    @Test
    void viewerOnlyPrincipal_isDeniedItemStatusUpdate() {
        KdsTicket ticket = routeSingleItemTicket("ORD-ITEMSTATUS-003");
        UUID itemId = ticket.getItems().get(0).getId();

        setAuth(List.of("MANAGER"), List.of("pos.kds.view"));
        when(opaClient.evaluate(eq("kds"), any())).thenReturn(new OpaDecision(false));

        assertThatThrownBy(() -> kdsController.setItemStatus(
                ticket.getId(), itemId, branchId,
                new KdsController.ItemStatusRequest(TicketItemStatus.ACCEPTED),
                authClaims()))
                .isInstanceOf(PermissionDeniedException.class);
    }

    private JwtClaims authClaims() {
        return (JwtClaims) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
    }
}
