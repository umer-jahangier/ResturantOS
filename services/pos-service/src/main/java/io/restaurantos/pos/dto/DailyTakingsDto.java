package io.restaurantos.pos.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * What a restaurant owner looks at first, every evening (37-09, D-37-02).
 *
 * <p>Gross sales, discounts, net sales, tax, service charge and the total billed for a trading day,
 * split by tender, set against what each till actually counted. <b>A cash variance is shown AS a
 * variance and is never silently absorbed</b> — that is the whole point of the screen, and
 * absorbing it is how a short drawer becomes invisible.
 *
 * <h2>NET SALES AND TOTAL BILLED ARE DIFFERENT FIGURES</h2>
 *
 * <p>{@code gross − discounts = net sales}. {@code net sales + tax + service charge = total
 * billed}. Net sales is the revenue line; tax is a liability owed onward and never sits inside it.
 * Collapsing the two onto one field, under the name of the smaller one, was the F5 defect.
 *
 * <p>The trading day is {@code (t − 4h)} in UTC, the SAME rule pos-service applies when it checks
 * the accounting period and stamps the ORDER_CLOSED event, so this screen and the general ledger
 * bucket a sale identically. See 37-03 for what happened when a consumer re-derived it.
 *
 * <h2>TWO BASES, ON PURPOSE — and the screen says which is which</h2>
 *
 * <p>{@code t} is not the same column for every figure here, and collapsing them onto one was the
 * S0-02 defect:
 *
 * <ul>
 *   <li><b>The sales figures</b> ({@code grossSalesPaisa} … {@code orderCount}) are dated by
 *       {@code orders.closed_at}. A sale is <i>made</i> when the bill is finalised, which is the
 *       instant finance recognises the revenue.</li>
 *   <li><b>{@code byTender}</b> is dated by {@code order_payments.recorded_at} — <i>when the money
 *       physically arrived</i>. This is the drawer basis, and it is the same basis
 *       {@code TillServiceImpl.closeTill} already uses when it computes a till's expected closing
 *       (it sums every CASH payment on that till's orders, closed or not).</li>
 * </ul>
 *
 * <p>Dating the tender split by {@code closed_at} made the two disagree: an order that is paid but
 * not yet served stays OPEN (POS-23 closes only on paid AND served), so its cash was in the drawer,
 * counted by the till, and absent from this screen's CASH line, its gross and its net
 * simultaneously. A manager reconciling the drawer had no number to reconcile against.
 *
 * <p>{@link #unclosed} is the bridge between the two bases, and it exists so the difference is
 * <b>stated rather than left to be discovered</b>: it is the money already taken today that sits
 * against orders which have not closed. Nothing is counted twice — a payment is dated once, by
 * {@code recorded_at}; closing its order later moves the SALE into that later day's gross and net
 * and leaves the PAYMENT exactly where it was.
 */
public record DailyTakingsDto(
        LocalDate businessDate,
        UUID branchId,

        /** The full menu price of everything sold, before any discount. Dated by {@code closed_at}. */
        long grossSalesPaisa,
        long discountsPaisa,

        /**
         * <b>Net sales, as a restaurant P&amp;L means it: gross − discounts, tax EXCLUDED.</b>
         *
         * <p>This field used to carry {@code SUM(orders.total_paisa)} — the bill total — and the
         * screen labelled it "Net sales". The result was a takings page where NET SALES
         * (Rs 45,966.40) was <i>larger</i> than GROSS SALES (Rs 43,350.00), because tax had been
         * added into the figure the word "net" promises to have taken things out of. An accountant
         * reading that mis-states revenue by the whole output-tax liability, and output tax is not
         * revenue at all — it is money collected on the tax authority's behalf and owed onward.
         *
         * <p>The invariant that makes the screen readable, and which
         * {@code DailyTakingsNetSalesIT} asserts: {@code netSalesPaisa ≤ grossSalesPaisa}, always.
         */
        long netSalesPaisa,

        long taxPaisa,
        long serviceChargePaisa,

        /**
         * What the bills actually came to: {@code net + tax + service charge}, i.e.
         * {@code SUM(orders.total_paisa)}.
         *
         * <p>This is the figure that reconciles against the tender split and the drawer, and it is
         * the number that was previously mislabelled {@code netSalesPaisa}. It is stated as its own
         * field rather than left to a reader to add up, because a screen that makes someone do
         * arithmetic on money is a screen someone will do it wrong on.
         */
        long totalBilledPaisa,

        /** Orders CLOSED on this trading day. Not the number of orders that took money. */
        int orderCount,

        /** How the money arrived, dated by when it arrived — NOT by when its order closed. */
        List<TenderLine> byTender,
        List<TillReconciliation> tills,

        /** Of the money in {@link #byTender}, how much is sitting against orders still open. */
        UnclosedTakings unclosed,

        /**
         * Figures this screen could NOT compute, each with the reason (D-37-05). Never a plausible
         * zero: a fabricated total is worse than a blank one, because decisions get made on it.
         */
        List<UnknownFigure> unknowns
) {
    /**
     * One tender method's contribution to the day, dated by {@code order_payments.recorded_at}.
     *
     * @param amountPaisa          everything taken on this method today, open orders included
     * @param unclosedAmountPaisa  the part of {@code amountPaisa} whose order is NOT yet closed.
     *                             A SUBSET, never an addition — adding the two double-counts.
     */
    public record TenderLine(String method, long amountPaisa, int paymentCount,
                             long unclosedAmountPaisa, int unclosedPaymentCount) {}

    /**
     * Money taken today that has not yet become a closed sale.
     *
     * <p>This is why the drawer can hold more than the day's net sales, and it is a figure the
     * cash-up needs BEFORE anyone counts: without it a manager finds the surplus by hand and has
     * no way to tell an unclosed order from a genuine overage.
     *
     * @param orderCount how many distinct orders those payments sit against
     */
    public record UnclosedTakings(long cashPaisa, long totalPaisa, int orderCount, int paymentCount) {}

    /**
     * One till, and whether it matched.
     *
     * @param expectedClosingPaisa opening float + cash taken − cash refunded, as the system computes it
     * @param declaredClosingPaisa what the human counted in the drawer
     * @param variancePaisa        declared − expected. NEGATIVE means the drawer is SHORT.
     */
    public record TillReconciliation(
            UUID tillSessionId,
            UUID cashierId,
            String status,
            long openingFloatPaisa,
            Long expectedClosingPaisa,
            Long declaredClosingPaisa,
            Long variancePaisa,
            Instant openedAt,
            Instant closedAt,
            /** OPEN, MATCHED, OVER, SHORT, or NOT_COUNTED — never inferred from a null. */
            String reconciliationState
    ) {}

    /** A figure that could not be computed, and why. */
    public record UnknownFigure(String figure, String reason) {}
}
