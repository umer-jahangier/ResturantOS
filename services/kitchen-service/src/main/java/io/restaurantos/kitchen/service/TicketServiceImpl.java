package io.restaurantos.kitchen.service;

import io.restaurantos.kitchen.domain.enums.TicketItemStatus;
import io.restaurantos.kitchen.domain.enums.TicketStatus;
import io.restaurantos.kitchen.domain.model.KdsTicket;
import io.restaurantos.kitchen.domain.model.KdsTicketItem;
import io.restaurantos.kitchen.dto.KdsTicketDto;
import io.restaurantos.kitchen.event.KitchenEventPayloads.ItemStatusChangedPayload;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderReadyPayload;
import io.restaurantos.kitchen.repository.KdsTicketItemRepository;
import io.restaurantos.kitchen.repository.KdsTicketRepository;
import io.restaurantos.kitchen.ws.KdsWebSocketHandler;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Ticket and item lifecycle management. Publishes ORDER_READY when all tickets for an order
 * reach READY or CANCELLED status (no remaining PENDING/COOKING tickets).
 */
@Service
@Transactional
public class TicketServiceImpl implements TicketService {

    private static final Logger log = LoggerFactory.getLogger(TicketServiceImpl.class);

    private static final String KITCHEN_EXCHANGE = "kitchen.topic";
    private static final String ORDER_READY_ROUTING_KEY = "kitchen.order.ready";
    private static final String ORDER_READY_TYPE = "ORDER_READY";
    private static final String ITEM_STATUS_CHANGED_ROUTING_KEY = "kitchen.item.status-changed";
    private static final String ITEM_STATUS_CHANGED_TYPE = "KITCHEN_ITEM_STATUS_CHANGED";

    private final KdsTicketRepository ticketRepository;
    private final KdsTicketItemRepository ticketItemRepository;
    private final EventPublisher eventPublisher;
    private final KdsWebSocketHandler webSocketHandler;

    public TicketServiceImpl(KdsTicketRepository ticketRepository,
                              KdsTicketItemRepository ticketItemRepository,
                              EventPublisher eventPublisher,
                              KdsWebSocketHandler webSocketHandler) {
        this.ticketRepository = ticketRepository;
        this.ticketItemRepository = ticketItemRepository;
        this.eventPublisher = eventPublisher;
        this.webSocketHandler = webSocketHandler;
    }

    @Override
    public KdsTicketDto markItemStatus(UUID ticketId, UUID itemId, TicketItemStatus newStatus) {
        KdsTicket ticket = ticketRepository.findById(ticketId)
                .orElseThrow(() -> new ResourceNotFoundException("Ticket not found: " + ticketId));

        KdsTicketItem item = ticket.getItems().stream()
                .filter(i -> i.getId().equals(itemId))
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("Item not found: " + itemId));

        validateTransition(item.getStatus(), newStatus);
        item.setStatus(newStatus);

        boolean movingToActive = newStatus == TicketItemStatus.COOKING
                || newStatus == TicketItemStatus.ACCEPTED
                || newStatus == TicketItemStatus.PREPARING;
        if (movingToActive && ticket.getStatus() == TicketStatus.PENDING) {
            ticket.setStatus(TicketStatus.COOKING);
            ticket.setStartedAt(Instant.now());
        }

        if (newStatus == TicketItemStatus.READY) {
            long remaining = ticketItemRepository.countByTicketIdAndStatusNotReady(ticketId);
            if (remaining == 0) {
                ticket.setStatus(TicketStatus.READY);
                ticket.setReadyAt(Instant.now());

                checkAndPublishOrderReady(ticket);
            }
        }

        KdsTicket saved = ticketRepository.save(ticket);

        // POS-20 (D-05): publish a fine-grained per-item event on EVERY transition (not only
        // READY) so pos-service can reflect live item status without a manual reopen. This is
        // additive to — and never replaces — the aggregate ORDER_READY path above.
        eventPublisher.publish(
                KITCHEN_EXCHANGE,
                ITEM_STATUS_CHANGED_ROUTING_KEY,
                ITEM_STATUS_CHANGED_TYPE,
                saved.getBranchId(),
                new ItemStatusChangedPayload(
                        saved.getOrderId(), item.getOrderItemId(), newStatus.name(),
                        item.getRevisionNo(), saved.getStationCode())
        );

        KdsTicketDto dto = toDto(saved);
        webSocketHandler.notifySubscribers(saved.getBranchId(), saved.getStationCode(), dto);
        return dto;
    }

    @Override
    public KdsTicketDto bumpItem(UUID ticketId, UUID itemId) {
        KdsTicket ticket = ticketRepository.findById(ticketId)
                .orElseThrow(() -> new ResourceNotFoundException("Ticket not found: " + ticketId));

        TicketItemStatus current = ticket.getItems().stream()
                .filter(i -> i.getId().equals(itemId))
                .findFirst()
                .map(KdsTicketItem::getStatus)
                .orElseThrow(() -> new ResourceNotFoundException("Item not found: " + itemId));

        // Existing bump flow stays PENDING -> COOKING -> READY (unchanged this plan);
        // ACCEPTED/PREPARING are the target kitchen-owned lifecycle subset, wired here
        // only so the enum extension remains exhaustive/compilable — no caller currently
        // reaches these two states via bumpItem.
        TicketItemStatus next = switch (current) {
            case PENDING -> TicketItemStatus.COOKING;
            case ACCEPTED -> TicketItemStatus.PREPARING;
            case PREPARING, COOKING -> TicketItemStatus.READY;
            case READY -> throw new StateInvalidException("Item already READY");
            case CANCELLED -> throw new StateInvalidException("Cannot bump a cancelled item");
            case SERVED -> throw new StateInvalidException("Cannot bump a served item");
        };

        return markItemStatus(ticketId, itemId, next);
    }

    @Override
    public KdsTicketDto recallTicket(UUID ticketId) {
        KdsTicket ticket = ticketRepository.findById(ticketId)
                .orElseThrow(() -> new ResourceNotFoundException("Ticket not found: " + ticketId));

        if (ticket.getStatus() != TicketStatus.READY) {
            throw new StateInvalidException("Only READY tickets can be recalled");
        }

        ticket.setStatus(TicketStatus.COOKING);
        ticket.setReadyAt(null);
        ticket.getItems().forEach(item -> {
            if (item.getStatus() == TicketItemStatus.READY) {
                item.setStatus(TicketItemStatus.COOKING);
            }
        });

        KdsTicket saved = ticketRepository.save(ticket);
        KdsTicketDto dto = toDto(saved);
        webSocketHandler.notifySubscribers(saved.getBranchId(), saved.getStationCode(), dto);
        return dto;
    }

    @Override
    public void cancelTicketsForOrder(UUID orderId) {
        List<KdsTicket> tickets = ticketRepository.findByOrderId(orderId);
        for (KdsTicket ticket : tickets) {
            if (ticket.getStatus() != TicketStatus.CANCELLED) {
                ticket.setStatus(TicketStatus.CANCELLED);
                KdsTicket saved = ticketRepository.save(ticket);
                // Push so a voided order clears from the KDS board LIVE (this was the lone mutation
                // path that omitted the notify — voids previously lingered until the 10s fallback poll).
                webSocketHandler.notifySubscribers(saved.getBranchId(), saved.getStationCode(), toDto(saved));
                log.info("Cancelled ticket={} for order={}", ticket.getId(), orderId);
            }
        }
    }

    @Override
    public void cancelTicketItem(UUID orderItemId) {
        ticketItemRepository.findByOrderItemId(orderItemId).ifPresentOrElse(item -> {
            if (item.getStatus() == TicketItemStatus.CANCELLED) {
                return; // idempotent
            }
            item.setStatus(TicketItemStatus.CANCELLED);
            KdsTicket ticket = item.getTicket();
            // A cancelled line no longer blocks the ticket — if every remaining line is ready,
            // flip the ticket to READY now (mirrors markItemStatus' completion check).
            if (ticketItemRepository.countByTicketIdAndStatusNotReady(ticket.getId()) == 0
                    && ticket.getStatus() != TicketStatus.READY
                    && ticket.getStatus() != TicketStatus.CANCELLED
                    && ticket.getStatus() != TicketStatus.SERVED) {
                ticket.setStatus(TicketStatus.READY);
                ticket.setReadyAt(Instant.now());
            }
            KdsTicket saved = ticketRepository.save(ticket);
            webSocketHandler.notifySubscribers(saved.getBranchId(), saved.getStationCode(), toDto(saved));
            log.info("Cancelled KDS line orderItemId={} on ticket={}", orderItemId, ticket.getId());
        }, () -> log.debug("cancelTicketItem: no KDS line for orderItemId={} (never fired)", orderItemId));
    }

    @Override
    public void serveTicketItem(UUID orderItemId) {
        ticketItemRepository.findByOrderItemId(orderItemId).ifPresentOrElse(item -> {
            if (item.getStatus() == TicketItemStatus.SERVED
                    || item.getStatus() == TicketItemStatus.CANCELLED) {
                return; // idempotent / already terminal
            }
            item.setStatus(TicketItemStatus.SERVED);
            KdsTicket ticket = item.getTicket();
            // A served line has left the pass — if every remaining line is ready, flip the ticket
            // to READY now (mirrors cancelTicketItem's completion check; SERVED is excluded from
            // the not-ready count, so it never blocks the ticket).
            if (ticketItemRepository.countByTicketIdAndStatusNotReady(ticket.getId()) == 0
                    && ticket.getStatus() != TicketStatus.READY
                    && ticket.getStatus() != TicketStatus.CANCELLED
                    && ticket.getStatus() != TicketStatus.SERVED) {
                ticket.setStatus(TicketStatus.READY);
                ticket.setReadyAt(Instant.now());
            }
            KdsTicket saved = ticketRepository.save(ticket);
            // Push so the served line leaves the board LIVE, instead of lingering in the Ready
            // column until the whole order closes (the bug this fixes).
            webSocketHandler.notifySubscribers(saved.getBranchId(), saved.getStationCode(), toDto(saved));
            log.info("Served KDS line orderItemId={} on ticket={}", orderItemId, ticket.getId());
        }, () -> log.debug("serveTicketItem: no KDS line for orderItemId={} (never fired)", orderItemId));
    }

    @Override
    public void serveTicketsForOrder(UUID orderId) {
        List<KdsTicket> tickets = ticketRepository.findByOrderId(orderId);
        for (KdsTicket ticket : tickets) {
            if (ticket.getStatus() != TicketStatus.SERVED
                    && ticket.getStatus() != TicketStatus.CANCELLED) {
                ticket.setStatus(TicketStatus.SERVED);
                KdsTicket saved = ticketRepository.save(ticket);
                webSocketHandler.notifySubscribers(saved.getBranchId(), saved.getStationCode(), toDto(saved));
                log.info("Served (order closed) ticket={} for order={}", ticket.getId(), orderId);
            }
        }
    }

    @Override
    @Transactional(readOnly = true)
    public KdsTicketDto getTicketDetail(UUID ticketId) {
        KdsTicket ticket = ticketRepository.findDetailById(ticketId)
                .orElseThrow(() -> new ResourceNotFoundException("Ticket not found: " + ticketId));
        return toDto(ticket);
    }

    private void checkAndPublishOrderReady(KdsTicket readyTicket) {
        long pendingOrCooking = ticketRepository.findByOrderId(readyTicket.getOrderId()).stream()
                .filter(t -> t.getStatus() == TicketStatus.PENDING || t.getStatus() == TicketStatus.COOKING)
                .count();

        if (pendingOrCooking == 0) {
            OrderReadyPayload payload = new OrderReadyPayload(
                    readyTicket.getOrderId(),
                    readyTicket.getStationCode(),
                    readyTicket.getReadyAt()
            );
            eventPublisher.publish(
                    KITCHEN_EXCHANGE,
                    ORDER_READY_ROUTING_KEY,
                    ORDER_READY_TYPE,
                    readyTicket.getBranchId(),
                    payload
            );
            log.info("Published ORDER_READY for order={}", readyTicket.getOrderId());
        }
    }

    private void validateTransition(TicketItemStatus current, TicketItemStatus next) {
        boolean valid = switch (current) {
            case PENDING -> next == TicketItemStatus.COOKING || next == TicketItemStatus.ACCEPTED;
            case ACCEPTED -> next == TicketItemStatus.PREPARING;
            case PREPARING, COOKING -> next == TicketItemStatus.READY;
            case READY -> false;
            case CANCELLED -> false; // terminal — no manual transitions out of cancelled
            case SERVED -> false;    // terminal — served lines are set only by the pos event path
        };
        if (!valid) {
            throw new StateInvalidException(
                    "Invalid item status transition: " + current + " -> " + next);
        }
    }

    public KdsTicketDto toDto(KdsTicket ticket) {
        List<KdsTicketDto.ItemDto> itemDtos = ticket.getItems().stream()
                .map(i -> new KdsTicketDto.ItemDto(
                        i.getId(), i.getOrderItemId(), i.getName(),
                        i.getQty(), i.getModifiers(), i.getNotes(), i.getStatus(),
                        i.getRevisionNo(), i.getFiredAt()))
                .toList();

        return new KdsTicketDto(
                ticket.getId(), ticket.getOrderId(), ticket.getOrderNo(),
                ticket.getOrderNotes(), ticket.getTableNumber(), ticket.getOrderType(),
                ticket.getStationCode(), ticket.getStatus(),
                ticket.isPriority(), ticket.getReceivedAt(), ticket.getStartedAt(), ticket.getReadyAt(),
                itemDtos
        );
    }
}
