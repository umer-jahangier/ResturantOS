package io.restaurantos.reporting.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

/**
 * Thrown when a report's requested date range is missing, inverted (from &gt; to), or exceeds the
 * configured max span — kept honest so P95 latency figures aren't polluted by unbounded scans.
 * Mapped to 400 by shared-lib's {@code GlobalExceptionHandler#handleBase}
 * (RestaurantOsException catch-all).
 */
public class InvalidReportRangeException extends RestaurantOsException {
    public InvalidReportRangeException(String message) {
        super("INVALID_REPORT_RANGE", message);
    }
}
