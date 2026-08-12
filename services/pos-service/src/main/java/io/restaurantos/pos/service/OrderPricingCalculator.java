package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.model.BranchMenuOverride;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.domain.model.OrderItem;
import io.restaurantos.pos.domain.model.OrderItemModifier;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

/**
 * Pure money-math calculator for POS order pricing.
 * All amounts are BIGINT paisa. Per-line tax is half-up to nearest paisa on discounted base.
 * Discount floor: discount cannot reduce line below 0 paisa.
 */
@Component
public class OrderPricingCalculator {

    /**
     * Effective unit price: branch override if present, else base price.
     */
    public long effectiveUnitPrice(MenuItem menuItem, BranchMenuOverride override) {
        if (override != null && override.getPricePaisa() != null) {
            return override.getPricePaisa();
        }
        return menuItem.getBasePricePaisa();
    }

    /**
     * Line subtotal before discounts: (unitPrice + sum of modifier deltas) * qty.
     */
    public long lineSubtotal(long unitPricePaisa, List<Long> modifierDeltas, int quantity) {
        long modifierTotal = modifierDeltas.stream().mapToLong(Long::longValue).sum();
        return (unitPricePaisa + modifierTotal) * quantity;
    }

    /**
     * The same subtotal, for a line that is already PERSISTED — the one definition the order-level
     * recompute must use (S6).
     *
     * <h2>Why this exists</h2>
     *
     * <p>{@code OrderServiceImpl.recomputeOrderTotals} computed {@code unitPriceSnapshot * quantity}
     * with its own arithmetic, inline, and therefore left the modifier deltas out. While every
     * delta was hard-coded to zero by the {@code addItem} stub that S6 replaced, the two agreed by
     * accident. The moment a modifier carried a real price they diverged: two plates of Karahi with
     * extra cheese showed a LINE total of Rs 2,000.00 and an ORDER total of Rs 1,700.00 — the
     * screen, the printed bill and the journal entry disagreeing by Rs 300.00 on the same check.
     *
     * <p>Line pricing and order pricing are now the same function of the same fields, so they
     * cannot drift again. {@code taxPaisa} is NOT recomputed here on purpose: it was snapshotted at
     * add-item time against this very subtotal (see {@code OrderItem.taxRatePct}), and re-deriving
     * it at recompute time is what re-attributed old money to a new rate before V23.
     */
    public long lineSubtotal(OrderItem item) {
        long modifierTotal = item.getModifiers() == null ? 0L
                : item.getModifiers().stream()
                        .mapToLong(OrderItemModifier::getPriceDeltaPaisa)
                        .sum();
        return (item.getUnitPriceSnapshot() + modifierTotal) * item.getQuantity();
    }

    /**
     * Effective discount: min(requestedDiscount, lineSubtotal) so line cannot go negative.
     */
    public long effectiveDiscount(long requestedDiscountPaisa, long lineSubtotalPaisa) {
        return Math.min(requestedDiscountPaisa, lineSubtotalPaisa);
    }

    /**
     * Net line after discount: max(0, lineSubtotal - effectiveDiscount).
     */
    public long lineNet(long lineSubtotalPaisa, long effectiveDiscountPaisa) {
        return Math.max(0L, lineSubtotalPaisa - effectiveDiscountPaisa);
    }

    /**
     * Per-line tax: taxRatePct applied to net line, rounded HALF_UP to nearest paisa.
     */
    public long perLineTax(long lineNetPaisa, BigDecimal taxRatePct) {
        if (taxRatePct == null || taxRatePct.compareTo(BigDecimal.ZERO) == 0) {
            return 0L;
        }
        BigDecimal taxDecimal = taxRatePct.divide(BigDecimal.valueOf(100), 10, RoundingMode.HALF_UP);
        BigDecimal taxPaisa = BigDecimal.valueOf(lineNetPaisa).multiply(taxDecimal);
        return taxPaisa.setScale(0, RoundingMode.HALF_UP).longValue();
    }

    /**
     * Line total paisa = lineNet + tax.
     */
    public long lineTotal(long lineNetPaisa, long taxPaisa) {
        return lineNetPaisa + taxPaisa;
    }

    /**
     * The branch's service charge on one check: {@code base * ratePct / 100}, HALF_UP to whole
     * paisa (F20).
     *
     * <p><b>The base is the net-of-discount, PRE-TAX subtotal.</b> Charging a percentage of a
     * tax-inclusive figure would take a cut of the government's money, and charging it on the
     * gross subtotal would bill the guest for a percentage of a discount they were just given —
     * the same mistake {@code lineDiscountBase} exists to prevent one level down.
     *
     * <p><b>The service charge is not taxed here.</b> It is added after tax, and
     * {@code recomputeOrderTotals} leaves {@code taxPaisa} as the sum of the per-line figures
     * stamped at add-item time. Whether a service charge is itself standard-rated is a real
     * question with a real answer, and it is a change to what the ledger owes FBR — it belongs
     * with the tax work, not smuggled in behind a settings toggle. Until then the arithmetic on
     * the paper is exactly what it says: subtotal, less discount, plus tax, plus the charge.
     *
     * <p>The multiplication happens before the division and entirely in {@link BigDecimal}, so a
     * rate such as {@code 2.50} is applied as written rather than as its nearest binary double.
     * Same rule, same direction, as {@link #perLineTax} and as hr-service's {@code PercentOfPaisa}.
     *
     * @param basePaisa the amount to charge a percentage of; negative is clamped to zero
     * @param ratePct   the branch's rate, e.g. {@code 5.00} meaning five percent. Null or
     *                  non-positive yields zero — a branch with no policy has no charge
     */
    public long serviceCharge(long basePaisa, BigDecimal ratePct) {
        if (ratePct == null || ratePct.compareTo(BigDecimal.ZERO) <= 0 || basePaisa <= 0) {
            return 0L;
        }
        return BigDecimal.valueOf(basePaisa)
                .multiply(ratePct)
                .divide(BigDecimal.valueOf(100), 0, RoundingMode.HALF_UP)
                .longValueExact();
    }

    /**
     * Compute and apply totals to the order item in-place.
     * Returns the computed line total for aggregation.
     */
    public LineResult computeItemLine(long unitPricePaisa,
                                     List<Long> modifierDeltas,
                                     int quantity,
                                     long requestedDiscountPaisa,
                                     BigDecimal taxRatePct) {
        long subtotal = lineSubtotal(unitPricePaisa, modifierDeltas, quantity);
        long discount = effectiveDiscount(requestedDiscountPaisa, subtotal);
        long net = lineNet(subtotal, discount);
        long tax = perLineTax(net, taxRatePct);
        long total = lineTotal(net, tax);
        return new LineResult(subtotal, discount, tax, total);
    }

    /**
     * Order-level aggregated totals from computed items.
     */
    public OrderTotals aggregateOrderTotals(List<OrderItem> items,
                                             long orderLevelDiscountPaisa,
                                             long serviceChargePaisa) {
        long subtotal = 0L;
        long discount = 0L;
        long tax = 0L;

        for (OrderItem item : items) {
            subtotal += item.getLineTotalPaisa() + item.getDiscountPaisa() - item.getTaxPaisa();
            discount += item.getDiscountPaisa();
            tax += item.getTaxPaisa();
        }

        long effectiveOrderDiscount = Math.min(orderLevelDiscountPaisa, subtotal - discount);
        if (effectiveOrderDiscount < 0) effectiveOrderDiscount = 0L;
        long totalDiscount = discount + effectiveOrderDiscount;

        long total = Math.max(0L, subtotal - totalDiscount + tax + serviceChargePaisa);

        return new OrderTotals(subtotal, totalDiscount, tax, serviceChargePaisa, total);
    }

    public record LineResult(long subtotalPaisa, long discountPaisa, long taxPaisa, long lineTotalPaisa) {}

    public record OrderTotals(long subtotalPaisa, long discountPaisa, long taxPaisa,
                               long serviceChargePaisa, long totalPaisa) {}
}
