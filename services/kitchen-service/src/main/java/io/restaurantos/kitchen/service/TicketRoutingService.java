package io.restaurantos.kitchen.service;

import io.restaurantos.kitchen.domain.model.KdsTicket;
import io.restaurantos.kitchen.domain.model.KdsTicketItem;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsItem;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsPayload;
import io.restaurantos.kitchen.repository.KdsTicketRepository;
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

/**
 * Routes ORDER_SENT_TO_KDS items to one KdsTicket per (order, station).
 * Items with null or unrecognised station code are routed to "DEFAULT".
 * Idempotent: skips if a ticket already exists for (orderId, stationCode).
 */
@Service
public class TicketRoutingService {

    private static final Logger log = LoggerFactory.getLogger(TicketRoutingService.class);
    private static final String DEFAULT_STATION = "DEFAULT";

    private final KdsTicketRepository ticketRepository;
    private final TenantContext tenantContext;

    public TicketRoutingService(KdsTicketRepository ticketRepository, TenantContext tenantContext) {
        this.ticketRepository = ticketRepository;
        this.tenantContext = tenantContext;
    }

    @Transactional
    public void route(OrderSentToKdsPayload payload, String orderNo) {
        Map<String, List<OrderSentToKdsItem>> byStation = groupByStation(payload.items());

        for (Map.Entry<String, List<OrderSentToKdsItem>> entry : byStation.entrySet()) {
            String stationCode = entry.getKey();
            List<OrderSentToKdsItem> stationItems = entry.getValue();

            boolean alreadyExists = ticketRepository
                    .findByOrderIdAndStationCode(payload.orderId(), stationCode)
                    .isPresent();
            if (alreadyExists) {
                log.debug("Ticket already exists for order={} station={} — skipping (idempotent)",
                        payload.orderId(), stationCode);
                continue;
            }

            KdsTicket ticket = new KdsTicket();
            ticket.setTenantId(tenantContext.requireTenantId());
            ticket.setBranchId(tenantContext.getBranchId().orElseThrow(() ->
                    new IllegalStateException("TenantContext missing branchId")));
            ticket.setOrderId(payload.orderId());
            ticket.setOrderNo(orderNo);
            ticket.setStationCode(stationCode);
            ticket.setReceivedAt(Instant.now());

            List<KdsTicketItem> items = new ArrayList<>();
            for (OrderSentToKdsItem raw : stationItems) {
                KdsTicketItem item = new KdsTicketItem();
                item.setTenantId(tenantContext.requireTenantId());
                item.setTicket(ticket);
                item.setOrderItemId(raw.orderItemId());
                item.setName(raw.name());
                item.setQty(raw.qty());
                item.setModifiers(raw.modifiers());
                item.setNotes(raw.notes());
                items.add(item);
            }
            ticket.setItems(items);
            ticketRepository.save(ticket);
            log.info("Routed ticket: order={} station={} items={}", payload.orderId(), stationCode, items.size());
        }
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
