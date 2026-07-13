package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.enums.OrderStatus;

import java.util.List;
import java.util.UUID;

/**
 * Admin till-review payload (POS till reconciliation): a single till session plus every order
 * that fell within it and the money it collected. Backs the "table of tills the admin can
 * review" — opening/closing, cashier, branch, and all order ids in the session.
 *
 * @param liveExpectedCashPaisa running expected cash = openingFloat + cashCollected. Unlike the
 *        entity's {@code expectedClosingPaisa} (NULL until the till is closed), this is always
 *        computed, so an OPEN till shows real accumulating cash instead of 0.
 */
public record TillReconciliationDto(
        TillSessionDto session,
        int orderCount,
        long cashCollectedPaisa,
        long nonCashCollectedPaisa,
        long liveExpectedCashPaisa,
        List<TillOrderLine> orders
) {
    public record TillOrderLine(
            UUID orderId,
            String orderNo,
            OrderStatus status,
            long totalPaisa,
            long paidPaisa
    ) {}
}
