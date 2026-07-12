package io.restaurantos.finance.exception;

import java.util.UUID;

public class CreditLimitExceededException extends RuntimeException {

    private final UUID customerAccountId;
    private final long currentBalancePaisa;
    private final long creditLimitPaisa;
    private final long attemptedPaisa;

    public CreditLimitExceededException(UUID customerAccountId, long currentBalancePaisa,
                                         long creditLimitPaisa, long attemptedPaisa) {
        super("Charge of " + attemptedPaisa + " paisa would exceed credit limit " + creditLimitPaisa
                + " paisa (current balance " + currentBalancePaisa + " paisa) for account " + customerAccountId);
        this.customerAccountId = customerAccountId;
        this.currentBalancePaisa = currentBalancePaisa;
        this.creditLimitPaisa = creditLimitPaisa;
        this.attemptedPaisa = attemptedPaisa;
    }

    public UUID getCustomerAccountId() {
        return customerAccountId;
    }

    public long getCurrentBalancePaisa() {
        return currentBalancePaisa;
    }

    public long getCreditLimitPaisa() {
        return creditLimitPaisa;
    }

    public long getAttemptedPaisa() {
        return attemptedPaisa;
    }
}
