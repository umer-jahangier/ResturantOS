import { describe, expect, it } from "vitest";
import { calendarDateToInstant } from "@/lib/forms/calendar-date";

// Regression guard for the coverage-count origin bug (08.2-CONTEXT.md "carried-over defects"):
// calendarDateToInstant MUST read a bare "YYYY-MM-DD" as LOCAL midnight, never UTC midnight. A
// UTC reading puts "today" ahead of local time in every positive-offset zone (PKT is +05:00), so
// effective_from <= now() silently excluded a just-scheduled recipe from coverage. The backend
// half of this regression pair lives in plan 08.2-03 (RecipeCoverageIT's
// futureDatedRecipeIsScheduledNotMissing).
describe("calendarDateToInstant", () => {
  it("returns local midnight, not UTC midnight", () => {
    const result = calendarDateToInstant("2026-07-22");
    expect(result).toBeDefined();
    const d = new Date(result!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6);
    expect(d.getDate()).toBe(22);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    expect(d.getMilliseconds()).toBe(0);
  });

  it("differs from UTC midnight by exactly the local offset", () => {
    const result = calendarDateToInstant("2026-07-22")!;
    const diffMs = Date.parse(result) - Date.parse("2026-07-22T00:00:00.000Z");
    // Zone-independent: under TZ=UTC both sides are 0 (a real assertion, not a tautology); under
    // any positive-offset zone this pins the exact gap that reverting to a UTC reading collapses.
    expect(diffMs).toBe(new Date(2026, 6, 22).getTimezoneOffset() * 60_000);
  });

  it("at +05:00 the instant lands on the previous calendar day", () => {
    // Literal reproduction of the shipped defect: the old UTC reading produced
    // "2026-07-22T00:00:00.000Z", which is in the future at PKT (+05:00), so
    // effective_from <= now() excluded it and the coverage count never moved.
    const originalTz = process.env.TZ;
    process.env.TZ = "Asia/Karachi";
    try {
      expect(calendarDateToInstant("2026-07-22")).toBe("2026-07-21T19:00:00.000Z");
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  it("malformed input returns undefined", () => {
    expect(calendarDateToInstant("")).toBeUndefined();
    expect(calendarDateToInstant("2026-7-22")).toBeUndefined();
    expect(calendarDateToInstant("22/07/2026")).toBeUndefined();
    expect(calendarDateToInstant("2026-07-22T00:00:00Z")).toBeUndefined();
    expect(calendarDateToInstant("not a date")).toBeUndefined();
    // Trims whitespace-padding.
    expect(calendarDateToInstant(" 2026-07-22 ")).toBeDefined();
    // Observed contract, not changed by this task: the native Date constructor normalises a
    // rollover date (Feb 30) rather than rejecting it, so this resolves to a defined instant.
    expect(calendarDateToInstant("2026-02-30")).toBeDefined();
  });
});
