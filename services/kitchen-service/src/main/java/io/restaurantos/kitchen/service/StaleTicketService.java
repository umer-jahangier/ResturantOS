package io.restaurantos.kitchen.service;

import io.restaurantos.kitchen.domain.enums.TicketItemStatus;
import io.restaurantos.kitchen.domain.enums.TicketStatus;
import io.restaurantos.kitchen.domain.model.KdsTicket;
import io.restaurantos.kitchen.domain.model.KdsTicketItem;
import io.restaurantos.kitchen.dto.ClearStaleResult;
import io.restaurantos.kitchen.dto.StaleBoardSummary;
import io.restaurantos.kitchen.event.KitchenEventPayloads.StaleTicketsClearedPayload;
import io.restaurantos.kitchen.repository.KdsTicketRepository;
import io.restaurantos.shared.event.EventPublisher;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Ageing tickets off a KDS board (F17).
 *
 * <h2>The defect this exists for</h2>
 *
 * <p>Nothing ever took a ticket off a board except the POS. A ticket leaves only when its order is
 * closed (SERVED), voided (CANCELLED), or every one of its lines is served or cancelled — so an
 * order that is never closed leaves its ticket on the wall forever. Measured live on 2026-08-12 as
 * {@code kitchen@terrace.local}, branch F-7, station DEFAULT: <b>75 active tickets on a board
 * paginated 1/7, ten of them received on 2026-08-07</b> — 123 hours earlier — at the head of the
 * queue. There was no bulk clear, no expiry and no route back to a clean board.
 *
 * <p>That is test debris in this environment. It is a Tuesday in a real one: a KDS terminal that
 * loses power mid-service, a pos-service restart that drops an ORDER_CLOSED, a table that walks out
 * on an open check. Every one of them strands a ticket, and the next morning's cook inherits it.
 *
 * <h2>The rule, and why it is the only safe one</h2>
 *
 * <p>A ticket is stale <b>iff the business day it was received on has already closed</b> — nothing
 * to do with how many hours old it is. The boundary is cut on the BRANCH's own wall clock through
 * {@link BranchBusinessDay}, which delegates to shared-lib's {@code BusinessDay}: the same formula,
 * the same {@code restaurantos.business-day.offset-hours} property, as reporting and pos.
 *
 * <p>This is not pedantry. For {@code Asia/Karachi} a UTC boundary sits at 09:00 local instead of
 * 04:00, so a "clear everything before today" that cut in UTC would take <b>five hours of this
 * morning's live tickets</b> off the pass — breakfast service, in the bin, with a confirmation
 * dialog that said "yesterday". That exact off-by-one shipped in this product's Takings screen and
 * cost a whole shift's visible revenue; it must not be re-introduced on the screen where the
 * consequence is uncooked food.
 *
 * <p>So: {@code receivedAt < startOfCurrentBusinessDay}, strictly, computed on the branch's zone,
 * and if that zone cannot be established the clear <b>refuses</b> rather than guessing
 * ({@code strict = true}). A destructive action must not run on a boundary nobody chose.
 *
 * <h2>Cleared is not deleted, and not served, and not cancelled</h2>
 *
 * <p>The row stays. {@link TicketStatus#CLEARED} keeps it off the active board (which queries
 * PENDING, COOKING, READY) while saying something true about how it left, and {@code cleared_at} /
 * {@code cleared_by} record when and by whom. {@code GET /kds/tickets?status=CLEARED} reads them
 * back with their order numbers, their items and their original {@code receivedAt} intact. Nothing
 * about the POS order is touched: a cleared ticket's check may still be open, and settling or
 * voiding it stays the front-of-house's job on the order screen where it belongs.
 *
 * <h2>Who may do it</h2>
 *
 * <p>{@code pos.kds.update} — the permission the cook already holds, and the same one the controller
 * requires to bump an item. Not a new code, and emphatically not a widened one:
 *
 * <ul>
 *   <li>The action cannot reach the current business day's work. That is enforced by the query,
 *       not by the caller, so the blast radius of the permission is bounded by construction.</li>
 *   <li>It moves no money, voids no order and deletes no row.</li>
 *   <li>The person who needs a clean board at 07:00 is the cook standing at the screen, who holds
 *       exactly two permissions. Requiring a manager to walk over means the board is never cleared —
 *       which is the "structurally present, behaviourally absent" failure this repair is closing,
 *       reintroduced one layer up.</li>
 * </ul>
 *
 * <p>Every clear publishes {@code KDS_STALE_TICKETS_CLEARED} through the transactional outbox, so
 * audit-service writes a row naming the actor from the verified JWT, the station, the count and the
 * boundary applied.
 */
@Service
public class StaleTicketService {

    private static final Logger log = LoggerFactory.getLogger(StaleTicketService.class);

    /** Ticket statuses that are ON the board and can therefore go stale on it. */
    static final List<TicketStatus> ACTIVE_STATUSES =
            List.of(TicketStatus.PENDING, TicketStatus.COOKING, TicketStatus.READY);

    private static final String KITCHEN_EXCHANGE = "kitchen.topic";
    private static final String CLEARED_ROUTING_KEY = "kitchen.tickets.stale-cleared";
    /** Must match {@code AuditEventCatalog.MUST_AUDIT} exactly, or no audit row is ever written. */
    private static final String CLEARED_EVENT_TYPE = "KDS_STALE_TICKETS_CLEARED";

    private final KdsTicketRepository ticketRepository;
    private final BranchBusinessDay businessDay;
    private final EventPublisher eventPublisher;

    public StaleTicketService(KdsTicketRepository ticketRepository,
                              BranchBusinessDay businessDay,
                              EventPublisher eventPublisher) {
        this.ticketRepository = ticketRepository;
        this.businessDay = businessDay;
        this.eventPublisher = eventPublisher;
    }

    /**
     * What WOULD be cleared, without clearing it — the numbers the confirmation is built from.
     *
     * <p>Fail-soft on the zone ({@code strict = false}): a preview that refuses because an unrelated
     * service is restarting tells a cook nothing useful, and the summary states the zone it used so
     * a wrong one is visible rather than silent. The CLEAR path is strict; this one is a read.
     */
    @Transactional(readOnly = true)
    public StaleBoardSummary preview(UUID tenantId, UUID branchId, String stationCode) {
        ZoneId zone = businessDay.zoneOfOrDefault(tenantId, branchId);
        Instant cutoff = businessDay.startOfCurrentDay(tenantId, branchId, false);
        LocalDate today = businessDay.dateOf(Instant.now(), zone);
        List<KdsTicket> stale = findStale(branchId, stationCode, cutoff);
        return summarise(branchId, stationCode, zone, today, cutoff, stale);
    }

    /**
     * Clear every stale ticket off this board.
     *
     * <p>Recomputes the boundary and re-runs the query rather than trusting anything the client
     * sends — a client-supplied cutoff or ticket list would be a client-supplied answer to
     * "which of my tickets may you take away".
     */
    @Transactional
    public ClearStaleResult clearStale(UUID tenantId, UUID branchId, String stationCode) {
        ZoneId zone = businessDay.zoneOfOrDefault(tenantId, branchId);
        // STRICT: refuse rather than clear on a guessed boundary. See the class javadoc.
        Instant cutoff = businessDay.startOfCurrentDay(tenantId, branchId, true);
        LocalDate today = businessDay.dateOf(Instant.now(), zone);

        List<KdsTicket> stale = findStale(branchId, stationCode, cutoff);
        Instant clearedAt = Instant.now();
        UUID actor = currentActor();

        int itemCount = 0;
        List<UUID> ids = new ArrayList<>(stale.size());
        for (KdsTicket ticket : stale) {
            itemCount += liveItemCount(ticket);
            ticket.setStatus(TicketStatus.CLEARED);
            ticket.setClearedAt(clearedAt);
            ticket.setClearedBy(actor);
            ids.add(ticket.getId());
        }
        if (!stale.isEmpty()) {
            ticketRepository.saveAll(stale);
        }

        Instant oldest = stale.isEmpty() ? null : stale.get(0).getReceivedAt();

        // Deliberately NO WebSocket push. Every other mutation here pushes the one ticket it
        // changed; this one would push up to a hundred frames whose only message is "gone", and the
        // board's live cache is defined by the server's PENDING,COOKING,READY filter — a CLEARED
        // ticket has no business arriving in it. Other screens pick the change up on the existing
        // 10-second board poll; the screen that pressed the button refetches immediately.

        // Audited even when nothing was stale: "somebody pressed clear and there was nothing to
        // clear" is a fact an auditor reconstructing a shift wants, and an event published only on
        // the interesting path is one nobody can prove is working.
        eventPublisher.publish(
                KITCHEN_EXCHANGE,
                CLEARED_ROUTING_KEY,
                CLEARED_EVENT_TYPE,
                branchId,
                new StaleTicketsClearedPayload(
                        branchId, stationCode, zone.getId(), today, cutoff,
                        stale.size(), itemCount, oldest, clearedAt, actor, ids));

        log.info("Cleared {} stale KDS tickets ({} live items) branch={} station={} before {} ({})",
                stale.size(), itemCount, branchId, stationCode == null ? "ALL" : stationCode,
                cutoff, zone);

        return new ClearStaleResult(branchId, stationCode, zone.getId(), today, cutoff,
                stale.size(), itemCount, oldest, clearedAt, ids);
    }

    private List<KdsTicket> findStale(UUID branchId, String stationCode, Instant cutoff) {
        return stationCode == null
                ? ticketRepository.findStaleByBranch(branchId, ACTIVE_STATUSES, cutoff)
                : ticketRepository.findStaleByBranchAndStation(branchId, stationCode, ACTIVE_STATUSES, cutoff);
    }

    private StaleBoardSummary summarise(UUID branchId, String stationCode, ZoneId zone,
                                        LocalDate today, Instant cutoff, List<KdsTicket> stale) {
        int itemCount = 0;
        int finished = 0;
        Map<LocalDate, Integer> byDay = new LinkedHashMap<>();
        List<StaleBoardSummary.StaleTicket> sample = new ArrayList<>();

        for (KdsTicket ticket : stale) {
            int live = liveItemCount(ticket);
            itemCount += live;
            if (live == 0) finished += 1;
            LocalDate day = businessDay.dateOf(ticket.getReceivedAt(), zone);
            byDay.merge(day, 1, Integer::sum);
            if (sample.size() < StaleBoardSummary.TICKET_SAMPLE_LIMIT) {
                sample.add(new StaleBoardSummary.StaleTicket(
                        ticket.getId(), ticket.getOrderNo(), ticket.getStationCode(),
                        ticket.getTableNumber(), ticket.getOrderType(), ticket.getStatus(),
                        ticket.getReceivedAt(), day, live));
            }
        }

        List<StaleBoardSummary.DayGroup> days = byDay.entrySet().stream()
                .map(e -> new StaleBoardSummary.DayGroup(e.getKey(), e.getValue()))
                .sorted(Comparator.comparing(StaleBoardSummary.DayGroup::businessDate))
                .toList();

        return new StaleBoardSummary(
                branchId, stationCode, zone.getId(), businessDay.offsetHours(),
                today, cutoff,
                stale.size(), itemCount, finished,
                stale.isEmpty() ? null : stale.get(0).getReceivedAt(),
                days, sample);
    }

    /** Lines still to cook — neither served nor cancelled. The same notion the board's counts use. */
    private static int liveItemCount(KdsTicket ticket) {
        int live = 0;
        for (KdsTicketItem item : ticket.getItems()) {
            if (item.getStatus() != TicketItemStatus.CANCELLED
                    && item.getStatus() != TicketItemStatus.SERVED) {
                live += 1;
            }
        }
        return live;
    }

    /**
     * The acting user, from the verified token on this request thread and from nowhere else.
     *
     * <p>The audit event carries the actor independently ({@code DomainEventPublisher} reads the
     * same {@code TenantContext}); this is the copy the kitchen's own cleared list reads, so the two
     * are the same value from the same source rather than two claims about one person.
     */
    private UUID currentActor() {
        var authentication = org.springframework.security.core.context.SecurityContextHolder
                .getContext().getAuthentication();
        if (authentication != null
                && authentication.getPrincipal() instanceof io.restaurantos.shared.security.JwtClaims claims) {
            return claims.subject();
        }
        return null;
    }
}
