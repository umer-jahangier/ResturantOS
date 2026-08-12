package io.restaurantos.kitchen.dto;

import io.restaurantos.kitchen.domain.enums.TicketStatus;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * What is on this board from a business day that has already closed (F17).
 *
 * <p>This is the shape the confirmation dialog is built from, and it is deliberately more than a
 * count. A cook is being asked to take work off a screen; "clear 10 tickets?" is not enough
 * information to say yes to. So the summary carries the boundary that was applied and the zone it
 * was applied on ({@link #branchTimezone} / {@link #currentBusinessDayStartedAt}), how old the
 * oldest one is, the split by business date, and the tickets themselves — so the dialog can name
 * them rather than assert a number.
 *
 * @param stationCode                 the board this describes; null means every station at the branch
 * @param branchTimezone              the IANA zone the boundary was cut on — printed on the dialog,
 *                                    because a boundary the user cannot see is a boundary they
 *                                    cannot check, and this product has already shipped a trading
 *                                    day cut in UTC while the settings screen promised otherwise
 * @param currentBusinessDate         the trading day the branch is in right now
 * @param currentBusinessDayStartedAt the exact instant that day began — the cutoff. Every ticket
 *                                    below was received strictly before it
 * @param ticketCount                 tickets that WILL be cleared
 * @param itemCount                   live lines across them (neither served nor cancelled)
 * @param finishedTicketCount         how many of {@link #ticketCount} have no live line left — they
 *                                    were cooked, but their order was never closed on the POS, so
 *                                    the ticket never left. The board draws no card for these, which
 *                                    is why this number is stated separately instead of leaving the
 *                                    dialog's total looking larger than the board's header
 * @param oldestReceivedAt            when the oldest one was fired, or null when there are none
 * @param days                        oldest business date first
 * @param tickets                     oldest first, capped by {@link #TICKET_SAMPLE_LIMIT}
 */
public record StaleBoardSummary(
        UUID branchId,
        String stationCode,
        String branchTimezone,
        int businessDayOffsetHours,
        LocalDate currentBusinessDate,
        Instant currentBusinessDayStartedAt,
        int ticketCount,
        int itemCount,
        int finishedTicketCount,
        Instant oldestReceivedAt,
        List<DayGroup> days,
        List<StaleTicket> tickets
) {
    /**
     * How many tickets travel on the summary. A board carrying 400 stale tickets does not need to
     * ship 400 rows to a wall display to answer "may I clear these?" — the counts are exact and the
     * list is a sample, which the dialog says on screen rather than silently truncating.
     */
    public static final int TICKET_SAMPLE_LIMIT = 100;

    public record DayGroup(LocalDate businessDate, int ticketCount) {}

    public record StaleTicket(
            UUID id,
            String orderNo,
            String stationCode,
            String tableNumber,
            String orderType,
            TicketStatus status,
            Instant receivedAt,
            LocalDate businessDate,
            int itemCount
    ) {}
}
