package io.restaurantos.kitchen.service;

import io.restaurantos.kitchen.domain.enums.TicketStatus;
import io.restaurantos.kitchen.domain.model.KdsStation;
import io.restaurantos.kitchen.domain.model.KdsTicket;
import io.restaurantos.kitchen.domain.model.KdsTicketItem;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsItem;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsPayload;
import io.restaurantos.kitchen.repository.KdsStationRepository;
import io.restaurantos.kitchen.repository.KdsTicketRepository;
import io.restaurantos.kitchen.ws.KdsWebSocketHandler;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Routes ORDER_SENT_TO_KDS items to one KdsTicket per (order, station).
 * Items with null or unrecognised station code are routed to "DEFAULT".
 * Revision-aware (POS-12/KDS-03): if a ticket already exists for (orderId, stationCode),
 * new items are APPENDED to it — reopening the ticket to PENDING if it had reached READY —
 * rather than skipped. True event-redelivery dedup ("already processed this exact eventId")
 * is handled one layer up by ProcessedEventService.tryProcess in OrderSentToKdsConsumer;
 * this service must never reintroduce a per-eventId or ticket-existence skip.
 */
@Service
public class TicketRoutingService {

    private static final Logger log = LoggerFactory.getLogger(TicketRoutingService.class);
    private static final String DEFAULT_STATION = "DEFAULT";

    private final KdsTicketRepository ticketRepository;
    private final KdsStationRepository stationRepository;
    private final TenantContext tenantContext;
    private final KdsWebSocketHandler webSocketHandler;
    private final TicketServiceImpl ticketService;

    public TicketRoutingService(KdsTicketRepository ticketRepository,
                                 KdsStationRepository stationRepository,
                                 TenantContext tenantContext,
                                 KdsWebSocketHandler webSocketHandler,
                                 TicketServiceImpl ticketService) {
        this.ticketRepository = ticketRepository;
        this.stationRepository = stationRepository;
        this.tenantContext = tenantContext;
        this.webSocketHandler = webSocketHandler;
        this.ticketService = ticketService;
    }

    @Transactional
    public void route(OrderSentToKdsPayload payload, String orderNo) {
        Map<String, List<OrderSentToKdsItem>> byStation = groupByStation(payload.items());

        for (Map.Entry<String, List<OrderSentToKdsItem>> entry : byStation.entrySet()) {
            String stationCode = entry.getKey();
            List<OrderSentToKdsItem> stationItems = entry.getValue();

            // Phase 3: the canonical station id/name for this code-group (from the first item that
            // carries a station FK — all items in a code-group resolve to the same station). Grouping
            // stays by CODE because the ticket identity and the WS subscription key are stationCode-
            // based (load-bearing until Stage D); code↔stationId is 1:1, so this is equivalent to
            // grouping by id while keeping the contract non-breaking.
            StationRef ref = resolveStationRef(stationItems);

            Optional<KdsTicket> existing = ticketRepository
                    .findByOrderIdAndStationCode(payload.orderId(), stationCode);

            if (existing.isPresent()) {
                appendToExistingTicket(existing.get(), stationItems, payload, ref);
            } else {
                createNewTicket(payload, orderNo, stationCode, stationItems, ref);
            }
        }
    }

    /** Canonical station reference resolved from an event item group (id/name may be null). */
    private record StationRef(UUID stationId, String stationName) {}

    private StationRef resolveStationRef(List<OrderSentToKdsItem> stationItems) {
        return stationItems.stream()
                .filter(i -> i.stationId() != null)
                .findFirst()
                .map(i -> new StationRef(i.stationId(), i.stationName()))
                .orElse(new StationRef(null, null));
    }

    /**
     * A revision fire for an order that already has a ticket at this station: append the
     * new items (stamped with the payload's revisionNo/firedAt) and reopen the ticket if it
     * had already reached READY, then push the updated ticket to WebSocket subscribers.
     */
    private void appendToExistingTicket(KdsTicket ticket, List<OrderSentToKdsItem> stationItems,
                                         OrderSentToKdsPayload payload, StationRef ref) {
        List<KdsTicketItem> appended = buildItems(stationItems, ticket, payload.revisionNo());
        ticket.getItems().addAll(appended);

        if (ticket.getStatus() == TicketStatus.READY) {
            ticket.setStatus(TicketStatus.PENDING);
            ticket.setReadyAt(null);
        }

        // Backfill the canonical station id on a ticket created before this line carried one
        // (e.g. the initial fire predated the menu-item station assignment). Additive/null-safe.
        if (ticket.getStationId() == null && ref.stationId() != null) {
            ticket.setStationId(ref.stationId());
        }
        // Keep the station projection fresh from later revisions too (name may have changed).
        upsertStation(ticket.getBranchId(), ticket.getStationCode(), ref);

        // Latest revision's order-level notes win — the kitchen sees current instructions.
        ticket.setOrderNotes(payload.orderNotes());

        // Table number may not have been known/set on the initial fire (e.g. assigned after
        // the first send) — refresh it from a later revision if the ticket doesn't have one yet.
        if (ticket.getTableNumber() == null) {
            ticket.setTableNumber(payload.tableNumber());
        }
        // Order type is stable for the order's lifetime; backfill on a later revision if the
        // initial fire predated this field (null-safe for legacy tickets).
        if (ticket.getOrderType() == null) {
            ticket.setOrderType(payload.orderType());
        }

        KdsTicket saved = ticketRepository.save(ticket);
        webSocketHandler.notifySubscribers(saved.getBranchId(), saved.getStationCode(), ticketService.toDto(saved));
        log.info("Appended revision to ticket: order={} station={} newItems={} revisionNo={}",
                payload.orderId(), ticket.getStationCode(), appended.size(), payload.revisionNo());
    }

    private void createNewTicket(OrderSentToKdsPayload payload, String orderNo, String stationCode,
                                  List<OrderSentToKdsItem> stationItems, StationRef ref) {
        UUID branchId = tenantContext.getBranchId().orElseThrow(() ->
                new IllegalStateException("TenantContext missing branchId"));
        upsertStation(branchId, stationCode, ref);

        KdsTicket ticket = new KdsTicket();
        ticket.setTenantId(tenantContext.requireTenantId());
        ticket.setBranchId(branchId);
        ticket.setOrderId(payload.orderId());
        ticket.setOrderNo(orderNo);
        ticket.setOrderNotes(payload.orderNotes());
        ticket.setTableNumber(payload.tableNumber());
        ticket.setOrderType(payload.orderType());
        ticket.setStationCode(stationCode);
        ticket.setStationId(ref.stationId());
        ticket.setReceivedAt(Instant.now());

        List<KdsTicketItem> items = buildItems(stationItems, ticket, payload.revisionNo());
        ticket.setItems(items);
        KdsTicket saved = ticketRepository.save(ticket);
        // Push the brand-new ticket to KDS subscribers so a first-fire order appears on the board
        // LIVE (previously only revision appends pushed — a new order waited for the 10s fallback
        // poll). Mirrors the notify in appendToExistingTicket and every mutation in TicketServiceImpl.
        webSocketHandler.notifySubscribers(saved.getBranchId(), saved.getStationCode(), ticketService.toDto(saved));
        log.info("Routed ticket: order={} station={} items={}", payload.orderId(), stationCode, items.size());
    }

    /**
     * Station PROJECTION upsert (Phase 3, evolves the KDS-04 auto-seed): ensures a
     * {@code kds_stations} row exists for (branchId, code) before a ticket is routed to it, and
     * projects the canonical station data carried on the event — a REAL name (from
     * {@code stationName}) instead of the old {@code name = code} auto-vivify, plus the canonical
     * {@code source_station_id}. On a subsequent route it refreshes name/source if the event now
     * carries them (e.g. a station created/renamed via admin CRUD after the first free-text fire).
     * Find-first / create-on-miss mirrors the finance 07.2 pattern; the DB's
     * uq_station_tenant_branch_code unique constraint (V1) backstops a race between concurrent
     * routes for the same never-yet-seen station. The board is never empty for a fresh branch.
     */
    private void upsertStation(UUID branchId, String code, StationRef ref) {
        Optional<KdsStation> existing = stationRepository.findByBranchIdAndCode(branchId, code);
        if (existing.isPresent()) {
            KdsStation station = existing.get();
            boolean dirty = false;
            // Promote a placeholder (name == code, from a legacy free-text auto-vivify) to the
            // real canonical name once the event supplies one.
            if (ref.stationName() != null && !ref.stationName().isBlank()
                    && !ref.stationName().equals(station.getName())
                    && station.getName() != null && station.getName().equals(code)) {
                station.setName(ref.stationName());
                dirty = true;
            }
            if (station.getSourceStationId() == null && ref.stationId() != null) {
                station.setSourceStationId(ref.stationId());
                dirty = true;
            }
            if (dirty) {
                stationRepository.save(station);
            }
            return;
        }
        KdsStation station = new KdsStation();
        station.setTenantId(tenantContext.requireTenantId());
        station.setBranchId(branchId);
        station.setCode(code);
        // Real projected name when the event carries one; else fall back to the code (the prior
        // auto-vivify behavior) so DEFAULT / legacy free-text stations still get a name.
        station.setName(ref.stationName() != null && !ref.stationName().isBlank()
                ? ref.stationName() : code);
        station.setActive(true);
        station.setSourceStationId(ref.stationId());
        station.setEscalationThresholdSeconds(900);
        stationRepository.save(station);
        log.info("Projected station: branch={} code={} sourceStationId={}", branchId, code, ref.stationId());
    }

    /** Builds new KdsTicketItems for a station's items, stamping revisionNo/firedAt from the payload. */
    private List<KdsTicketItem> buildItems(List<OrderSentToKdsItem> stationItems, KdsTicket ticket, int revisionNo) {
        List<KdsTicketItem> items = new ArrayList<>();
        Instant firedAt = Instant.now();
        for (OrderSentToKdsItem raw : stationItems) {
            KdsTicketItem item = new KdsTicketItem();
            item.setTenantId(tenantContext.requireTenantId());
            item.setTicket(ticket);
            item.setOrderItemId(raw.orderItemId());
            item.setName(raw.name());
            item.setQty(raw.qty());
            item.setModifiers(raw.modifiers());
            item.setNotes(raw.notes());
            item.setRevisionNo(revisionNo > 0 ? revisionNo : 1);
            item.setFiredAt(firedAt);
            items.add(item);
        }
        return items;
    }

    private Map<String, List<OrderSentToKdsItem>> groupByStation(List<OrderSentToKdsItem> items) {
        Map<String, List<OrderSentToKdsItem>> result = new LinkedHashMap<>();
        for (OrderSentToKdsItem item : items) {
            String station = (item.kdsStation() == null || item.kdsStation().isBlank())
                    ? DEFAULT_STATION : item.kdsStation();
            result.computeIfAbsent(station, k -> new ArrayList<>()).add(item);
        }
        return result;
    }
}
