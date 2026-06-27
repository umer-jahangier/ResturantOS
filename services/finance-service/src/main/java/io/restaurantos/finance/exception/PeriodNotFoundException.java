package io.restaurantos.finance.exception;

import java.util.UUID;

public class PeriodNotFoundException extends RuntimeException {

    public PeriodNotFoundException(UUID periodId) {
        super("Accounting period not found: " + periodId);
    }
}
