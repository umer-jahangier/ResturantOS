package io.restaurantos.pos.domain.enums;

/**
 * What a line's sales tax is a percentage OF, once a discount is on the check (V27).
 *
 * <p>The two charges on a bill used to answer this question differently. Tax was the per-line
 * figure V23 snapshots at add-item time, taken on the GROSS line and never revisited; the service
 * charge V24 introduced was recomputed on the NET of every discount. A discount therefore moved
 * one and not the other, and the guest was billed output tax on food that was never sold at that
 * price. This enum is the answer, named, so that the two can be made to agree and so that a bill
 * can say which rule priced it.
 *
 * <p>Deliberately NOT a boolean. {@code discountReducesTaxBase = false} is a fact a reader has to
 * reason about; {@code GROSS} is one they can act on — and the person reading it is usually
 * reconciling a return.
 */
public enum TaxBase {

    /**
     * Tax is charged on the line after its share of every discount.
     *
     * <p>The default, and the normal Pakistani value-of-supply position where the discount is
     * shown on the invoice — which this product does show: {@code orders.discount_paisa} prints on
     * every bill and B3 gave every discount its own reviewable row. It is also what
     * {@code OrderPricingCalculator.perLineTax} has always documented and computed; before V27
     * that path simply never ran on a real discount.
     */
    NET,

    /**
     * Tax is charged on the undiscounted line.
     *
     * <p>What every check written before V27 was charged, because it was the only thing the code
     * could do. Available to a tenant whose filed position is that the pre-discount price is the
     * value of supply — a question about their business and their jurisdiction that this codebase
     * is not entitled to answer for them.
     */
    GROSS
}
