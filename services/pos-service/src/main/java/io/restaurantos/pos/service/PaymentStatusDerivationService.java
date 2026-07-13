package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentStatus;
import org.springframework.stereotype.Service;

/**
 * Pure derivation of an order's {@link PaymentStatus} from the sum of its persisted
 * {@code OrderPayment} rows vs its total. No repository access, no side effects — mirrors
 * {@link OrderStatusDerivationService}'s pure-calculation-service shape (POS-23).
 *
 * Derivation order (07.3-CONTEXT Specific Ideas):
 * <ol>
 *   <li>{@code settlementStatus == REFUNDED} -&gt; REFUNDED (settlement status wins over the sum)</li>
 *   <li>{@code paidPaisa <= 0} -&gt; UNPAID</li>
 *   <li>{@code paidPaisa < totalPaisa} -&gt; PARTIALLY_PAID</li>
 *   <li>otherwise -&gt; PAID (overpay clamps to PAID, never a negative/invalid state)</li>
 * </ol>
 */
@Service
public class PaymentStatusDerivationService {

    public PaymentStatus derive(long paidPaisa, long totalPaisa, OrderStatus settlementStatus) {
        if (settlementStatus == OrderStatus.REFUNDED) {
            return PaymentStatus.REFUNDED;
        }
        if (paidPaisa <= 0) {
            return PaymentStatus.UNPAID;
        }
        if (paidPaisa < totalPaisa) {
            return PaymentStatus.PARTIALLY_PAID;
        }
        return PaymentStatus.PAID;
    }
}
