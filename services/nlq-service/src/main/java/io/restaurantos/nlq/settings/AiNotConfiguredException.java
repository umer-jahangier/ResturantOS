package io.restaurantos.nlq.settings;

/**
 * Neither the tenant nor the platform has an AI key configured, so there is no way to answer an
 * NLQ question at all.
 *
 * <p>Distinct from "the provider is down" and from "the key was refused" because the remedy is
 * different again: somebody has to supply a key. Before this work the same situation surfaced as a
 * generic {@code CLAUDE_UNAVAILABLE} 503, i.e. "try later" for a state that no amount of waiting
 * changes.
 */
public class AiNotConfiguredException extends RuntimeException {

    public AiNotConfiguredException(String message) {
        super(message);
    }
}
