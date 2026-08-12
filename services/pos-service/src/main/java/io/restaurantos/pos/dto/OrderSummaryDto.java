package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.enums.DerivedOrderStatus;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.OrderType;
import io.restaurantos.pos.domain.enums.PaymentStatus;

import java.time.Instant;
import java.util.UUID;

/**
 * Order Management list row (POS-09). Plain, service-constructed record — no {@code from()}
 * factory (mirrors {@link MenuCategoryDto}'s shape, not {@link DiningTableDto}'s), since
 * building it requires joining table-name data the entity alone doesn't carry.
 *
 * POS-24: extended with settlement + payment + item-quantity data so Order Management can
 * show closed/paid orders, a payment-status badge, and an item-quantity column without a
 * second round trip per row. {@code settlementStatus} is the raw {@link OrderStatus} (distinct
 * from {@code derivedStatus}'s kitchen-progress meaning); {@code paymentStatus}/
 * {@code amountPaidPaisa} are server-derived via {@link io.restaurantos.pos.service.PaymentStatusDerivationService}
 * and a batched payment-sum lookup (no N+1); {@code itemQuantity}/{@code distinctItemCount}
 * exclude CANCELLED lines.
 *
 * <p>S0-04: {@code settlement} carries WHY and BY WHOM a terminal order ended that way. It is
 * populated by {@link io.restaurantos.pos.service.OrderSettlementDetailService} <i>after</i> the
 * page is built — never by the row-building code — and is null on every non-terminal row.
 *
 * <p>F2: {@code type} and {@code cashierName} close the two things this row LIED about.
 *
 * <ul>
 *   <li>{@code type} — the row carried no order type at all, so the client rendered
 *       {@code tableName ?? "Takeaway"} and every tableless DINE_IN check read <i>Takeaway</i>.
 *       Measured 2026-08-12: ten of ten rows on the first page were DINE_IN on the server and
 *       Takeaway on the screen. It is a column of the order row and costs nothing to project —
 *       it comes straight off the entity in the same pass that reads the total.</li>
 *   <li>{@code cashierName} — decoration, resolved by
 *       {@link io.restaurantos.pos.service.OrderCashierNameService} in a pass after the page is
 *       built, exactly like {@code settlement.byName}. Null when the directory could not be
 *       reached; the client falls back to the id and never to a blank.</li>
 * </ul>
 */
public record OrderSummaryDto(
        UUID orderId,
        String orderNo,
        UUID tableId,
        String tableName,
        OrderType type,
        DerivedOrderStatus derivedStatus,
        UUID cashierId,
        String cashierName,
        int coverCount,
        long totalPaisa,
        Instant openedAt,
        OrderStatus settlementStatus,
        PaymentStatus paymentStatus,
        long amountPaidPaisa,
        int itemQuantity,
        int distinctItemCount,
        SettlementDetail settlement
) {

    /**
     * Why a terminal order is terminal, in the words of the person who made it so.
     *
     * <p>VOIDED reads {@code orders.void_reason} / {@code orders.voided_by} / {@code voided_at};
     * REFUNDED reads the most recent {@code order_refunds} row. {@code byName} is resolved from
     * auth-service and is <b>decoration</b>: it degrades to null without failing the list, because
     * a directory hiccup must never blank a manager's order screen. {@code byUserId} is the fact
     * and is always present when the platform recorded one.
     *
     * <p>This actor is frequently NOT the row's cashier — a manager voids the cashier's check —
     * which is why {@code cashierName} is resolved separately rather than reused from here.
     *
     * @param reason   free-text reason captured at void/refund time; null for rows written before
     *                 the field existed
     * @param byUserId the actor's user id (JWT sub) — null means the platform never recorded one
     * @param byName   the actor's display name, or null when auth-service could not be reached
     * @param at       when the settlement happened
     */
    public record SettlementDetail(String reason, UUID byUserId, String byName, Instant at) {}

    /**
     * The un-enriched row: everything the row builder can read from the order itself.
     *
     * <p>The two enrichment-only fields ({@code cashierName}, {@code settlement}) are the ones
     * left out, because both are resolved in separate passes after the page is built. {@code type}
     * is deliberately NOT optional here — it is a fact about the order, and the previous shape of
     * this constructor, which let the row be built without one, is exactly what let the client
     * guess it from the table name.
     */
    public OrderSummaryDto(
            UUID orderId,
            String orderNo,
            UUID tableId,
            String tableName,
            OrderType type,
            DerivedOrderStatus derivedStatus,
            UUID cashierId,
            int coverCount,
            long totalPaisa,
            Instant openedAt,
            OrderStatus settlementStatus,
            PaymentStatus paymentStatus,
            long amountPaidPaisa,
            int itemQuantity,
            int distinctItemCount) {
        this(orderId, orderNo, tableId, tableName, type, derivedStatus, cashierId, null,
                coverCount, totalPaisa, openedAt, settlementStatus, paymentStatus, amountPaidPaisa,
                itemQuantity, distinctItemCount, null);
    }

    /** This row with its settlement provenance attached. Records are immutable; this is the copy. */
    public OrderSummaryDto withSettlement(SettlementDetail detail) {
        return new OrderSummaryDto(orderId, orderNo, tableId, tableName, type, derivedStatus,
                cashierId, cashierName, coverCount, totalPaisa, openedAt, settlementStatus,
                paymentStatus, amountPaidPaisa, itemQuantity, distinctItemCount, detail);
    }

    /** This row with its cashier's display name attached. */
    public OrderSummaryDto withCashierName(String name) {
        return new OrderSummaryDto(orderId, orderNo, tableId, tableName, type, derivedStatus,
                cashierId, name, coverCount, totalPaisa, openedAt, settlementStatus,
                paymentStatus, amountPaidPaisa, itemQuantity, distinctItemCount, settlement);
    }
}
