package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.DerivedOrderStatus;
import io.restaurantos.pos.domain.enums.OrderItemStatus;
import io.restaurantos.pos.domain.model.OrderItem;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * Pure derivation of the aggregate order status from its line-level item statuses.
 * No repository access, no side effects — mirrors {@link SplitTenderCalculator}'s
 * pure-calculation-service shape.
 *
 * This is the ONLY seam where derived order status is computed (POS-11:
 * "computed, never hand-set"). Every mutation path that changes item status
 * (sendToKds, ORDER_READY consumer, markServed, cancelItem) must call
 * {@link #derive(List)} rather than setting Order.derivedStatus directly.
 */
@Service
public class OrderStatusDerivationService {

    /**
     * Derive the aggregate {@link DerivedOrderStatus} from a list of order line items.
     * CANCELLED lines are excluded from the computation entirely.
     *
     * <ul>
     *   <li>No active (non-cancelled) lines, or all active lines PENDING -&gt; DRAFT</li>
     *   <li>All active lines SERVED -&gt; SERVED</li>
     *   <li>&gt;=1 active line SERVED (but not all) -&gt; PARTIALLY_SERVED</li>
     *   <li>Otherwise (&gt;=1 line SENT/ACCEPTED/PREPARING/READY, none SERVED) -&gt; IN_PROGRESS</li>
     * </ul>
     */
    public DerivedOrderStatus derive(List<OrderItem> items) {
        List<OrderItem> active = items.stream()
                .filter(i -> i.getItemStatus() != OrderItemStatus.CANCELLED)
                .toList();

        if (active.isEmpty() || active.stream().allMatch(i -> i.getItemStatus() == OrderItemStatus.PENDING)) {
            return DerivedOrderStatus.DRAFT;
        }

        if (active.stream().allMatch(i -> i.getItemStatus() == OrderItemStatus.SERVED)) {
            return DerivedOrderStatus.SERVED;
        }

        boolean anyServed = active.stream().anyMatch(i -> i.getItemStatus() == OrderItemStatus.SERVED);
        return anyServed ? DerivedOrderStatus.PARTIALLY_SERVED : DerivedOrderStatus.IN_PROGRESS;
    }
}
