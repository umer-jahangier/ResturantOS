package io.restaurantos.pos.service;

import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.domain.model.OrderItem;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * Pure calculator for split-tender rounding and validation.
 * No DB calls — all arithmetic only.
 *
 * Rounding rule (BLR-1): remainder always goes to the FIRST share, never distributed.
 */
@Service
public class SplitTenderCalculator {

    public record PaymentEntry(String method, long amountPaisa, String referenceNo) {}

    /**
     * Validate that the sum of payment entries exactly equals totalPaisa.
     * Throws PaymentMismatchException (422) if not.
     */
    public void validateExact(List<PaymentEntry> payments, long totalPaisa) {
        long sum = payments.stream().mapToLong(PaymentEntry::amountPaisa).sum();
        if (sum != totalPaisa) {
            throw new PosExceptions.PaymentMismatchException(totalPaisa, sum);
        }
    }

    /**
     * Split total paisa equally among n diners.
     * Remainder goes to FIRST share only (never distributed across shares).
     *
     * Example: 1000 / 3 = [334, 333, 333]
     */
    public List<Long> equalSplit(long total, int n) {
        if (n <= 0) throw new IllegalArgumentException("Split count must be positive");
        if (total == 0) {
            List<Long> zeros = new ArrayList<>(n);
            for (int i = 0; i < n; i++) zeros.add(0L);
            return zeros;
        }

        long share = total / n;
        long remainder = total % n;

        List<Long> shares = new ArrayList<>(n);
        shares.add(share + remainder); // remainder to first share
        for (int i = 1; i < n; i++) {
            shares.add(share);
        }
        return shares;
    }

    /**
     * Split order subtotal proportionally by item, then add proportional
     * tax+service-charge with first-share remainder.
     */
    public List<Long> byItemSplit(List<OrderItem> items, int diners) {
        if (diners <= 0) throw new IllegalArgumentException("Diners must be positive");

        long subtotal = items.stream().mapToLong(i -> i.getUnitPriceSnapshot() * i.getQuantity()).sum();
        long tax = items.stream().mapToLong(OrderItem::getTaxPaisa).sum();

        long totalWithTax = subtotal + tax;
        return equalSplit(totalWithTax, diners);
    }
}
