package io.restaurantos.nlq.settings;

/** Too many AI-key saves from one tenant in an hour. See {@link AiSettingsProbeRateLimiter}. */
public class AiSettingsProbeRateLimitedException extends RuntimeException {

    private final long limit;

    public AiSettingsProbeRateLimitedException(long limit) {
        super("Too many AI key changes in the last hour (limit " + limit + "). Try again later.");
        this.limit = limit;
    }

    public long limit() {
        return limit;
    }
}
