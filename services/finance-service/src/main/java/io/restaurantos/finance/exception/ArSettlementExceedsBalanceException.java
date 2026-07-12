package io.restaurantos.finance.exception;

public class ArSettlementExceedsBalanceException extends RuntimeException {

    public ArSettlementExceedsBalanceException(long amountPaisa, long outstandingPaisa) {
        super("Settlement of " + amountPaisa + " paisa exceeds outstanding balance " + outstandingPaisa + " paisa");
    }
}
