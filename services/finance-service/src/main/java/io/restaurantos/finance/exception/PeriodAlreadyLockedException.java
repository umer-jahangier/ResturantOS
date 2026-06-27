package io.restaurantos.finance.exception;

import java.util.UUID;

public class PeriodAlreadyLockedException extends RuntimeException {

    private final UUID periodId;

    public PeriodAlreadyLockedException(UUID periodId) {
        super("Accounting period " + periodId + " is already locked");
        this.periodId = periodId;
    }

    public UUID getPeriodId() {
        return periodId;
    }
}
