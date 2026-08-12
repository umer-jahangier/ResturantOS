package io.restaurantos.pos.exception;

import io.restaurantos.shared.exception.ResourceNotFoundException;

/**
 * POS-specific exception factory and custom exception types.
 */
public class PosExceptions {

    public static class OrderNotFoundException extends ResourceNotFoundException {
        public OrderNotFoundException(String orderId) {
            super("Order not found: " + orderId);
        }
    }

    public static class ZeroValueOrderException extends RuntimeException {
        public ZeroValueOrderException(String message) {
            super(message);
        }
    }

    public static class TillAlreadyOpenException extends RuntimeException {
        public TillAlreadyOpenException(String cashierId) {
            super("Cashier already has an open till session: " + cashierId);
        }

        private TillAlreadyOpenException(String message, Void namedForm) {
            super(message);
        }

        /**
         * The same conflict, said to a manager who named somebody else (F11).
         *
         * <p>"Cashier already has an open till session: &lt;uuid&gt;" is unreadable when the uuid is
         * not yours — and before F11 it was actively misleading, because the id it printed was the
         * CALLER's: the supplied cashierId was dropped and the manager was told about their own
         * drawer. Naming the person is the whole point of the message.
         */
        public static TillAlreadyOpenException forCashier(String cashierName) {
            return new TillAlreadyOpenException(
                    cashierName + " already has an open till. Cash up that drawer before opening "
                            + "another one for them.", null);
        }
    }

    /**
     * A cashier tried to open a drawer under somebody else's name (F11).
     *
     * <p>Deliberately distinct from a bare {@link io.restaurantos.shared.exception.PermissionDeniedException}
     * so the message can name BOTH the person and the missing authority: the cashier needs to know
     * this is a manager's job, not that "something" was forbidden.
     */
    public static class TillOpenForOtherDeniedException extends RuntimeException {
        public TillOpenForOtherDeniedException(String targetName) {
            super("You cannot open a till for " + targetName
                    + ". Counting a float into another employee's drawer requires the "
                    + "pos.till.open.other permission — ask a manager to open it for them.");
        }
    }

    /**
     * The named target cannot be handed a drawer at this branch (F11).
     *
     * <p>Raised when the person is not rostered here, or holds no role here that grants
     * {@code pos.till.open}. Opening a drawer for someone who cannot settle against it would
     * produce a till nobody can cash up — the shape of the seeded drawer walkthrough §0 found with
     * 133 orders and no route out.
     *
     * <p>Also raised when the directory could not be reached at all. That is deliberate and is the
     * one place in POS where an auth-service outage is fatal rather than cosmetic: this is a
     * money-custody decision, and "the service that knows is down" is not evidence of entitlement.
     */
    public static class CashierNotEligibleForTillException extends RuntimeException {
        public CashierNotEligibleForTillException(String detail) {
            super(detail);
        }
    }

    public static class TillHasOpenOrdersException extends RuntimeException {
        public TillHasOpenOrdersException(String tillId) {
            super("Till has orders that are not closed or voided: " + tillId);
        }
    }

    /**
     * Raised when a user attempts to settle an order in CASH without an OPEN till session
     * (D-30). Enforces the financial-integrity invariant "no cash without an open drawer" — the
     * counterpart to {@link TillHasOpenOrdersException} (can't CLOSE a till with open orders).
     *
     * <p>Until plan 13-16 this was raised at ORDER CREATION instead, which made the WAITER role
     * unusable (a waiter holds no till by design) while not actually establishing the invariant,
     * since any path without a userId already created orders with a null till. The message is
     * worded for the settlement call site — the one that now raises it — so the 409 detail tells
     * the operator to open the drawer, not to abandon the order.
     */
    public static class NoOpenTillException extends RuntimeException {
        public NoOpenTillException(String cashierId) {
            super("No open till session; open a till before taking cash: " + cashierId);
        }
    }

    public static class TillNotFoundException extends ResourceNotFoundException {
        public TillNotFoundException(String tillId) {
            super("Till session not found: " + tillId);
        }
    }

    public static class PaymentMismatchException extends RuntimeException {
        public PaymentMismatchException(long expected, long actual) {
            super("Payment sum mismatch: expected " + expected + " but got " + actual);
        }
    }

    /**
     * A non-cash tender was presented for more than the outstanding balance. Cash over-tender is
     * legitimate and becomes change; a card or bank transfer for more than the bill is an input
     * error, and accepting it would put more debits than credits on the revenue journal entry.
     */
    public static class PaymentExceedsBalanceException extends RuntimeException {
        public PaymentExceedsBalanceException(String method, long amountPaisa, long outstandingPaisa) {
            super("A " + method + " payment of " + amountPaisa
                    + " paisa exceeds the outstanding balance of " + outstandingPaisa
                    + " paisa. Only CASH may be over-tendered (the difference is returned as change).");
        }
    }

    /** The bill is already settled in full. Guards the duplicate-payment path (POS-24). */
    public static class OrderAlreadyPaidException extends RuntimeException {
        public OrderAlreadyPaidException(String orderId) {
            super("Order is already paid in full; no further payment can be recorded: " + orderId);
        }
    }

    /**
     * The AR seam refused the charge — credit limit, suspended account, unknown account, or a
     * locked accounting period. finance-service's contract (10-18) requires POS to surface each of
     * these as a tender failure and NOT close the order on that tender.
     */
    public static class ChargeToAccountRefusedException extends RuntimeException {
        public ChargeToAccountRefusedException(String detail) {
            super("Charge to account was refused: " + detail);
        }
    }

    /**
     * A void was attempted on an order that has money recorded against it (S0-01).
     *
     * <p>A void cancels a bill; it does not move money. Voiding a paid order therefore deleted
     * the order from every operator screen while its {@code order_payments} row survived — the
     * cash was in the drawer and on no report. The policy is now: <b>any payment at all means
     * the void is refused and a refund is the only path</b>, because a refund is the operation
     * that has a reversing money row.
     *
     * <p>The detail names the amount and the alternative, because the operator holding the cash
     * has to be told what to do instead, not merely that they cannot do this.
     */
    public static class OrderHasPaymentsException extends RuntimeException {
        public OrderHasPaymentsException(String orderNo, long amountPaidPaisa) {
            super("Order " + orderNo + " has " + amountPaidPaisa
                    + " paisa recorded against it and cannot be voided. "
                    + "Use Refund — a void leaves the payment in place with no reversing entry.");
        }
    }

    /** CHARGE_TO_ACCOUNT was selected without naming which house account to bill. */
    public static class CustomerAccountRequiredException extends RuntimeException {
        public CustomerAccountRequiredException() {
            super("A customer account is required for a charge-to-account tender");
        }
    }

    private PosExceptions() {}
}
