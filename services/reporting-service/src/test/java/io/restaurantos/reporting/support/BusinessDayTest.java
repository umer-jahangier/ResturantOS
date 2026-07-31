package io.restaurantos.reporting.support;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Table-driven proof of PROJECT.md line 68's business-day boundary formula:
 * {@code business_date = DATE(occurredAt AT TIME ZONE branch.timezone - INTERVAL '4 hours')}.
 * No containers — pure unit test.
 */
class BusinessDayTest {

    private final BusinessDay businessDay = new BusinessDay(4);

    @ParameterizedTest(name = "{0} {1} offset {2}h -> business_date {3}")
    @CsvSource({
            // localDateTime,        zone,           offsetHours, expectedBusinessDate
            "2026-03-10T01:00:00, Asia/Karachi, 4, 2026-03-09",  // 1am order -> PREVIOUS business day
            "2026-03-10T03:59:00, Asia/Karachi, 4, 2026-03-09",  // still before the 4am boundary
            "2026-03-10T04:00:00, Asia/Karachi, 4, 2026-03-10",  // boundary, inclusive of the new day
            "2026-03-10T23:30:00, Asia/Karachi, 4, 2026-03-10",  // late evening, same business day
    })
    void businessDate_matchesTheBoundaryFormula(String localDateTime, String zoneId, int offsetHours, String expected) {
        ZoneId zone = ZoneId.of(zoneId);
        Instant occurredAt = ZonedDateTime.of(java.time.LocalDateTime.parse(localDateTime), zone).toInstant();

        LocalDate businessDate = businessDay.businessDate(occurredAt, zone, offsetHours);

        assertThat(businessDate).isEqualTo(LocalDate.parse(expected));
    }

    @Test
    void sameInstant_differentBranchTimezones_resolveToDifferentBusinessDates() {
        // A single UTC instant, evaluated against two branch timezones on opposite sides of a
        // business-day boundary, must NOT collapse to the same business_date — proves the branch
        // zone is actually honoured, not silently ignored (e.g. defaulted to UTC or server-local).
        Instant instant = Instant.parse("2026-03-10T00:30:00Z"); // 2026-03-10 05:30 Asia/Karachi (+5)
                                                                   // vs 2026-03-09 16:30 America/New_York (-8 DST-adjusted)

        LocalDate karachiBusinessDate = businessDay.businessDate(instant, ZoneId.of("Asia/Karachi"), 4);
        LocalDate newYorkBusinessDate = businessDay.businessDate(instant, ZoneId.of("America/New_York"), 4);

        assertThat(karachiBusinessDate).isEqualTo(LocalDate.parse("2026-03-10"));
        assertThat(newYorkBusinessDate).isEqualTo(LocalDate.parse("2026-03-09"));
        assertThat(karachiBusinessDate).isNotEqualTo(newYorkBusinessDate);
    }

    @Test
    void businessDate_usesConfiguredDefaultOffsetWhenNotSpecifiedExplicitly() {
        Instant occurredAt = ZonedDateTime.of(
                java.time.LocalDateTime.parse("2026-03-10T01:00:00"), ZoneId.of("Asia/Karachi")).toInstant();

        LocalDate businessDate = businessDay.businessDate(occurredAt, ZoneId.of("Asia/Karachi"));

        assertThat(businessDate).isEqualTo(LocalDate.parse("2026-03-09"));
    }
}
