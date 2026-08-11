package io.restaurantos.hr.payroll;

import io.restaurantos.hr.payroll.tax.FiscalYear;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * The July rule, asserted from both sides.
 *
 * <p>Before this class the rule lived as {@code periodMonth >= 7 ? periodYear + 1 : periodYear},
 * inline at the top of {@code PayrollRunService.calculate}. Nothing else in the product could ask
 * "which fiscal year is this?" without re-deriving it, and the tax-configuration screen is the
 * second caller — so the arithmetic is now a named function with a name that says what convention
 * it encodes.
 *
 * <p>Pakistan's fiscal year runs 1 July to 30 June and is NAMED for the calendar year it ends in.
 * August 2026 therefore belongs to fiscal year 2027, and February 2027 also belongs to fiscal year
 * 2027. That is the whole rule; every assertion below is a restatement of it at a boundary.
 */
class FiscalYearTest {

    @Test
    @DisplayName("July through December belong to the FOLLOWING calendar year's fiscal year")
    void secondHalfOfTheCalendarYearRollsForward() {
        for (int month = 7; month <= 12; month++) {
            assertThat(FiscalYear.forPeriod(month, 2026))
                    .as("month %d of 2026 falls in FY2027", month)
                    .isEqualTo(2027);
        }
    }

    @Test
    @DisplayName("January through June belong to the SAME calendar year's fiscal year")
    void firstHalfOfTheCalendarYearStaysPut() {
        for (int month = 1; month <= 6; month++) {
            assertThat(FiscalYear.forPeriod(month, 2027))
                    .as("month %d of 2027 falls in FY2027", month)
                    .isEqualTo(2027);
        }
    }

    /**
     * The boundary, from both sides, in one assertion pair. June and July of the same calendar year
     * are one month apart and one fiscal year apart; getting this backwards would send payroll
     * looking for a configuration row that exists but for the wrong year — which reads to the
     * operator exactly like "nobody has configured this year".
     */
    @Test
    @DisplayName("June 2026 is FY2026 and July 2026 is FY2027 — the boundary from both sides")
    void theJuneToJulyBoundary() {
        assertThat(FiscalYear.forPeriod(6, 2026)).isEqualTo(2026);
        assertThat(FiscalYear.forPeriod(7, 2026)).isEqualTo(2027);
    }

    @Test
    @DisplayName("agrees with the expression it replaces, for every month of several years")
    void agreesWithTheExpressionItReplaces() {
        for (int year = 2024; year <= 2030; year++) {
            for (int month = 1; month <= 12; month++) {
                int legacy = month >= 7 ? year + 1 : year;
                assertThat(FiscalYear.forPeriod(month, year))
                        .as("%d-%02d", year, month)
                        .isEqualTo(legacy);
            }
        }
    }

    /**
     * The clock is a parameter, not a static read. Otherwise this boundary could only be asserted
     * by waiting until July, which is to say never.
     */
    @Test
    @DisplayName("current() takes a clock, so the boundary is assertable without waiting for July")
    void currentTakesAClock() {
        // Instants chosen either side of MIDNIGHT IN KARACHI (UTC+5), not midnight UTC: the clock
        // carries a zone and the fiscal year must turn over when the local date does. A UTC-midnight
        // boundary would pass against a zone-blind implementation and mislabel five hours of every
        // 30 June as the new year.
        assertThat(FiscalYear.current(fixedAt("2026-06-30T18:59:59Z"))).isEqualTo(2026);
        assertThat(FiscalYear.current(fixedAt("2026-06-30T19:00:00Z"))).isEqualTo(2027);
    }

    @Test
    @DisplayName("a month outside 1-12 is rejected rather than silently producing a year")
    void refusesAnImpossibleMonth() {
        assertThatThrownBy(() -> FiscalYear.forPeriod(0, 2026))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> FiscalYear.forPeriod(13, 2026))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private static Clock fixedAt(String instant) {
        return Clock.fixed(Instant.parse(instant), ZoneId.of("Asia/Karachi"));
    }
}
