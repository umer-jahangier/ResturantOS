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
