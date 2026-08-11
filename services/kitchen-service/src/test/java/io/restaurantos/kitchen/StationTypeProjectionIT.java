package io.restaurantos.kitchen;

import io.restaurantos.kitchen.domain.model.KdsStation;
import io.restaurantos.kitchen.domain.model.StationType;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsItem;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsPayload;
import io.restaurantos.kitchen.repository.KdsStationRepository;
import io.restaurantos.kitchen.repository.KdsTicketRepository;
import io.restaurantos.kitchen.service.TicketRoutingService;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Phase 28 (D-28-01) — the station's TYPE reaches the projection, so the board can be told which
 * stations are bar stations without asking pos-service.
 *
 * <p>The case that matters most here is
 * {@link #anEventCarryingNoType_leavesAStoredTypeAlone_ratherThanWalkingItBackToKitchen()}. During a
 * rolling deploy, some pos-service instances are on the pre-phase-28 build and emit no type at all.
 * If "absent" were read as "KITCHEN", every BAR station in every tenant would be walked back to the
 * cooking board one fire at a time, with nothing in any log to explain why the drinks started
 * appearing on the wrong screen. Absent has to mean "no opinion".
 */
@Transactional
class StationTypeProjectionIT extends KitchenTestBase {

    @Autowired TicketRoutingService ticketRoutingService;
    @Autowired KdsTicketRepository ticketRepository;
    @Autowired KdsStationRepository stationRepository;
    @Autowired TenantContext tenantContext;
    @Autowired JdbcTemplate jdbcTemplate;

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
    void firingABarItem_producesAProjectionRowTypedBar() {
        route(item("BAR", UUID.randomUUID(), "Main Bar", "BAR"), "ORD-T-001");

        KdsStation projected = stationRepository.findByBranchIdAndCode(branchId, "BAR").orElseThrow();
        assertThat(projected.getStationType()).isEqualTo(StationType.BAR);
        assertThat(projected.getStationType().displayFamily())
                .as("a bar ticket must not land on a cooking board")
                .isEqualTo(StationType.DisplayFamily.BAR);
    }

    @Test
    void aLineWithNoResolvableStationFk_stillProjectsKitchenRatherThanNull() {
        // pos-service emits the DEFAULT type, not null, when no FK resolves — precisely so the
        // consumer never has to decide what a missing type means.
        route(item("DEFAULT", null, null, "KITCHEN"), "ORD-T-002");

        KdsStation projected = stationRepository.findByBranchIdAndCode(branchId, "DEFAULT").orElseThrow();
        assertThat(projected.getStationType()).isEqualTo(StationType.KITCHEN);
    }

    @Test
    void aPlaceholderProjectionRow_isPromotedOnTheNextFire_theSameWayItsNameAlreadyIs() {
        // First fire: an old-shaped event. The row is created with the default.
        route(legacyItem("BAR"), "ORD-T-003");
        assertThat(stationRepository.findByBranchIdAndCode(branchId, "BAR").orElseThrow().getStationType())
                .isEqualTo(StationType.KITCHEN);

        // Second fire, now carrying the canonical data.
        route(UUID.randomUUID(), item("BAR", UUID.randomUUID(), "Main Bar", "BAR"), "ORD-T-004");

        KdsStation promoted = stationRepository.findByBranchIdAndCode(branchId, "BAR").orElseThrow();
        assertThat(promoted.getStationType()).isEqualTo(StationType.BAR);
        assertThat(promoted.getName()).isEqualTo("Main Bar");
    }

    @Test
    void anEventCarryingNoType_leavesAStoredTypeAlone_ratherThanWalkingItBackToKitchen() {
        route(item("BAR", UUID.randomUUID(), "Main Bar", "BAR"), "ORD-T-005");
        assertThat(stationRepository.findByBranchIdAndCode(branchId, "BAR").orElseThrow().getStationType())
                .isEqualTo(StationType.BAR);

        // An instance still on the pre-phase-28 build fires the same station.
        route(UUID.randomUUID(), legacyItem("BAR"), "ORD-T-006");

        assertThat(stationRepository.findByBranchIdAndCode(branchId, "BAR").orElseThrow().getStationType())
                .as("absent means 'no opinion', never 'KITCHEN' — otherwise a rolling deploy "
                        + "destroys every tenant's bar configuration one fire at a time")
                .isEqualTo(StationType.BAR);
    }

    @Test
    void everyProjectionRowThatPredatesTheMigration_readsBackAsKitchen() {
        // INSERTed without naming station_type, the way a pre-migration row exists — so it is the
        // MIGRATION's default under test, not the entity field initialiser's.
        jdbcTemplate.update(
                "INSERT INTO kds_stations (id, tenant_id, branch_id, code, name, is_active, "
                        + "escalation_threshold_seconds) VALUES (?, ?, ?, 'LEGACY', 'Legacy', TRUE, 900)",
                UUID.randomUUID(), tenantId, branchId);

        assertThat(stationRepository.findByBranchIdAndCode(branchId, "LEGACY").orElseThrow().getStationType())
                .isEqualTo(StationType.KITCHEN);
    }

    @Test
    void anEventFromThePreChangeProducer_isConsumedWithoutError() {
        // Constructed through the pre-phase-28 CONSTRUCTOR, which is how the old producer's payload
        // actually deserialises — rather than trusting that a record with a null trailing field
        // happens to work.
        OrderSentToKdsItem oldShaped = new OrderSentToKdsItem(
                UUID.randomUUID(), UUID.randomUUID(), "Biryani", 2, "GRILL",
                List.of(), null, UUID.randomUUID(), "Grill Line");
        assertThat(oldShaped.stationType()).isNull();

        route(oldShaped, "ORD-T-007");

        assertThat(ticketRepository.findByOrderId(orderId)).hasSize(1);
        assertThat(stationRepository.findByBranchIdAndCode(branchId, "GRILL")).isPresent();
    }

    @Test
    void aBarTicketStillGroupsByStationCode_oneTicketPerOrderAndStation() {
        OrderSentToKdsPayload payload = new OrderSentToKdsPayload(
                orderId, tenantId, branchId, "ORD-T-008",
                List.of(item("BAR", UUID.randomUUID(), "Main Bar", "BAR"),
                        item("BAR", UUID.randomUUID(), "Main Bar", "BAR")),
                1, null, null, "DINE_IN");

        ticketRoutingService.route(payload, "ORD-T-008");

        var tickets = ticketRepository.findByOrderId(orderId);
        assertThat(tickets)
                .as("the grouping key is still the station CODE — this plan adds an adjective, "
                        + "it does not move the board")
                .hasSize(1);
        assertThat(tickets.get(0).getStationCode()).isEqualTo("BAR");
        assertThat(tickets.get(0).getItems()).hasSize(2);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private OrderSentToKdsItem item(String code, UUID stationId, String stationName, String type) {
        return new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Line", 1, code,
                List.of(), null, stationId, stationName, type);
    }

    /** The pre-phase-28 nine-field shape: no type at all. */
    private OrderSentToKdsItem legacyItem(String code) {
        return new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Line", 1, code,
                List.of(), null, null, null);
    }

    private void route(OrderSentToKdsItem item, String orderNo) {
        route(orderId, item, orderNo);
    }

    private void route(UUID forOrderId, OrderSentToKdsItem item, String orderNo) {
        ticketRoutingService.route(new OrderSentToKdsPayload(
                forOrderId, tenantId, branchId, orderNo, List.of(item), 1, null, null, "DINE_IN"),
                orderNo);
    }
}
