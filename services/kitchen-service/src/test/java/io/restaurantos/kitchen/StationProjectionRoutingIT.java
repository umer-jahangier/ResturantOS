package io.restaurantos.kitchen;

import io.restaurantos.kitchen.domain.model.KdsStation;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsItem;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsPayload;
import io.restaurantos.kitchen.repository.KdsStationRepository;
import io.restaurantos.kitchen.repository.KdsTicketRepository;
import io.restaurantos.kitchen.service.TicketRoutingService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Phase 3 — Station Routing Refactor (Stage C, kitchen side): the ORDER_SENT_TO_KDS event now
 * carries the canonical station (additive stationId/stationName). Verifies:
 *  - the routed ticket captures the canonical station_id (still keyed on station_code)
 *  - kds_stations is a real PROJECTION — the projected row gets the real name (not name=code)
 *    and the canonical source_station_id
 *  - a line with no station FK still falls back to DEFAULT with name=code and null source id
 *  - a later revision that first supplies the canonical data backfills the projection + ticket
 */
@Transactional
class StationProjectionRoutingIT extends KitchenTestBase {

    @Autowired TicketRoutingService ticketRoutingService;
    @Autowired KdsTicketRepository ticketRepository;
    @Autowired KdsStationRepository stationRepository;
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
    }

    @Test
    void route_withStationId_projectsRealNameAndSourceId_onTicketAndStation() {
        UUID grillStationId = UUID.randomUUID();
        OrderSentToKdsPayload payload = new OrderSentToKdsPayload(
                orderId, tenantId, branchId, "ORD-P-001",
                List.of(new OrderSentToKdsItem(
                        UUID.randomUUID(), UUID.randomUUID(), "Burger", 1, "GRILL",
                        List.of(), null, grillStationId, "Grill Line")),
                1, null, null, "DINE_IN");

        ticketRoutingService.route(payload, "ORD-P-001");

        var ticket = ticketRepository.findByOrderId(orderId).get(0);
        assertThat(ticket.getStationCode()).isEqualTo("GRILL");
        assertThat(ticket.getStationId()).isEqualTo(grillStationId);

        KdsStation projected = stationRepository.findByBranchIdAndCode(branchId, "GRILL").orElseThrow();
        assertThat(projected.getName()).isEqualTo("Grill Line");
        assertThat(projected.getSourceStationId()).isEqualTo(grillStationId);
        assertThat(projected.isActive()).isTrue();
    }

    @Test
    void route_withoutStationId_fallsBackToDefaultProjection() {
        OrderSentToKdsPayload payload = new OrderSentToKdsPayload(
                orderId, tenantId, branchId, "ORD-P-002",
                // 7-arg back-compat item (no station FK) → DEFAULT
                List.of(new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Sauce", 1, null, List.of(), null)),
                1, null, null, "TAKEAWAY");

        ticketRoutingService.route(payload, "ORD-P-002");

        var ticket = ticketRepository.findByOrderId(orderId).get(0);
        assertThat(ticket.getStationCode()).isEqualTo("DEFAULT");
        assertThat(ticket.getStationId()).isNull();

        KdsStation projected = stationRepository.findByBranchIdAndCode(branchId, "DEFAULT").orElseThrow();
        assertThat(projected.getName()).isEqualTo("DEFAULT");
        assertThat(projected.getSourceStationId()).isNull();
    }

    @Test
    void route_laterRevisionSuppliesCanonicalData_backfillsProjectionAndTicket() {
        UUID grillStationId = UUID.randomUUID();
        // First fire: free-text only (auto-vivified projection, name=code, no source id).
        ticketRoutingService.route(new OrderSentToKdsPayload(
                orderId, tenantId, branchId, "ORD-P-003",
                List.of(new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Burger", 1, "GRILL", List.of(), null)),
                1, null, null, "DINE_IN"), "ORD-P-003");

        KdsStation afterFirst = stationRepository.findByBranchIdAndCode(branchId, "GRILL").orElseThrow();
        assertThat(afterFirst.getName()).isEqualTo("GRILL");
        assertThat(afterFirst.getSourceStationId()).isNull();

        // Second fire (revision) to the same station now carries the canonical id + name.
        ticketRoutingService.route(new OrderSentToKdsPayload(
                orderId, tenantId, branchId, "ORD-P-003",
                List.of(new OrderSentToKdsItem(
                        UUID.randomUUID(), UUID.randomUUID(), "Fries", 1, "GRILL",
                        List.of(), null, grillStationId, "Grill Line")),
                2, null, null, "DINE_IN"), "ORD-P-003");

        KdsStation afterSecond = stationRepository.findByBranchIdAndCode(branchId, "GRILL").orElseThrow();
        assertThat(afterSecond.getName()).isEqualTo("Grill Line");
        assertThat(afterSecond.getSourceStationId()).isEqualTo(grillStationId);

        var ticket = ticketRepository.findByOrderId(orderId).get(0);
        assertThat(ticket.getStationId()).isEqualTo(grillStationId);
    }
}
