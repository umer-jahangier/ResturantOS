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
 *
 * <p><b>S0-01 — why REFUNDED is reachable from every paid state, not only from CLOSED.</b>
 * {@code CLOSED -> REFUNDED} used to be the only edge into REFUNDED, and {@code X -> VOIDED}
 * was legal from every non-terminal state. An order is only CLOSED once it is fully Paid AND
 * fully Served ({@code OrderServiceImpl.maybeCloseOrder}), so the ordinary paid check — cash
 * taken, food still on the pass, status {@code SENT_TO_KDS} — could be VOIDED but never
 * REFUNDED. The destructive operation was the reachable one and the corrective operation was
 * not, which is exactly backwards: a void writes no reversing money row, so it stranded the
 * payment.
 *
 * <p>Opening these edges does NOT make a refund a free-for-all. This class answers only "is
 * this shape of transition legal"; {@code RefundServiceImpl} still refuses a refund on an order
 * with no recorded payment and caps the amount at the unrefunded balance, and
 * {@code OrderServiceImpl.voidOrder} refuses a void once any payment exists. The two services
 * partition the space between them: money taken -> refund, no money taken -> void.
 */
@Component
public class OrderStateMachine {

    private static final Map<OrderStatus, Set<OrderStatus>> TRANSITIONS = new EnumMap<>(OrderStatus.class);

    static {
        TRANSITIONS.put(OrderStatus.DRAFT, EnumSet.of(OrderStatus.OPEN, OrderStatus.VOIDED));
        TRANSITIONS.put(OrderStatus.OPEN, EnumSet.of(
                OrderStatus.SENT_TO_KDS,
                OrderStatus.CLOSED,
                OrderStatus.VOIDED,
                OrderStatus.REFUNDED));
        TRANSITIONS.put(OrderStatus.SENT_TO_KDS, EnumSet.of(
                OrderStatus.SENT_TO_KDS, // self-loop: repeated sendToKds fires (POS-12 revisions)
                OrderStatus.PARTIAL_READY,
                OrderStatus.READY,
                OrderStatus.CLOSED,
                OrderStatus.VOIDED,
                OrderStatus.REFUNDED));
        TRANSITIONS.put(OrderStatus.PARTIAL_READY, EnumSet.of(
                OrderStatus.PARTIAL_READY, // self-loop: repeated sendToKds fires (POS-12 revisions)
                OrderStatus.READY,
                OrderStatus.CLOSED,
                OrderStatus.VOIDED,
                OrderStatus.REFUNDED));
        TRANSITIONS.put(OrderStatus.READY, EnumSet.of(
                OrderStatus.READY, // self-loop: repeated sendToKds fires (POS-12 revisions)
                OrderStatus.SERVED,
                OrderStatus.CLOSED,
                OrderStatus.VOIDED,
                OrderStatus.REFUNDED));
        TRANSITIONS.put(OrderStatus.SERVED, EnumSet.of(
                OrderStatus.CLOSED,
                OrderStatus.VOIDED,
                OrderStatus.REFUNDED));
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
