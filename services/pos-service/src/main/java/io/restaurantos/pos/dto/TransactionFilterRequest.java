package io.restaurantos.pos.dto;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * Filters for the transaction register (37-08).
 *
 * <p>The date range is REQUIRED and BOUNDED. {@code orders} is the busiest table in the product,
 * and an unbounded register is a denial-of-service surface reachable by any authenticated user with
 * a single request — one call for "all time" scans every order and every payment the tenant has
 * ever taken. The bound is enforced in the service and the error names the limit, so the refusal is
 * actionable rather than mysterious.
 *
 * <p>There is no terminal filter: this schema has no terminal column. See {@link TransactionRowDto}.
 */
public record TransactionFilterRequest(
        LocalDate from,
        LocalDate to,
        UUID branchId,
        UUID cashierId,
        /** CASH, CARD, WALLET… matched against order_payments.method. */
        String tenderMethod,
        /** Order statuses to include. Empty/null means every status EXCEPT nothing — voids included. */
        List<String> statuses,
        List<TransactionRowDto.EventKind> eventKinds,
        int page,
        int size
) {
    public static final int MAX_RANGE_DAYS = 92;
    public static final int MAX_PAGE_SIZE = 200;

    public int pageOrDefault() { return Math.max(0, page); }

    public int sizeOrDefault() {
        int s = size <= 0 ? 50 : size;
        return Math.min(s, MAX_PAGE_SIZE);
    }
}
