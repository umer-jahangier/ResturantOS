package io.restaurantos.pos.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * What a restaurant owner looks at first, every evening (37-09, D-37-02).
 *
 * <p>Gross sales, discounts, tax, service charge and net for a trading day, split by tender, set
 * against what each till actually counted. <b>A cash variance is shown AS a variance and is never
 * silently absorbed</b> — that is the whole point of the screen, and absorbing it is how a short
 * drawer becomes invisible.
 *
 * <p>The trading day is {@code (closed_at − 4h)} in UTC, the SAME rule pos-service applies when it
 * checks the accounting period and stamps the ORDER_CLOSED event, so this screen and the general
 * ledger bucket a sale identically. See 37-03 for what happened when a consumer re-derived it.
 */
public record DailyTakingsDto(
        LocalDate businessDate,
        UUID branchId,

        /** The full menu price of everything sold, before any discount. */
        long grossSalesPaisa,
        long discountsPaisa,
        long taxPaisa,
        long serviceChargePaisa,
        /** What the bills actually came to: gross − discounts + tax + service charge. */
        long netSalesPaisa,
        int orderCount,

        List<TenderLine> byTender,
        List<TillReconciliation> tills,

        /**
         * Figures this screen could NOT compute, each with the reason (D-37-05). Never a plausible
         * zero: a fabricated total is worse than a blank one, because decisions get made on it.
         */
        List<UnknownFigure> unknowns
) {
    /** One tender method's contribution to the day. */
    public record TenderLine(String method, long amountPaisa, int paymentCount) {}

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
