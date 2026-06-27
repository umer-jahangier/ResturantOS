package io.restaurantos.finance.exception;

import java.util.UUID;

public class PeriodLockedException extends RuntimeException {
    private final UUID periodId;

    public PeriodLockedException(UUID periodId) {
        super("Accounting period " + periodId + " is locked");
        this.periodId = periodId;
    }

    public UUID getPeriodId() {
        return periodId;
    }
}
