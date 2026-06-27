package io.restaurantos.finance.exception;

import java.util.UUID;

public class JeNotBalancedException extends RuntimeException {
    private final UUID jeId;

    public JeNotBalancedException(UUID jeId) {
        super("Journal entry " + jeId + " is not balanced (DR ≠ CR)");
        this.jeId = jeId;
    }

    public UUID getJeId() {
        return jeId;
    }
}
