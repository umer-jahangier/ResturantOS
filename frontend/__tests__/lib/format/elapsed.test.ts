import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ELAPSED_ABSOLUTE_BOUND_MS,
  ELAPSED_UNKNOWN,
  ELAPSED_URGENCY_BOUND_MS,
  elapsedMs,
  formatElapsedCompact,
  formatElapsedLong,
  isWithinUrgencyWindow,
  readElapsed,
} from "@/lib/format/elapsed";

/**
 * The bound is the subject of this file, so every boundary is asserted on BOTH sides — one
 * millisecond under and exactly on — not merely somewhere in the middle of each band. Removing
 * the 24h bound is 38-05's negative control #2, and these are the assertions that must go red
 * when it is removed.
 *
 * Every instant is derived from one frozen `NOW`. Nothing here calls `Date.now()` and nothing
 * hardcodes a date on either side of an assertion, because this repo already carries one test
 * that pinned a real date and went red when the world moved past it. The absolute-stamp cases
 * pass an explicit `timeZone` so they assert the same string in CI, on a laptop in Karachi and
 * on a laptop in Lisbon.
 */
const NOW = Date.parse("2026-08-21T09:15:00.000Z");
const KARACHI = { timeZone: "Asia/Karachi" } as const;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** An instant `ms` before the frozen now. */
const ago = (ms: number) => NOW - ms;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the bound — 24h", () => {
  it("counts right up to the bound", () => {
    const reading = readElapsed(ago(ELAPSED_URGENCY_BOUND_MS - 1), NOW, KARACHI);
    expect(reading.compact).toBe("23h 59m");
    expect(reading.long).toBe("23h 59m");
    expect(reading.withinUrgencyWindow).toBe(true);
  });

  it("stops counting AT the bound: compact names the day, long drops to whole days", () => {
    const reading = readElapsed(ago(ELAPSED_URGENCY_BOUND_MS), NOW, KARACHI);
    expect(reading.compact).toBe("20 Aug");
    expect(reading.long).toBe("1d");
    expect(reading.withinUrgencyWindow).toBe(false);
  });

  it("withdraws urgency past the bound so no caller can apply the late fill", () => {
    expect(isWithinUrgencyWindow(ago(ELAPSED_URGENCY_BOUND_MS - 1), NOW)).toBe(true);
    expect(isWithinUrgencyWindow(ago(ELAPSED_URGENCY_BOUND_MS), NOW)).toBe(false);
    expect(isWithinUrgencyWindow(ago(5 * DAY), NOW)).toBe(false);
  });

  it("kills `Oldest 113h 52m` — the live defect, verbatim", () => {
    // components/kds/station-picker.tsx renders exactly this today.
    const reading = readElapsed(ago(113 * HOUR + 52 * MINUTE), NOW, KARACHI);
    expect(reading.compact).not.toMatch(/113/);
    expect(reading.compact).not.toMatch(/h/);
    expect(reading.compact).toBe("16 Aug");
    expect(reading.long).toBe("4d");
    expect(reading.withinUrgencyWindow).toBe(false);
  });

  it("kills `114:01:07` — the same ticket as the dashboard renders it", () => {
    const reading = readElapsed(ago(114 * HOUR + 1 * MINUTE + 7 * SECOND), NOW, KARACHI);
    expect(reading.compact).not.toMatch(/:/);
    expect(reading.compact).toBe("16 Aug");
  });

  it("past the bound the compact form is a date in EVERY case, never a duration", () => {
    for (const ageMs of [
      ELAPSED_URGENCY_BOUND_MS,
      ELAPSED_URGENCY_BOUND_MS + 1,
      25 * HOUR,
      47 * HOUR + 59 * MINUTE,
      9 * DAY,
      113 * HOUR + 52 * MINUTE,
      ELAPSED_ABSOLUTE_BOUND_MS,
      400 * DAY,
    ]) {
      const compact = formatElapsedCompact(ago(ageMs), NOW, KARACHI);
      expect(compact, `age ${ageMs}`).toMatch(/^\d{1,2} [A-Za-z]{3,}( \d{4})?$/);
      expect(compact, `age ${ageMs}`).not.toMatch(/\d+[hm]\b/);
    }
  });
});

describe("the second bound — 30d, prose only", () => {
  it("still counts days one millisecond under it", () => {
    expect(formatElapsedLong(ago(ELAPSED_ABSOLUTE_BOUND_MS - 1), NOW, KARACHI)).toBe("29d");
  });

  it("prints the dated year at it, because `43d` is `113h 52m` in a smaller unit", () => {
    expect(formatElapsedLong(ago(ELAPSED_ABSOLUTE_BOUND_MS), NOW, KARACHI)).toBe("22 Jul 2026");
  });
});

describe("the one-hour boundary — where the seconds are dropped", () => {
  it("counts seconds right up to the hour", () => {
    const reading = readElapsed(ago(HOUR - SECOND), NOW);
    expect(reading.compact).toBe("59:59");
    expect(reading.long).toBe("59 min");
  });

  it("drops seconds AT the hour, and spells the unit so mm:ss cannot be confused with h:mm", () => {
    const reading = readElapsed(ago(HOUR), NOW);
    expect(reading.compact).toBe("1h");
    expect(reading.long).toBe("1h");
  });

  it("never emits a bare colon-form above an hour, at any age in the band", () => {
    for (const ageMs of [HOUR, HOUR + SECOND, 3 * HOUR + 52 * MINUTE, 23 * HOUR + 59 * MINUTE]) {
      expect(formatElapsedCompact(ago(ageMs), NOW), `age ${ageMs}`).not.toMatch(/:/);
    }
  });

  it("13 minutes and 13 hours cannot render the same string", () => {
    const thirteenMinutes = formatElapsedCompact(ago(13 * MINUTE + 47 * SECOND), NOW);
    const thirteenHours = formatElapsedCompact(ago(13 * HOUR + 47 * MINUTE), NOW);
    expect(thirteenMinutes).toBe("13:47");
    expect(thirteenHours).toBe("13h 47m");
    expect(thirteenMinutes).not.toBe(thirteenHours);
  });
});

describe("the one-minute boundary — where prose gets a word instead of a number", () => {
  it("says `under a minute` rather than `0 min`, while the timer still counts", () => {
    const reading = readElapsed(ago(MINUTE - 1), NOW);
    expect(reading.compact).toBe("00:59");
    expect(reading.long).toBe("under a minute");
  });

  it("switches to minutes exactly at 60s", () => {
    const reading = readElapsed(ago(MINUTE), NOW);
    expect(reading.compact).toBe("01:00");
    expect(reading.long).toBe("1 min");
  });
});

describe("the band that is actually the product — under an hour", () => {
  it("renders a zero-padded mm:ss timer", () => {
    expect(formatElapsedCompact(ago(7 * MINUTE + 42 * SECOND), NOW)).toBe("07:42");
    expect(formatElapsedCompact(ago(41 * SECOND), NOW)).toBe("00:41");
    expect(formatElapsedCompact(ago(0), NOW)).toBe("00:00");
  });

  it("renders prose that reads after `has been up for`", () => {
    expect(formatElapsedLong(ago(4 * MINUTE), NOW)).toBe("4 min");
    expect(formatElapsedLong(ago(59 * MINUTE + 59 * SECOND), NOW)).toBe("59 min");
  });

  it("floors rather than rounds, so a time is never reported as older than it is", () => {
    expect(formatElapsedLong(ago(4 * MINUTE + 59 * SECOND), NOW)).toBe("4 min");
    expect(formatElapsedLong(ago(23 * HOUR + 59 * MINUTE + 59 * SECOND), NOW)).toBe("23h 59m");
  });
});

describe("the hours band", () => {
  it("omits a zero minute component in both faces", () => {
    expect(formatElapsedCompact(ago(5 * HOUR), NOW)).toBe("5h");
    expect(formatElapsedLong(ago(5 * HOUR), NOW)).toBe("5h");
  });

  it("carries minutes when there are any", () => {
    expect(formatElapsedCompact(ago(3 * HOUR + 52 * MINUTE), NOW)).toBe("3h 52m");
    expect(formatElapsedLong(ago(3 * HOUR + 52 * MINUTE), NOW)).toBe("3h 52m");
  });
});

describe("purity", () => {
  it("never reads the ambient clock", () => {
    const spy = vi.spyOn(Date, "now");
    readElapsed(ago(7 * MINUTE), NOW, KARACHI);
    readElapsed(ago(5 * DAY), NOW, KARACHI);
    formatElapsedCompact(ago(HOUR), NOW);
    formatElapsedLong(ago(HOUR), NOW);
    isWithinUrgencyWindow(ago(HOUR), NOW);
    expect(spy).not.toHaveBeenCalled();
  });

  it("is deterministic — same inputs, byte-identical output", () => {
    const first = readElapsed(ago(3 * HOUR + 52 * MINUTE), NOW, KARACHI);
    const second = readElapsed(ago(3 * HOUR + 52 * MINUTE), NOW, KARACHI);
    expect(second).toEqual(first);
  });

  it("accepts an epoch number, an ISO string and a Date interchangeably", () => {
    const sinceMs = ago(3 * HOUR + 52 * MINUTE);
    const asNumber = readElapsed(sinceMs, NOW, KARACHI);
    const asIso = readElapsed(new Date(sinceMs).toISOString(), NOW, KARACHI);
    const asDate = readElapsed(new Date(sinceMs), new Date(NOW), KARACHI);
    expect(asIso).toEqual(asNumber);
    expect(asDate).toEqual(asNumber);
  });
});

describe("clock skew and unusable input", () => {
  it("clamps a future instant to zero instead of flooring it past the bound", () => {
    // kitchen-service stamps the instant, the browser supplies `now`; a few seconds of skew is
    // routine. Unclamped this floors to -1d, which would push a ticket fired three seconds ago
    // OUT of the urgency window — the exact inversion of what the bound is for.
    const reading = readElapsed(NOW + 3 * SECOND, NOW, KARACHI);
    expect(reading.ageMs).toBe(0);
    expect(reading.compact).toBe("00:00");
    expect(reading.long).toBe("under a minute");
    expect(reading.withinUrgencyWindow).toBe(true);
  });

  it("returns a neutral placeholder for an unusable instant — never `0`, never a date", () => {
    for (const bad of [
      "not-a-date",
      "",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      new Date(Number.NaN),
    ]) {
      const reading = readElapsed(bad, NOW, KARACHI);
      expect(reading.ageMs, String(bad)).toBeNull();
      expect(reading.compact, String(bad)).toBe(ELAPSED_UNKNOWN);
      expect(reading.long, String(bad)).toBe(ELAPSED_UNKNOWN);
      expect(reading.srLabel, String(bad)).toBe("age unknown");
    }
  });

  it("an age it cannot compute is never urgent", () => {
    expect(readElapsed("not-a-date", NOW).withinUrgencyWindow).toBe(false);
    expect(isWithinUrgencyWindow("not-a-date", NOW)).toBe(false);
    expect(readElapsed(ago(HOUR), "not-a-date").withinUrgencyWindow).toBe(false);
  });

  it("elapsedMs is the shared, clamped primitive", () => {
    expect(elapsedMs(ago(90 * SECOND), NOW)).toBe(90 * SECOND);
    expect(elapsedMs(NOW + 5 * SECOND, NOW)).toBe(0);
    expect(elapsedMs("nope", NOW)).toBeNull();
  });
});

describe("the absolute stamp is on the BRANCH's clock", () => {
  it("formats the day in the zone it was given, not the runtime's", () => {
    const sinceMs = Date.parse("2026-08-16T20:30:00.000Z");
    // 01:30 on 17 Aug in Karachi, still 16 Aug in UTC. The zone is the whole answer.
    expect(formatElapsedCompact(sinceMs, NOW, KARACHI)).toBe("17 Aug");
    expect(formatElapsedCompact(sinceMs, NOW, { timeZone: "UTC" })).toBe("16 Aug");
  });

  it("adds the year only when it differs, and compares years in the branch zone too", () => {
    // 31 Dec 2025 20:00 UTC is already 1 Jan 2026 in Karachi — same year as `now` there, so no
    // year is printed. A UTC comparison would wrongly stamp `1 Jan 2026` beside a 2025 date.
    expect(formatElapsedCompact(Date.parse("2025-12-31T20:00:00.000Z"), NOW, KARACHI)).toBe(
      "1 Jan",
    );
    expect(formatElapsedCompact(Date.parse("2025-06-15T09:00:00.000Z"), NOW, KARACHI)).toBe(
      "15 Jun 2025",
    );
  });

  it("prose always carries the year, because a sentence has room for it", () => {
    expect(formatElapsedLong(Date.parse("2025-06-15T09:00:00.000Z"), NOW, KARACHI)).toBe(
      "15 Jun 2025",
    );
  });

  it("degrades to the runtime zone on an unknown IANA name rather than crashing a board", () => {
    expect(() =>
      formatElapsedCompact(ago(5 * DAY), NOW, { timeZone: "Mars/Olympus_Mons" }),
    ).not.toThrow();
    expect(formatElapsedCompact(ago(5 * DAY), NOW, { timeZone: "Mars/Olympus_Mons" })).toMatch(
      /^\d{1,2} [A-Za-z]{3,}( \d{4})?$/,
    );
  });
});

describe("accessibility — the spoken form is never the compact form", () => {
  it("spells out a mm:ss timer, which a screen reader would otherwise announce as a clock time", () => {
    const reading = readElapsed(ago(7 * MINUTE + 42 * SECOND), NOW);
    expect(reading.compact).toBe("07:42");
    expect(reading.srLabel).toBe("7 minutes 42 seconds");
  });

  it("gets singulars right", () => {
    expect(readElapsed(ago(MINUTE), NOW).srLabel).toBe("1 minute");
    expect(readElapsed(ago(HOUR), NOW).srLabel).toBe("1 hour");
    expect(readElapsed(ago(HOUR + MINUTE), NOW).srLabel).toBe("1 hour 1 minute");
    expect(readElapsed(ago(25 * HOUR), NOW, KARACHI).srLabel).toBe("1 day");
  });

  it("carries the age in words across every band", () => {
    expect(readElapsed(ago(30 * SECOND), NOW).srLabel).toBe("under a minute");
    expect(readElapsed(ago(3 * HOUR + 52 * MINUTE), NOW).srLabel).toBe("3 hours 52 minutes");
    expect(readElapsed(ago(5 * DAY), NOW, KARACHI).srLabel).toBe("5 days");
    expect(readElapsed(ago(400 * DAY), NOW, KARACHI).srLabel).toMatch(
      /^\d{1,2} [A-Za-z]{3,} \d{4}$/,
    );
  });

  it("past the bound the TEXT changes shape, so state is not conveyed by colour alone", () => {
    // D-38-13 / UI-SPEC §3.7: the redundant channel here is the form of the string itself —
    // a running timer becomes a date. That survives greyscale and every form of CVD.
    const live = readElapsed(ago(20 * MINUTE), NOW, KARACHI);
    const stale = readElapsed(ago(5 * DAY), NOW, KARACHI);
    expect(live.compact).toMatch(/^\d{2}:\d{2}$/);
    expect(stale.compact).not.toMatch(/^\d{2}:\d{2}$/);
    expect(live.withinUrgencyWindow).not.toBe(stale.withinUrgencyWindow);
  });
});

describe("one answer per question", () => {
  it("the standalone formatters and readElapsed cannot disagree", () => {
    for (const ageMs of [0, 41 * SECOND, 7 * MINUTE, HOUR, 23 * HOUR, DAY, 5 * DAY, 400 * DAY]) {
      const since = ago(ageMs);
      const reading = readElapsed(since, NOW, KARACHI);
      expect(formatElapsedCompact(since, NOW, KARACHI), `age ${ageMs}`).toBe(reading.compact);
      expect(formatElapsedLong(since, NOW, KARACHI), `age ${ageMs}`).toBe(reading.long);
      expect(isWithinUrgencyWindow(since, NOW), `age ${ageMs}`).toBe(reading.withinUrgencyWindow);
    }
  });
});
