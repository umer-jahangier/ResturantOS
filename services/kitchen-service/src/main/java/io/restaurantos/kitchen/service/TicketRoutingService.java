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

            Optional<KdsTicket> existing = ticketRepository
                    .findByOrderIdAndStationCode(payload.orderId(), stationCode);

            if (existing.isPresent()) {
                appendToExistingTicket(existing.get(), stationItems, payload);
            } else {
                createNewTicket(payload, orderNo, stationCode, stationItems);
            }
        }
    }

    /**
     * A revision fire for an order that already has a ticket at this station: append the
     * new items (stamped with the payload's revisionNo/firedAt) and reopen the ticket if it
     * had already reached READY, then push the updated ticket to WebSocket subscribers.
     */
    private void appendToExistingTicket(KdsTicket ticket, List<OrderSentToKdsItem> stationItems,
                                         OrderSentToKdsPayload payload) {
        List<KdsTicketItem> appended = buildItems(stationItems, ticket, payload.revisionNo());
        ticket.getItems().addAll(appended);

        if (ticket.getStatus() == TicketStatus.READY) {
            ticket.setStatus(TicketStatus.PENDING);
            ticket.setReadyAt(null);
        }

        // Latest revision's order-level notes win — the kitchen sees current instructions.
        ticket.setOrderNotes(payload.orderNotes());

        // Table number may not have been known/set on the initial fire (e.g. assigned after
        // the first send) — refresh it from a later revision if the ticket doesn't have one yet.
        if (ticket.getTableNumber() == null) {
            ticket.setTableNumber(payload.tableNumber());
        }

        KdsTicket saved = ticketRepository.save(ticket);
        webSocketHandler.notifySubscribers(saved.getBranchId(), saved.getStationCode(), ticketService.toDto(saved));
        log.info("Appended revision to ticket: order={} station={} newItems={} revisionNo={}",
                payload.orderId(), ticket.getStationCode(), appended.size(), payload.revisionNo());
    }

    private void createNewTicket(OrderSentToKdsPayload payload, String orderNo, String stationCode,
                                  List<OrderSentToKdsItem> stationItems) {
        UUID branchId = tenantContext.getBranchId().orElseThrow(() ->
                new IllegalStateException("TenantContext missing branchId"));
        ensureStation(branchId, stationCode);

        KdsTicket ticket = new KdsTicket();
        ticket.setTenantId(tenantContext.requireTenantId());
        ticket.setBranchId(branchId);
        ticket.setOrderId(payload.orderId());
        ticket.setOrderNo(orderNo);
        ticket.setOrderNotes(payload.orderNotes());
        ticket.setTableNumber(payload.tableNumber());
        ticket.setStationCode(stationCode);
        ticket.setReceivedAt(Instant.now());

        List<KdsTicketItem> items = buildItems(stationItems, ticket, payload.revisionNo());
        ticket.setItems(items);
        ticketRepository.save(ticket);
        log.info("Routed ticket: order={} station={} items={}", payload.orderId(), stationCode, items.size());
    }

    /**
     * Idempotent station upsert (KDS-04): ensures a station row exists for (branchId, code)
     * before a ticket is routed to it, so the board is never empty for a fresh branch and every
     * station a ticket lands on is visible via GET /stations. Mirrors the finance 07.2
     * auto-seed-on-miss pattern — find first, create on miss; the DB's
     * uq_station_tenant_branch_code unique constraint (V1) backstops a race between concurrent
     * routes for the same never-yet-seen station.
     */
    private void ensureStation(UUID branchId, String code) {
        if (stationRepository.findByBranchIdAndCode(branchId, code).isPresent()) {
            return;
        }
        KdsStation station = new KdsStation();
        station.setTenantId(tenantContext.requireTenantId());
        station.setBranchId(branchId);
        station.setCode(code);
        station.setName(code);
        station.setActive(true);
        station.setEscalationThresholdSeconds(900);
        stationRepository.save(station);
        log.info("Seeded station: branch={} code={}", branchId, code);
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
