package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.domain.model.OrderRefund;
import io.restaurantos.pos.dto.OrderSummaryDto;
import io.restaurantos.pos.dto.OrderSummaryDto.SettlementDetail;
import io.restaurantos.pos.repository.OrderRefundRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Why a terminal order is terminal — the missing half of the Order Management list (S0-04).
 *
 * <h2>The defect this closes</h2>
 *
 * <p>A voided order was reachable from nowhere in the product. Order Management offered seven
 * filter chips (All, Draft, In Progress, Partially Served, Served, Closed, Paid) and every one of
 * them excluded VOIDED and REFUNDED, so an owner could not see that a check had been voided at
 * all, let alone why or by whom. The list API could always serve them — {@code ?status=VOIDED}
 * has worked the whole time — but nothing ever asked, and even when asked the row carried no
 * reason and no actor, because {@code void_reason} was never projected into the summary and the
 * actor was never persisted anywhere at all (it lived only inside the ORDER_VOIDED event).
 *
 * <h2>Why it is a separate pass and not part of the row builder</h2>
 *
 * <p>{@code OrderServiceImpl.listOrderSummaries} is the hot path for the ACTIVE order list, which
 * a busy till refetches on every mount and window focus. None of those rows are terminal, so this
 * service returns the page untouched for them without issuing a single query. Work is done only
 * for the rows that are actually VOIDED or REFUNDED — i.e. essentially only when a manager has
 * selected the Voided or Refunded chip.
 *
 * <h2>Where each field comes from</h2>
 *
 * <ul>
 *   <li><b>VOIDED</b> — {@code orders.void_reason}, {@code orders.voided_by} (V21),
 *       {@code orders.voided_at}. One batched {@code findAllById} for the whole page.</li>
 *   <li><b>REFUNDED</b> — the most recent {@code order_refunds} row for the order, which carries
 *       the reason and {@code refunded_by}. An order reaches REFUNDED only when every paisa taken
 *       has been given back, and the refund path writes a row for each tender it reverses.</li>
 * </ul>
 *
 * <p>The actor's NAME is resolved through {@link StaffNameDirectory} (itself backed by
 * {@link io.restaurantos.pos.feign.AuthUserDirectoryClient}) and is decoration: if auth-service is
 * unreachable the id still renders and the screen still works. The id is the fact.
 *
 * <p>F2 moved the name cache OUT of this class and into {@link StaffNameDirectory}, because the
 * Server/Cashier column needs the very same lookup for a frequently DIFFERENT person on the same
 * row — a manager voids a cashier's check — and two private caches would have asked auth-service
 * for the same people twice per render.
 */
@Service
public class OrderSettlementDetailService {

    /** The two outcomes that have a reason and an actor. CLOSED is a settlement, not an exception. */
    private static final Set<OrderStatus> EXPLAINED_STATUSES =
            EnumSet.of(OrderStatus.VOIDED, OrderStatus.REFUNDED);

    private final OrderRepository orderRepository;
    private final OrderRefundRepository orderRefundRepository;
    private final StaffNameDirectory staffNameDirectory;
    private final TenantContext tenantContext;

    public OrderSettlementDetailService(OrderRepository orderRepository,
                                        OrderRefundRepository orderRefundRepository,
                                        StaffNameDirectory staffNameDirectory,
                                        TenantContext tenantContext) {
        this.orderRepository = orderRepository;
        this.orderRefundRepository = orderRefundRepository;
        this.staffNameDirectory = staffNameDirectory;
        this.tenantContext = tenantContext;
    }

    /**
     * The same rows back, with {@code settlement} filled in on the VOIDED/REFUNDED ones.
     *
     * <p>Returns the argument unchanged (same list instance) when the page holds no terminal row,
     * which is the overwhelmingly common case.
     */
    @Transactional(readOnly = true)
    public List<OrderSummaryDto> withSettlementDetail(List<OrderSummaryDto> rows) {
        if (rows == null || rows.isEmpty()) {
            return rows;
        }

        List<UUID> explainedIds = rows.stream()
                .filter(r -> r.settlementStatus() != null
                        && EXPLAINED_STATUSES.contains(r.settlementStatus()))
                .map(OrderSummaryDto::orderId)
                .toList();
        if (explainedIds.isEmpty()) {
            return rows;
        }

        UUID tenantId = tenantContext.requireTenantId();

        // The ids came from a query already scoped to the caller's branch, but this lookup is by
        // primary key, so the tenant predicate is re-asserted here rather than assumed. pos_db's
        // tables are ENABLE (not FORCE) RLS and the application owns them, so there is no database
        // backstop to fall through to — see the note in listOrderSummaries.
        Map<UUID, Order> orders = orderRepository.findAllById(explainedIds).stream()
                .filter(o -> tenantId.equals(o.getTenantId()))
                .collect(Collectors.toMap(Order::getId, o -> o));

        Map<UUID, SettlementDetail> detailByOrderId = new HashMap<>();
        Map<UUID, String> nameByUserId = new HashMap<>();

        for (UUID orderId : explainedIds) {
            Order order = orders.get(orderId);
            if (order == null) {
                continue;
            }
            SettlementDetail detail = order.getStatus() == OrderStatus.VOIDED
                    ? voidDetail(order)
                    : refundDetail(order);
            if (detail == null) {
                continue;
            }
            if (detail.byUserId() != null) {
                nameByUserId.computeIfAbsent(detail.byUserId(),
                        id -> staffNameDirectory.resolve(tenantId, id));
            }
            detailByOrderId.put(orderId, detail);
        }

        return rows.stream()
                .map(row -> {
                    SettlementDetail detail = detailByOrderId.get(row.orderId());
                    if (detail == null) {
                        return row;
                    }
                    String name = detail.byUserId() == null ? null : nameByUserId.get(detail.byUserId());
                    return row.withSettlement(new SettlementDetail(
                            detail.reason(), detail.byUserId(), name, detail.at()));
                })
                .toList();
    }

    private SettlementDetail voidDetail(Order order) {
        return new SettlementDetail(order.getVoidReason(), order.getVoidedBy(), null, order.getVoidedAt());
    }

    /**
     * The refund that ended this order, i.e. the most recently created {@code order_refunds} row.
     *
     * <p>A full reversal of a split tender writes one row per method, all with the same reason,
     * the same actor and the same instant — so "the last one" and "any of them" agree, and taking
     * the last one is also correct after a sequence of partials that finally reached the total.
     *
     * <p>Null when there is no row at all: a legacy REFUNDED order from before the refund path
     * recorded them. The UI says "Not recorded" rather than inventing an attribution.
     */
    private SettlementDetail refundDetail(Order order) {
        List<OrderRefund> refunds = orderRefundRepository.findByOrderId(order.getId());
        if (refunds.isEmpty()) {
            return new SettlementDetail(null, null, null, order.getUpdatedAt());
        }
        OrderRefund latest = refunds.stream()
                .max(Comparator.comparing(OrderRefund::getCreatedAt,
                        Comparator.nullsFirst(Comparator.naturalOrder())))
                .orElseThrow();
        return new SettlementDetail(latest.getReason(), latest.getRefundedBy(), null,
                latest.getCreatedAt());
    }
}
