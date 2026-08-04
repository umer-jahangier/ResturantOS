package io.restaurantos.nlq.quota;

/**
 * Thrown when a reservation would exceed either the per-tenant monthly quota or the per-user
 * hourly quota. The controller (12-07) maps this to HTTP 429.
 */
public class QuotaExceededException extends RuntimeException {

    public enum Quota { MONTHLY_TENANT, HOURLY_USER }

    private final Quota quota;
    private final long limit;

    public QuotaExceededException(Quota quota, long limit) {
        super(quota == Quota.MONTHLY_TENANT
                ? "Monthly NLQ quota exceeded (limit " + limit + ")"
                : "Hourly NLQ quota exceeded (limit " + limit + ")");
        this.quota = quota;
        this.limit = limit;
    }

    public Quota quota() {
        return quota;
    }

    public long limit() {
        return limit;
    }
}
