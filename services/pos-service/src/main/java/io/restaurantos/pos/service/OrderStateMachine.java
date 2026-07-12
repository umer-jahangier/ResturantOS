package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.shared.exception.StateInvalidException;
import org.springframework.stereotype.Component;

import java.util.EnumMap;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * Defines legal order status transitions and enforces them.
 * Uses a Map of allowed target states per source state.
 */
@Component
public class OrderStateMachine {

    private static final Map<OrderStatus, Set<OrderStatus>> TRANSITIONS = new EnumMap<>(OrderStatus.class);

    static {
        TRANSITIONS.put(OrderStatus.DRAFT, EnumSet.of(OrderStatus.OPEN, OrderStatus.VOIDED));
        TRANSITIONS.put(OrderStatus.OPEN, EnumSet.of(
                OrderStatus.SENT_TO_KDS,
                OrderStatus.CLOSED,
                OrderStatus.VOIDED));
        TRANSITIONS.put(OrderStatus.SENT_TO_KDS, EnumSet.of(
                OrderStatus.PARTIAL_READY,
                OrderStatus.READY,
                OrderStatus.CLOSED,
                OrderStatus.VOIDED));
        TRANSITIONS.put(OrderStatus.PARTIAL_READY, EnumSet.of(
                OrderStatus.READY,
                OrderStatus.CLOSED,
                OrderStatus.VOIDED));
        TRANSITIONS.put(OrderStatus.READY, EnumSet.of(
                OrderStatus.SERVED,
                OrderStatus.CLOSED,
                OrderStatus.VOIDED));
        TRANSITIONS.put(OrderStatus.SERVED, EnumSet.of(
                OrderStatus.CLOSED,
                OrderStatus.VOIDED));
        TRANSITIONS.put(OrderStatus.CLOSED, EnumSet.of(OrderStatus.REFUNDED));
        TRANSITIONS.put(OrderStatus.VOIDED, EnumSet.noneOf(OrderStatus.class));
        TRANSITIONS.put(OrderStatus.REFUNDED, EnumSet.noneOf(OrderStatus.class));
    }

    /**
     * Asserts the transition from -> to is legal.
     * Throws StateInvalidException (409) if not allowed.
     */
    public void assertTransition(OrderStatus from, OrderStatus to) {
        Set<OrderStatus> allowed = TRANSITIONS.getOrDefault(from, EnumSet.noneOf(OrderStatus.class));
        if (!allowed.contains(to)) {
            throw new StateInvalidException(
                    "Illegal order transition: " + from + " -> " + to
                    + ". Allowed transitions from " + from + ": " + allowed);
        }
    }
}
