package io.restaurantos.finance.exception;

import java.util.UUID;

public class JeNotFoundException extends RuntimeException {
    private final UUID jeId;

    public JeNotFoundException(UUID jeId) {
        super("Journal entry not found: " + jeId);
        this.jeId = jeId;
    }

    public UUID getJeId() {
        return jeId;
    }
}
