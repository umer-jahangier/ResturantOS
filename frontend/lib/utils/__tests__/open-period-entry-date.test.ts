import { describe, expect, it } from "vitest";

import {
  describeEntryDateDefault,
  formatIsoDateLong,
  localIsoToday,
  resolveDefaultEntryDate,
} from "@/lib/utils/open-period-entry-date";

/**
 * F9 — the New Journal Entry screen's date default.
 *
 * The live tenant's open periods are the fiscal-2026 set (Aug 2025 → Jun 2026) while the clock
 * reads Aug 2026, and the screen answered that with a bare `Selected: 2025-08-01` under a calendar
 * headed August 2026. Everything asserted here is about that case: the date chosen, and the
 * sentence that has to appear beside it.
 */

// The live `GET /api/v1/finance/periods/open` shape, trimmed to the two fields that matter.
const LIVE_OPEN_PERIODS = [
  { startDate: "2025-08-01", endDate: "2025-08-31" },
  { startDate: "2025-09-01", endDate: "2025-09-30" },
  { startDate: "2025-10-01", endDate: "2025-10-31" },
  { startDate: "2025-11-01", endDate: "2025-11-30" },
  { startDate: "2025-12-01", endDate: "2025-12-31" },
  { startDate: "2026-01-01", endDate: "2026-01-31" },
  { startDate: "2026-02-01", endDate: "2026-02-28" },
  { startDate: "2026-03-01", endDate: "2026-03-31" },
  { startDate: "2026-04-01", endDate: "2026-04-30" },
  { startDate: "2026-05-01", endDate: "2026-05-31" },
  { startDate: "2026-06-01", endDate: "2026-06-30" },
];

/**
 * The REAL live answer, in the API's own order: fiscal 2026 first, then fiscal 2027. Today
 * (12 Aug 2026) is covered by the TWELFTH entry. The pre-fix rule only ever examined the first.
 */
const LIVE_OPEN_PERIODS_AS_SERVED = [
  ...LIVE_OPEN_PERIODS,
  { startDate: "2026-08-01", endDate: "2026-08-31" },
  { startDate: "2026-09-01", endDate: "2026-09-30" },
  { startDate: "2026-10-01", endDate: "2026-10-31" },
  { startDate: "2026-11-01", endDate: "2026-11-30" },
  { startDate: "2026-12-01", endDate: "2026-12-31" },
  { startDate: "2027-01-01", endDate: "2027-01-31" },
  { startDate: "2027-02-01", endDate: "2027-02-28" },
  { startDate: "2027-03-01", endDate: "2027-03-31" },
  { startDate: "2027-04-01", endDate: "2027-04-30" },
  { startDate: "2027-05-01", endDate: "2027-05-31" },
  { startDate: "2027-06-01", endDate: "2027-06-30" },
];

describe("resolveDefaultEntryDate — the defect", () => {
  it("finds today in ANY open period, not just the one the API happened to list first", () => {
    // `openPeriods[0]` is 2025-08-01..2025-08-31; today is in entry #12. The old rule answered
    // "2025-08-01" here, which is the walkthrough screenshot exactly.
    const r = resolveDefaultEntryDate(LIVE_OPEN_PERIODS_AS_SERVED, "2026-08-12");
    expect(r.date).toBe("2026-08-12");
    expect(r.reason).toBe("TODAY_IS_OPEN");
    expect(describeEntryDateDefault(r)).toBeNull();
  });

  it("is not fooled by list order either way", () => {
    const shuffled = [...LIVE_OPEN_PERIODS_AS_SERVED].reverse();
    expect(resolveDefaultEntryDate(shuffled, "2026-08-12").date).toBe("2026-08-12");
    expect(resolveDefaultEntryDate(shuffled, "2026-07-15").reason).toBe("TODAY_IN_A_GAP");
  });
});

describe("resolveDefaultEntryDate", () => {
  it("uses today, with nothing to explain, when today is inside an open period", () => {
    const r = resolveDefaultEntryDate(LIVE_OPEN_PERIODS, "2026-03-17");
    expect(r.date).toBe("2026-03-17");
    expect(r.reason).toBe("TODAY_IS_OPEN");
    expect(describeEntryDateDefault(r)).toBeNull();
  });

  it("falls back to the NEAREST open date, not the earliest, when today is past every period", () => {
    const r = resolveDefaultEntryDate(LIVE_OPEN_PERIODS, "2026-08-12");
    // The old inline rule took `openPeriods[0].startDate` — 2025-08-01, a year and eleven days
    // back — which is what the walkthrough screenshotted.
    expect(r.date).toBe("2026-06-30");
    expect(r.reason).toBe("TODAY_AFTER_ALL_OPEN");
    expect(r.earliestOpen).toBe("2025-08-01");
    expect(r.latestOpen).toBe("2026-06-30");
  });

  it("says why, naming today, the open span and the date it chose", () => {
    const sentence = describeEntryDateDefault(
      resolveDefaultEntryDate(LIVE_OPEN_PERIODS, "2026-08-12"),
    );
    expect(sentence).toContain("12 Aug 2026");
    expect(sentence).toContain("1 Aug 2025");
    expect(sentence).toContain("30 Jun 2026");
    expect(sentence).toMatch(/past every open accounting period/);
  });

  it("handles a clock that is before every open period", () => {
    const r = resolveDefaultEntryDate(LIVE_OPEN_PERIODS, "2025-01-05");
    expect(r.date).toBe("2025-08-01");
    expect(r.reason).toBe("TODAY_BEFORE_ALL_OPEN");
    expect(describeEntryDateDefault(r)).toMatch(/before every open accounting period/);
  });

  it("takes the nearer edge of a gap between two open periods", () => {
    const gapped = [
      { startDate: "2026-01-01", endDate: "2026-01-31" },
      { startDate: "2026-06-01", endDate: "2026-06-30" },
    ];
    expect(resolveDefaultEntryDate(gapped, "2026-02-05").date).toBe("2026-01-31");
    expect(resolveDefaultEntryDate(gapped, "2026-05-20").date).toBe("2026-06-01");
    expect(resolveDefaultEntryDate(gapped, "2026-02-05").reason).toBe("TODAY_IN_A_GAP");
  });

  it("selects nothing, and says so, when no period is open", () => {
    const r = resolveDefaultEntryDate([], "2026-08-12");
    expect(r.date).toBe("");
    expect(r.reason).toBe("NO_OPEN_PERIODS");
    expect(describeEntryDateDefault(r)).toMatch(/No accounting period is open/);
    // Undefined (the query has not resolved) must behave the same, not throw.
    expect(resolveDefaultEntryDate(undefined, "2026-08-12").date).toBe("");
  });

  it("ignores malformed ranges rather than selecting one", () => {
    const r = resolveDefaultEntryDate(
      [{ startDate: "not-a-date", endDate: "2026-06-30" }, ...LIVE_OPEN_PERIODS],
      "2026-08-12",
    );
    expect(r.date).toBe("2026-06-30");
  });
});

describe("formatIsoDateLong / localIsoToday", () => {
  it("renders the date the string says, with no timezone shift", () => {
    expect(formatIsoDateLong("2025-08-01")).toBe("1 Aug 2025");
    expect(formatIsoDateLong("2026-06-30")).toBe("30 Jun 2026");
    expect(formatIsoDateLong("2026-01-01")).toBe("1 Jan 2026");
  });

  it("reads the LOCAL calendar day, which is the day the calendar grid draws", () => {
    // 2026-08-12T23:30 local is 2026-08-12 on every wall clock and 2026-08-13 (or -11) in UTC.
    // The screen used to derive its "today" from `toISOString()`, disagreeing with its own grid.
    expect(localIsoToday(new Date(2026, 7, 12, 23, 30))).toBe("2026-08-12");
    expect(localIsoToday(new Date(2026, 7, 12, 0, 30))).toBe("2026-08-12");
  });
});
