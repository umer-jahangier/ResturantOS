package io.restaurantos.shared.event.payload;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * THE wire contract for the {@code pos.topic} events consumed outside pos-service.
 *
 * <p>Scope is deliberate: only the events that CROSS a service boundary into inventory, finance,
 * crm or reporting live here. The pos↔kitchen pair (ORDER_SENT_TO_KDS, ORDER_READY,
 * KITCHEN_ITEM_STATUS_CHANGED, item served/cancelled) keeps its service-local records — that loop
 * is bidirectional, healthy, and covered by its own parity ITs, and moving it would be churn
 * without a defect to justify it.
 *
 * @see InventoryEventContract for why these records are shared rather than duplicated
 */
public final class PosEventContract {

    private PosEventContract() {}

    public static final String EXCHANGE = "pos.topic";

    public static final String ORDER_CLOSED = "ORDER_CLOSED";
    public static final String ORDER_REFUNDED = "ORDER_REFUNDED";
    public static final String TILL_CLOSED = "TILL_CLOSED";

    public static final String ORDER_CLOSED_KEY = "pos.order.closed";
    public static final String ORDER_REFUNDED_KEY = "pos.order.refunded";
    public static final String TILL_CLOSED_KEY = "pos.till.closed";

    /**
     * ORDER_CLOSED — emitted exactly once per close, from the single {@code maybeCloseOrder}
     * (Paid AND Served) seam. Consumed by inventory (depletion), finance (revenue JE), crm
     * (loyalty accrual) and reporting (sales facts).
     *
     * <p><b>Money invariant:</b> {@code sum(payments[].amountPaisa) == totalPaisa}, and
     * {@code totalPaisa == subtotalPaisa - discountPaisa + taxPaisa + serviceChargePaisa}. Both
     * halves matter to finance, which debits the payments and credits the components — if they
     * disagree the journal entry cannot balance and the deferred DB trigger rejects it.
     * pos-service enforces the first by capping each payment at the outstanding balance
     * (over-tender is recorded as change, not as revenue) and the second in
     * {@code OrderPricingCalculator}.
     *
     * <p>{@code customerId} is nullable — walk-in orders have no customer, and crm skips those.
     */
    public record OrderClosedPayload(
            UUID orderId,
            String orderNo,
            String type,
            UUID customerId,
            long subtotalPaisa,
            long discountPaisa,
            long serviceChargePaisa,
            long taxPaisa,
            long totalPaisa,
            List<PaymentEntry> payments,
            List<ItemEntry> items,
            UUID tillSessionId,
            UUID cashierId,
            /**
             * Every discount on this check, individually, with its reason and the person who
             * authorised it (B3).
             *
             * <p>{@code discountPaisa} above is the sum and is what finance posts to
             * contra-revenue; that has not changed. This list exists because the sum is not an
             * answer to the question an owner asks the morning after — <em>why</em> did we give
             * Rs 950 away, and who said so? Without it the Discount Summary report could only
             * ever be a column of totals, and the amount could not be told apart from a comp.
             *
             * <p>Nullable on the wire for the same reason every other addition here is: an
             * ORDER_CLOSED published by a service that predates this field must still be
             * consumable. Readers treat null as "no discounts recorded", never as an error.
             */
            List<DiscountEntry> discounts,
            Instant closedAt,
            /**
             * The trading day this sale belongs to, resolved by pos-service from {@code closedAt}
             * via {@link io.restaurantos.shared.time.BusinessDay} — the SAME date it checked the
             * accounting period against. finance dates the journal entry from this rather than
             * re-deriving from the envelope's publish timestamp, so the period POS validated and
             * the period the entry lands in can never disagree.
             */
            LocalDate businessDate
    ) {
        /**
         * The pre-B3 shape, kept so that adding {@code discounts} was not a breaking change for
         * anything that builds this payload without one — every consumer's IT fixture, and any
         * producer that has not been rebuilt. Defaults to an empty list, never null: "no
         * discounts were recorded" is a fact a reader can iterate, whereas null is a fact a
         * reader has to remember to check for.
         */
        public OrderClosedPayload(UUID orderId, String orderNo, String type, UUID customerId,
                                  long subtotalPaisa, long discountPaisa, long serviceChargePaisa,
                                  long taxPaisa, long totalPaisa, List<PaymentEntry> payments,
                                  List<ItemEntry> items, UUID tillSessionId, UUID cashierId,
                                  Instant closedAt, LocalDate businessDate) {
            this(orderId, orderNo, type, customerId, subtotalPaisa, discountPaisa,
                    serviceChargePaisa, taxPaisa, totalPaisa, payments, items, tillSessionId,
                    cashierId, List.of(), closedAt, businessDate);
        }
    }

    /**
     * {@code amountPaisa} is the amount APPLIED to the bill, never the amount handed over.
     * {@code tenderedPaisa} and {@code changePaisa} carry the cash-drawer reality for the till
     * reconciliation and are informational to the ledger.
     */
    public record PaymentEntry(
            String method,
            long amountPaisa,
            long tenderedPaisa,
            long changePaisa,
            String referenceNo
    ) {}

    public record ItemEntry(
            UUID menuItemId,
            String name,
            int qty,
            long unitPricePaisa,
            long lineTotalPaisa
    ) {}

    /**
     * One discount taken off this check.
     *
     * <p>{@code valuePct} and {@code amountPaisa} are two different facts and both are carried:
     * what was ASKED for ("10%", or a flat rupee figure) and what actually came OFF after
     * capping. They diverge whenever a discount is larger than what is left of the line, and a
     * report that shows only one of them cannot explain the other.
     *
     * @param scope         LINE or ORDER
     * @param itemName      the line's name for a LINE discount; null for a whole-check discount
     * @param type          FLAT, PERCENT, or PROMOTION for the automatic engine's own rows
     * @param amountPaisa   what came off the bill, in paisa. Positive
     * @param reason        why it was given. Never blank for a discount applied since V22
     * @param appliedBy     the user id that authorised it
     * @param appliedByName their display name at the time, or null if it was not resolvable
     */
    public record DiscountEntry(
            String scope,
            UUID orderItemId,
            String itemName,
            String type,
            java.math.BigDecimal value,
            long amountPaisa,
            String reason,
            UUID appliedBy,
            String appliedByName
    ) {}

    /**
     * ORDER_REFUNDED.
     *
     * <p>{@code taxPaisa} is the output-tax component of the refund, apportioned by pos-service
     * from the original order. finance needs it to reverse the tax liability: without it the
     * refund recipe debited the whole amount to a revenue contra account and left account 2200
     * untouched, so Phase 12's FBR Tax Summary — output tax minus input tax — overstated net
     * payable by the tax on every refund. The refunding service knows the original order's tax
     * basis; the ledger should not have to guess it.
     *
     * <p>{@code customerId} is here for the same class of reason. crm-service's refund consumer
     * has always read a {@code customerId} off this payload and returned early when it was
     * absent — and it was ALWAYS absent, because the payload never carried one. So loyalty points
     * accrued on every order and were debited back on none of them, silently, for the whole life
     * of the feature. Nullable, exactly as on ORDER_CLOSED: a walk-in refund has no customer.
     */
    public record OrderRefundedPayload(
            UUID orderId,
            UUID customerId,
            long refundPaisa,
            long taxPaisa,
            String reason,
            UUID refundedBy
    ) {}

    /** TILL_CLOSED — consumed by reporting's till-session ETL. */
    public record TillClosedPayload(
            UUID tillSessionId,
            long expectedCashPaisa,
            long countedCashPaisa,
            long variancePaisa,
            UUID cashierId
    ) {}
}
