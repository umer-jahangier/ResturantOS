package io.restaurantos.kitchen.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * What a clear actually did (F17) — measured after the write, never echoed from the request.
 *
 * <p>The counts here are the rows that changed, so a caller can tell "nothing was stale" (0, with a
 * 200) apart from "it did not run". {@link #clearedTicketIds} is what makes the result checkable:
 * the caller can read those very tickets back with {@code GET /kds/tickets?status=CLEARED} and see
 * that they exist, still carry their order numbers and their original {@code receivedAt}, and were
 * not deleted.
 */
public record ClearStaleResult(
        UUID branchId,
        String stationCode,
        String branchTimezone,
        LocalDate currentBusinessDate,
        Instant currentBusinessDayStartedAt,
        int clearedTicketCount,
        int clearedItemCount,
        Instant oldestClearedReceivedAt,
        Instant clearedAt,
        List<UUID> clearedTicketIds
) {}
