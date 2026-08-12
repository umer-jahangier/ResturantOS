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

    /**
     * The line statuses that mean food physically exists: plated on the pass, or already carried
     * to the table. An {@link EnumSet} rather than an {@code ordinal() >= READY} comparison on
     * purpose — {@link OrderItemStatus#CANCELLED} is declared AFTER {@code SERVED}, so an ordinal
     * test would count a cancelled line as plated, and a future reordering of the enum would
     * change the policy boundary silently.
     */
    private static final Set<OrderItemStatus> PLATED_STATUSES =
            EnumSet.of(OrderItemStatus.READY, OrderItemStatus.SERVED);

    /**
     * Has the kitchen plated anything on this check?
     *
     * <p><b>Why this is not {@link #derive(List)}.</b> {@code derive} answers a SERVING question
     * and deliberately collapses SENT / ACCEPTED / PREPARING / READY into a single
     * {@link DerivedOrderStatus#IN_PROGRESS}: for the floor map and the settlement screen, "the
     * kitchen has it" is one state. Authorization asks a different question — has cooked food
     * come into existence — and {@code IN_PROGRESS} cannot answer it, because a check plated and
     * waiting under the heat lamp is indistinguishable from one fired five seconds ago.
     *
     * <p><b>Why it is derived and not persisted.</b> Same reason {@code derivedStatus} is computed
     * through this one seam (POS-11, "computed, never hand-set"): a second writer on a stored
     * column is how {@code order.status}'s kitchen-progress meaning rotted in the first place. The
     * three {@link io.restaurantos.pos.domain.enums.OrderStatus} values PARTIAL_READY / READY /
     * SERVED were retired in {@code fc6f389f} for exactly that reason and are still declared but
     * never written. This is read at decision time from the lines themselves, so it cannot drift
     * out of step with them and needs no migration.
     *
     * <p>CANCELLED lines are excluded, matching {@code derive}: a line the kitchen was told to
     * bin is not food anyone can serve. A check whose every line was cancelled is therefore not
     * plated, and its cashier may still write it off alone.
     */
    public boolean anyLinePlated(List<OrderItem> items) {
        return items.stream()
                .filter(i -> i.getItemStatus() != OrderItemStatus.CANCELLED)
                .anyMatch(i -> PLATED_STATUSES.contains(i.getItemStatus()));
    }
}
