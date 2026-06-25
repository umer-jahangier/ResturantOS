package io.restaurantos.file.exception;

/**
 * Thrown when an upload would push a tenant's storage usage over their allocated quota.
 * Maps to HTTP 409 Conflict.
 */
public class QuotaExceededException extends RuntimeException {

    private final String quotaType;
    private final long usedBytes;
    private final long limitBytes;

    public QuotaExceededException(String quotaType, long usedBytes, long limitBytes) {
        super(String.format("Quota exceeded for %s: used=%d bytes, limit=%d bytes",
                quotaType, usedBytes, limitBytes));
        this.quotaType = quotaType;
        this.usedBytes = usedBytes;
        this.limitBytes = limitBytes;
    }

    public String getQuotaType() { return quotaType; }
    public long getUsedBytes() { return usedBytes; }
    public long getLimitBytes() { return limitBytes; }
}
