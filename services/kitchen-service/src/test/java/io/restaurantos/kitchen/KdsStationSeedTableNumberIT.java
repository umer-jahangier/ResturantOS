package io.restaurantos.kitchen;

import io.restaurantos.kitchen.domain.model.KdsStation;
import io.restaurantos.kitchen.dto.KdsTicketDto;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsItem;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsPayload;
import io.restaurantos.kitchen.repository.KdsStationRepository;
import io.restaurantos.kitchen.repository.KdsTicketRepository;
import io.restaurantos.kitchen.service.TicketRoutingService;
import io.restaurantos.kitchen.service.TicketServiceImpl;
import io.restaurantos.kitchen.web.KdsController;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Verifies DEFAULT-station seeding (KDS-04) and end-to-end tableNumber propagation:
 * - GET /stations for a branch with zero station rows auto-seeds and returns a single
 *   DEFAULT station (so the board is never empty)
 * - routing a ticket to station "DEFAULT" when no station row exists creates the DEFAULT
 *   station row idempotently (no duplicate on a second route)
 * - the payload's tableNumber lands on the persisted ticket and the DTO
 */
@Transactional
class KdsStationSeedTableNumberIT extends KitchenTestBase {

    @Autowired KdsController kdsController;
    @Autowired TicketRoutingService ticketRoutingService;
    @Autowired TicketServiceImpl ticketService;
    @Autowired KdsStationRepository stationRepository;
    @Autowired KdsTicketRepository ticketRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID orderId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        orderId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);

        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, branchId,
                List.of("KITCHEN_STAFF"), List.of("pos.kds.view", "pos.kds.update"), Map.of(), null);
        UsernamePasswordAuthenticationToken auth =
                new UsernamePasswordAuthenticationToken(claims, null, List.of());
        SecurityContextHolder.getContext().setAuthentication(auth);
        when(opaClient.evaluate(eq("kds"), any())).thenReturn(new OpaDecision(true));

        // KdsController is @RequiresFeature("FEATURE_KDS") — calling it directly routes through
        // RedisFeatureFlagService, which needs a non-null opsForValue() on the mocked
        // StringRedisTemplate (otherwise it NPEs before the seeding logic runs).
        @SuppressWarnings("unchecked")
        ValueOperations<String, String> valueOps = mock(ValueOperations.class);
        when(stringRedisTemplate.opsForValue()).thenReturn(valueOps);
        when(valueOps.get(any())).thenReturn("true");
    }

    @Test
    void getStations_freshBranch_autoSeedsDefaultStation() {
        assertThat(stationRepository.findByBranchIdAndActiveTrue(branchId)).isEmpty();

        ResponseEntity<List<KdsStation>> response = kdsController.getStations(branchId,
                (JwtClaims) SecurityContextHolder.getContext().getAuthentication().getPrincipal());

        List<KdsStation> stations = response.getBody();
        assertThat(stations).hasSize(1);
        assertThat(stations.get(0).getCode()).isEqualTo("DEFAULT");
        assertThat(stations.get(0).getBranchId()).isEqualTo(branchId);
        assertThat(stations.get(0).isActive()).isTrue();
    }

    @Test
    void routeTicket_persistsTableNumber_onTicketAndDto() {
        OrderSentToKdsPayload payload = new OrderSentToKdsPayload(
                orderId, tenantId, branchId, "ORD-STATION-001",
                List.of(new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Burger", 1, "GRILL", List.of(), null)),
                1, null, "T-12");
        ticketRoutingService.route(payload, "ORD-STATION-001");

        var ticket = ticketRepository.findByOrderId(orderId).get(0);
        assertThat(ticket.getTableNumber()).isEqualTo("T-12");

        KdsTicketDto dto = ticketService.getTicketDetail(ticket.getId());
        assertThat(dto.tableNumber()).isEqualTo("T-12");

        // Routing to a real station code (not DEFAULT) also seeds that station row so it's
        // never invisible on GET /stations either.
        var grillStation = stationRepository.findByBranchIdAndCode(branchId, "GRILL");
        assertThat(grillStation).isPresent();
    }

    @Test
    void routeTicketTwice_idempotent_singleDefaultStation() {
        OrderSentToKdsPayload payload = new OrderSentToKdsPayload(
                orderId, tenantId, branchId, "ORD-STATION-002",
                List.of(new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Sauce", 1, null, List.of(), null)),
                1, null, null);

        ticketRoutingService.route(payload, "ORD-STATION-002");
        ticketRoutingService.route(payload, "ORD-STATION-002"); // second delivery

        var defaultStations = stationRepository.findByBranchIdAndActiveTrue(branchId).stream()
                .filter(s -> "DEFAULT".equals(s.getCode()))
                .toList();
        assertThat(defaultStations).hasSize(1);
    }
}
