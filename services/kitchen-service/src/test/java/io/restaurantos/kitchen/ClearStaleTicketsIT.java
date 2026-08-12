package io.restaurantos.kitchen;

import io.restaurantos.kitchen.client.UserBranchClient;
import io.restaurantos.kitchen.domain.enums.TicketStatus;
import io.restaurantos.kitchen.domain.model.KdsTicket;
import io.restaurantos.kitchen.dto.ClearStaleResult;
import io.restaurantos.kitchen.dto.StaleBoardSummary;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsItem;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsPayload;
import io.restaurantos.kitchen.repository.KdsTicketRepository;
import io.restaurantos.kitchen.service.BranchBusinessDay;
import io.restaurantos.kitchen.service.StaleTicketService;
import io.restaurantos.kitchen.service.TicketRoutingService;
import io.restaurantos.shared.event.AuditEventCatalog;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * A cook can get back to a clean board, and the boundary is cut on the BRANCH's clock (F17).
 *
 * <h2>The state this asserts against, and why the obvious test would have passed anyway</h2>
 *
 * <p>The register's signature failure is a green test that only ever exercises the one state that
 * works — {@code VoidOwnOrderIT} testing the OPEN order a cashier never needs to void. The
 * equivalent mistake here would be a test that fires three tickets a week apart and asserts they all
 * clear: it passes against a correct implementation AND against one that cuts the trading day in
 * UTC, because a week-old ticket is old by any boundary.
 *
 * <p>So the fixture is built around the exact five hours where the two answers differ. For
 * {@code Asia/Karachi} (UTC+5) the trading day starts at 04:00 local = 23:00Z the previous day; a
 * UTC cut puts it at 04:00Z = 09:00 local. Between those two instants lies the whole of breakfast
 * service. {@link #clearsYesterdaysBoardAndLeavesThisMorningAlone} plants one ticket a minute AFTER
 * the branch's boundary and one a minute BEFORE it, and asserts opposite outcomes for them — which
 * no UTC implementation can satisfy in either direction:
 *
 * <ul>
 *   <li>run between 09:00 and 04:00 local, a UTC cut sits five hours LATE and clears this morning's
 *       ticket → the "survives" assertion fails;</li>
 *   <li>run between 04:00 and 09:00 local, a UTC cut sits nineteen hours EARLY and leaves last
 *       night's ticket on the board → the "cleared" assertion fails.</li>
 * </ul>
 *
 * <p>That is the same off-by-one that filed a whole shift's takings to the previous day in this
 * product, measured and written up on 2026-08-12. Here the consequence would be uncooked food.
 */
@Transactional
@DisplayName("F17 — clearing a KDS board of tickets whose business day has closed")
class ClearStaleTicketsIT extends KitchenTestBase {

    /** The branch's zone for this fixture. UTC+5, no DST — the widest gap against a UTC cut. */
    private static final ZoneId KARACHI = ZoneId.of("Asia/Karachi");
    private static final int OFFSET_HOURS = 4;

    @Autowired TicketRoutingService ticketRoutingService;
    @Autowired StaleTicketService staleTicketService;
    @Autowired BranchBusinessDay branchBusinessDay;
    @Autowired KdsTicketRepository ticketRepository;
    @Autowired OutboxRepository outboxRepository;
    @Autowired TenantContext tenantContext;

    /** The branch-identity seam. Real HTTP here would make this test depend on user-service. */
    @MockitoBean UserBranchClient userBranchClient;

    UUID tenantId;
    UUID branchId;
    UUID cookId;

    /**
     * The instant the CURRENT business day began at this branch, computed here from first
     * principles rather than from the class under test — otherwise a wrong implementation would be
     * marking its own homework.
     */
    Instant branchDayStart;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        cookId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, cookId, null);

        when(userBranchClient.getBranch(any(), any()))
                .thenReturn(Optional.of(new UserBranchClient.BranchIdentity(
                        branchId, "Floating Terrace F-7", "Asia/Karachi")));

        LocalDate today = Instant.now().atZone(KARACHI).minusHours(OFFSET_HOURS).toLocalDate();
        branchDayStart = today.atStartOfDay(KARACHI).plusHours(OFFSET_HOURS).toInstant();

        // The cook, as the request thread would carry them. currentActor() reads this and nothing
        // else, so "who cleared it" is the verified token's subject rather than a request field.
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(
                        new JwtClaims(cookId, tenantId, branchId, List.of("KITCHEN_STAFF"),
                                List.of("pos.kds.view", "pos.kds.update"), null, null),
                        "n/a", List.of()));
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    // ── The boundary ──────────────────────────────────────────────────────────

    @Test
    @DisplayName("clears yesterday's board and does not touch a ticket fired this morning")
    void clearsYesterdaysBoardAndLeavesThisMorningAlone() {
        KdsTicket fiveDaysAgo = fireTicketAt("ORD-OLD", branchDayStart.minusSeconds(5 * 86_400));
        KdsTicket lastNight = fireTicketAt("ORD-LAST-NIGHT", branchDayStart.minusSeconds(60));
        KdsTicket exactlyAtOpen = fireTicketAt("ORD-AT-OPEN", branchDayStart);
        KdsTicket thisMorning = fireTicketAt("ORD-THIS-MORNING", branchDayStart.plusSeconds(60));

        ClearStaleResult result = staleTicketService.clearStale(tenantId, branchId, "GRILL");

        assertThat(result.clearedTicketCount())
                .as("only the two tickets from a closed business day")
                .isEqualTo(2);
        assertThat(statusOf(fiveDaysAgo)).isEqualTo(TicketStatus.CLEARED);
        assertThat(statusOf(lastNight))
                .as("""
                    A ticket fired one minute BEFORE this branch's trading day opened belongs to
                    last night's service and must come off the board. An implementation cutting the
                    day in UTC leaves it there for another five hours.""")
                .isEqualTo(TicketStatus.CLEARED);
        assertThat(statusOf(exactlyAtOpen))
                .as("the boundary is strict: a ticket fired AT open is today's work")
                .isEqualTo(TicketStatus.PENDING);
        assertThat(statusOf(thisMorning))
                .as("""
                    A ticket fired one minute AFTER this branch's trading day opened is breakfast
                    service. An implementation cutting the day in UTC treats the next five hours of
                    Karachi's morning as 'yesterday' and takes this off the pass.""")
                .isEqualTo(TicketStatus.PENDING);
    }

    @Test
    @DisplayName("the boundary and the zone it was cut on are reported, not left implicit")
    void reportsTheBoundaryItApplied() {
        fireTicketAt("ORD-OLD", branchDayStart.minusSeconds(3_600));

        StaleBoardSummary summary = staleTicketService.preview(tenantId, branchId, "GRILL");

        assertThat(summary.branchTimezone()).isEqualTo("Asia/Karachi");
        assertThat(summary.businessDayOffsetHours()).isEqualTo(OFFSET_HOURS);
        assertThat(summary.currentBusinessDayStartedAt()).isEqualTo(branchDayStart);
        assertThat(summary.currentBusinessDate())
                .isEqualTo(Instant.now().atZone(KARACHI).minusHours(OFFSET_HOURS).toLocalDate());
        assertThat(summary.ticketCount()).isEqualTo(1);
        assertThat(summary.days()).singleElement()
                .extracting(StaleBoardSummary.DayGroup::ticketCount).isEqualTo(1);
        assertThat(summary.tickets()).singleElement()
                .extracting(StaleBoardSummary.StaleTicket::orderNo).isEqualTo("ORD-OLD");
    }

    @Test
    @DisplayName("a preview changes nothing")
    void previewIsAPureRead() {
        KdsTicket old = fireTicketAt("ORD-OLD", branchDayStart.minusSeconds(3_600));

        staleTicketService.preview(tenantId, branchId, "GRILL");

        assertThat(statusOf(old)).isEqualTo(TicketStatus.PENDING);
        assertThat(outboxRepository.findAll()).noneMatch(e -> "KDS_STALE_TICKETS_CLEARED".equals(e.getEventType()));
    }

    // ── Cleared is not deleted ────────────────────────────────────────────────

    @Test
    @DisplayName("a cleared ticket is still there — order number, lines and original time intact")
    void clearedTicketsAreStillFindable() {
        KdsTicket old = fireTicketAt("ORD-OLD", branchDayStart.minusSeconds(7_200));
        Instant originalReceivedAt = old.getReceivedAt();

        ClearStaleResult result = staleTicketService.clearStale(tenantId, branchId, "GRILL");
        assertThat(result.clearedTicketIds()).containsExactly(old.getId());

        KdsTicket reloaded = ticketRepository.findDetailById(old.getId()).orElseThrow();
        assertThat(reloaded.getOrderNo()).isEqualTo("ORD-OLD");
        assertThat(reloaded.getItems()).isNotEmpty();
        assertThat(reloaded.getReceivedAt())
                .as("the age it was cleared at must survive, or the record cannot be checked")
                .isEqualTo(originalReceivedAt);
        assertThat(reloaded.getClearedAt()).isNotNull();
        assertThat(reloaded.getClearedBy())
                .as("who cleared it, from the verified token")
                .isEqualTo(cookId);
    }

    @Test
    @DisplayName("cleared tickets leave the active board and are readable back under status=CLEARED")
    void clearedTicketsLeaveTheBoardButNotTheDatabase() {
        fireTicketAt("ORD-OLD", branchDayStart.minusSeconds(7_200));
        fireTicketAt("ORD-TODAY", branchDayStart.plusSeconds(600));

        staleTicketService.clearStale(tenantId, branchId, "GRILL");

        // The board's own query — exactly what KdsController runs for a station board.
        var board = ticketRepository.findByBranchIdAndStationCodeAndStatusIn(
                branchId, "GRILL",
                List.of(TicketStatus.PENDING, TicketStatus.COOKING, TicketStatus.READY),
                PageRequest.of(0, 500));
        assertThat(board.getContent()).extracting(KdsTicket::getOrderNo).containsExactly("ORD-TODAY");

        var cleared = ticketRepository.findByBranchIdAndStationCodeAndStatusIn(
                branchId, "GRILL", List.of(TicketStatus.CLEARED), PageRequest.of(0, 500));
        assertThat(cleared.getContent()).extracting(KdsTicket::getOrderNo).containsExactly("ORD-OLD");
    }

    @Test
    @DisplayName("a late add on a cleared check puts the ticket back on the board")
    void aNewRevisionReopensAClearedTicket() {
        KdsTicket old = fireTicketAt("ORD-OLD", branchDayStart.minusSeconds(7_200));
        staleTicketService.clearStale(tenantId, branchId, "GRILL");
        assertThat(statusOf(old)).isEqualTo(TicketStatus.CLEARED);

        // The POS fires another line against the same check, at the same station.
        ticketRoutingService.route(new OrderSentToKdsPayload(
                old.getOrderId(), tenantId, branchId, "ORD-OLD",
                List.of(new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Naan", 1,
                        "GRILL", List.of(), null)),
                2, null, null), "ORD-OLD");

        KdsTicket reopened = ticketRepository.findDetailById(old.getId()).orElseThrow();
        assertThat(reopened.getStatus())
                .as("clearing a board must never be a way to lose work that arrives afterwards")
                .isEqualTo(TicketStatus.PENDING);
        assertThat(reopened.getClearedAt()).isNull();
        assertThat(reopened.getClearedBy()).isNull();
    }

    // ── The audit trail ───────────────────────────────────────────────────────

    @Test
    @DisplayName("publishes an audit event naming who, how many and the boundary applied")
    void publishesAnAuditEventTheAuditServiceWillActuallyIngest() {
        fireTicketAt("ORD-OLD-1", branchDayStart.minusSeconds(7_200));
        fireTicketAt("ORD-OLD-2", branchDayStart.minusSeconds(9_000));

        staleTicketService.clearStale(tenantId, branchId, "GRILL");

        List<OutboxEntry> events = outboxRepository.findAll().stream()
                .filter(e -> "KDS_STALE_TICKETS_CLEARED".equals(e.getEventType()))
                .toList();
        assertThat(events).hasSize(1);
        OutboxEntry event = events.get(0);
        assertThat(event.getExchange()).isEqualTo("kitchen.topic");
        assertThat(event.getBranchId()).isEqualTo(branchId);
        assertThat(event.getSource()).isEqualTo("kitchen-service");

        // The envelope is what audit-service reads the actor off.
        assertThat(event.getEnvelopeJson()).contains("\"actorId\":\"" + cookId + "\"");
        assertThat(event.getEnvelopeJson()).contains("\"ticketCount\":2");
        assertThat(event.getEnvelopeJson()).contains("\"branchTimezone\":\"Asia/Karachi\"");

        // An event type audit-service's allow-list does not know is ingested by nothing, writes no
        // row, and logs nothing above DEBUG — the exact silent hole AuditEventCatalog exists for.
        assertThat(AuditEventCatalog.MUST_AUDIT)
                .as("the published type and the audit allow-list must be the same string")
                .contains("KDS_STALE_TICKETS_CLEARED");
    }

    @Test
    @DisplayName("pressing clear on an already-clean board is audited too, and clears nothing")
    void aNoOpClearIsStillRecorded() {
        fireTicketAt("ORD-TODAY", branchDayStart.plusSeconds(600));

        ClearStaleResult result = staleTicketService.clearStale(tenantId, branchId, "GRILL");

        assertThat(result.clearedTicketCount()).isZero();
        assertThat(outboxRepository.findAll())
                .anyMatch(e -> "KDS_STALE_TICKETS_CLEARED".equals(e.getEventType()));
    }

    // ── Not knowing is not the same as guessing ───────────────────────────────

    @Test
    @DisplayName("refuses to clear when the branch's time zone cannot be established")
    void refusesRatherThanClearingOnAGuessedBoundary() {
        KdsTicket old = fireTicketAt("ORD-OLD", branchDayStart.minusSeconds(7_200));
        when(userBranchClient.getBranch(any(), any())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> staleTicketService.clearStale(tenantId, branchId, "GRILL"))
                .isInstanceOf(BranchBusinessDay.BranchZoneUnknownException.class)
                .hasMessageContaining("Nothing was cleared");

        assertThat(statusOf(old)).isEqualTo(TicketStatus.PENDING);
        assertThat(outboxRepository.findAll())
                .noneMatch(e -> "KDS_STALE_TICKETS_CLEARED".equals(e.getEventType()));
    }

    // ── Scope ─────────────────────────────────────────────────────────────────

    @Test
    @DisplayName("clearing one board does not touch another station's tickets")
    void oneBoardAtATime() {
        KdsTicket grill = fireTicketAt("ORD-GRILL", branchDayStart.minusSeconds(7_200));
        KdsTicket pantry = fireTicketAt("ORD-PANTRY", branchDayStart.minusSeconds(7_200), "PANTRY1");

        staleTicketService.clearStale(tenantId, branchId, "GRILL");

        assertThat(statusOf(grill)).isEqualTo(TicketStatus.CLEARED);
        assertThat(statusOf(pantry))
                .as("a cook clearing their own board must not reach across the kitchen")
                .isEqualTo(TicketStatus.PENDING);
    }

    @Test
    @DisplayName("a station-less clear sweeps the whole branch")
    void branchWideClearReachesEveryStation() {
        KdsTicket grill = fireTicketAt("ORD-GRILL", branchDayStart.minusSeconds(7_200));
        KdsTicket pantry = fireTicketAt("ORD-PANTRY", branchDayStart.minusSeconds(7_200), "PANTRY1");

        ClearStaleResult result = staleTicketService.clearStale(tenantId, branchId, null);

        assertThat(result.clearedTicketCount()).isEqualTo(2);
        assertThat(statusOf(grill)).isEqualTo(TicketStatus.CLEARED);
        assertThat(statusOf(pantry)).isEqualTo(TicketStatus.CLEARED);
    }

    @Test
    @DisplayName("another branch's stale tickets are never in reach")
    void neverReachesAnotherBranch() {
        UUID otherBranch = UUID.randomUUID();
        KdsTicket mine = fireTicketAt("ORD-MINE", branchDayStart.minusSeconds(7_200));
        KdsTicket theirs = fireTicketAt("ORD-THEIRS", branchDayStart.minusSeconds(7_200), "GRILL", otherBranch);

        staleTicketService.clearStale(tenantId, branchId, null);

        assertThat(statusOf(mine)).isEqualTo(TicketStatus.CLEARED);
        assertThat(statusOf(theirs)).isEqualTo(TicketStatus.PENDING);
    }

    // ── fixture ───────────────────────────────────────────────────────────────

    private KdsTicket fireTicketAt(String orderNo, Instant receivedAt) {
        return fireTicketAt(orderNo, receivedAt, "GRILL", branchId);
    }

    private KdsTicket fireTicketAt(String orderNo, Instant receivedAt, String station) {
        return fireTicketAt(orderNo, receivedAt, station, branchId);
    }

    /**
     * Fire a real ticket through the routing service, then back-date it.
     *
     * <p>Routed rather than hand-built so the row is exactly the shape a POS fire produces — items,
     * revision numbers, station projection and all. {@code receivedAt} is then set directly because
     * that is the one field the fixture needs to control and no production path sets it to anything
     * but {@code now()}.
     */
    private KdsTicket fireTicketAt(String orderNo, Instant receivedAt, String station, UUID onBranch) {
        UUID orderId = UUID.randomUUID();
        // TicketRoutingService.createNewTicket takes the branch from the TenantContext of the
        // consuming thread, NOT from the payload — so a fixture that only varies the payload's
        // branchId silently plants every ticket on the same branch, and a cross-branch test would
        // pass while proving nothing. Move the context, fire, move it back.
        tenantContext.set(tenantId, onBranch, cookId, null);
        try {
            ticketRoutingService.route(new OrderSentToKdsPayload(
                    orderId, tenantId, onBranch, orderNo,
                    List.of(new OrderSentToKdsItem(UUID.randomUUID(), UUID.randomUUID(), "Karahi", 1,
                            station, List.of(), null)),
                    1, null, null), orderNo);
        } finally {
            tenantContext.set(tenantId, branchId, cookId, null);
        }
        KdsTicket ticket = ticketRepository.findByOrderId(orderId).get(0);
        assertThat(ticket.getBranchId())
                .as("fixture sanity: the ticket must really be on the branch the test asked for")
                .isEqualTo(onBranch);
        ticket.setReceivedAt(receivedAt);
        return ticketRepository.save(ticket);
    }

    private TicketStatus statusOf(KdsTicket ticket) {
        return ticketRepository.findById(ticket.getId()).orElseThrow().getStatus();
    }
}
