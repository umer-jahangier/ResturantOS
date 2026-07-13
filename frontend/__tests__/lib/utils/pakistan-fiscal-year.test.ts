import { describe, expect, it } from "vitest";
import { getFiscalYearPeriods } from "@/lib/utils/pakistan-fiscal-year";

describe("getFiscalYearPeriods", () => {
  it("returns exactly 12 entries, periodNo 1..12 in order, with correct Jul-Jun boundaries for FY2027", () => {
    const periods = getFiscalYearPeriods(2027);
    expect(periods).toHaveLength(12);
    periods.forEach((p, index) => {
      expect(p.periodNo).toBe(index + 1);
      expect(p.fiscalYear).toBe(2027);
    });
    expect(periods[0]).toMatchObject({ startDate: "2026-07-01", endDate: "2026-07-31" });
    expect(periods[5]).toMatchObject({ endDate: "2026-12-31" });
    expect(periods[6]).toMatchObject({ startDate: "2027-01-01" });
    expect(periods[11]).toMatchObject({ endDate: "2027-06-30" });
  });

  it("resolves period 8 (Feb 2028) to 2028-02-29 via native Date arithmetic — leap year", () => {
    const periods = getFiscalYearPeriods(2028);
    const period8 = periods[7]!;
    expect(period8.periodNo).toBe(8);
    expect(period8.startDate).toBe("2028-02-01");
    expect(period8.endDate).toBe("2028-02-29");
  });

  it("resolves period 8 (Feb 2027) to 2027-02-28 — non-leap year", () => {
    const periods = getFiscalYearPeriods(2027);
    const period8 = periods[7]!;
    expect(period8.periodNo).toBe(8);
    expect(period8.startDate).toBe("2027-02-01");
    expect(period8.endDate).toBe("2027-02-28");
  });

  it("returns 12 well-formed sequential periods for a far-future fiscal year (2050), proving no hardcoded era assumption", () => {
    const periods = getFiscalYearPeriods(2050);
    expect(periods).toHaveLength(12);
    expect(periods[0]).toMatchObject({ startDate: "2049-07-01", endDate: "2049-07-31" });
    expect(periods[11]).toMatchObject({ startDate: "2050-06-01", endDate: "2050-06-30" });
    periods.forEach((p) => {
      expect(p.startDate <= p.endDate).toBe(true);
      expect(typeof p.monthLabel).toBe("string");
      expect(p.monthLabel.length).toBeGreaterThan(0);
    });
  });

  it("takes fiscalYear as its only caller-driven parameter (no default/current-date coupling)", () => {
    expect(getFiscalYearPeriods.length).toBe(1);
  });
});
