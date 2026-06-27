package io.restaurantos.finance.exception;

import java.util.UUID;

public class JeAlreadyPostedException extends RuntimeException {
    private final UUID jeId;

    public JeAlreadyPostedException(UUID jeId) {
        super("Journal entry " + jeId + " is already posted");
        this.jeId = jeId;
    }

    public UUID getJeId() {
        return jeId;
    }
}
