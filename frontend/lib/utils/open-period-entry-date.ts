/**
 * Which date a fresh journal entry opens on — and, when that is not today, the sentence that
 * says why.
 *
 * The New Journal Entry screen used to compute this inline as "today if today happens to sit
 * inside `openPeriods[0]`, otherwise `openPeriods[0].startDate`", and then render the answer as
 * a bare `Selected: 2025-08-01` under a calendar still headed August 2026. Nothing on the screen
 * connected the two. An accountant reading it has no way to tell a stale default apart from a
 * bug, and the walkthrough duly filed it as "the date picker silently jumps a year back".
 *
 * Three things were wrong and are fixed here. The first is the one that mattered:
 *
 *  1. THE SCREEN WAS NOT TELLING THE TRUTH. The old rule read
 *
 *        const first = openPeriods?.[0];
 *        if (today >= first.startDate && today <= first.endDate) return today;
 *        return first.startDate;
 *
 *     — a one-element check standing in for a search. `GET /api/v1/finance/periods/open` on the
 *     live tenant returns TWENTY-TWO open periods: fiscal 2026 (Aug 2025 → Jun 2026) followed by
 *     fiscal 2027 (Aug 2026 → Jun 2027). Today, 12 Aug 2026, sits squarely inside FY2027 P2 —
 *     `2026-08-01 .. 2026-08-31`, status OPEN, twelfth in the list. The form never looked past
 *     the first entry, decided today was unpostable, and defaulted a year and eleven days back.
 *     It was not reporting a closed book; it was mis-reading an open one. `some()`, not `[0]`.
 *  2. When the fallback IS genuinely needed, the screen never said why. It is now a value with a
 *     reason attached, and {@link describeEntryDateDefault} turns that reason into a sentence the
 *     form renders BEFORE the calendar.
 *  3. `openPeriods[0]` is whatever the API listed first, and the earliest open period is by
 *     definition the furthest from today. The fallback is now the open date NEAREST to today.
 *
 * Every comparison is on the ISO `yyyy-mm-dd` string or on a UTC day number built from its parts.
 * No value here is ever passed to `new Date(iso)` — that parses a bare date as midnight UTC and
 * shifts it a day in every positive-offset zone, which is the same class of bug
 * `lib/forms/calendar-date.ts` exists to document.
 */

/** The slice of an accounting period this module needs. */
export interface OpenPeriodRange {
  startDate: string;
  endDate: string;
}

export type EntryDateReason =
  /** Today sits inside an open period — nothing to explain. */
  | "TODAY_IS_OPEN"
  /** Every open period ended before today (the usual case: nobody provisioned this fiscal year). */
  | "TODAY_AFTER_ALL_OPEN"
  /** Every open period starts after today. */
  | "TODAY_BEFORE_ALL_OPEN"
  /** Open periods exist on both sides of today but none covers it. */
  | "TODAY_IN_A_GAP"
  /** Nothing is open at all — no date is postable. */
  | "NO_OPEN_PERIODS";

export interface EntryDateDefault {
  /** The date to preselect, or "" when nothing is postable. */
  date: string;
  reason: EntryDateReason;
  /** The reference "today" the decision was made against, so the sentence can quote it. */
  today: string;
  /** Earliest postable date across all open periods, or null when none are open. */
  earliestOpen: string | null;
  /** Latest postable date across all open periods, or null when none are open. */
  latestOpen: string | null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * "2026-08-12" → "12 Aug 2026". Built from the string's own parts rather than a `Date`, so it
 * cannot shift a day, and from a fixed month table rather than `toLocaleDateString`, so a test
 * asserting the sentence reads the same on every machine.
 */
export function formatIsoDateLong(iso: string): string {
  const m = ISO_DATE.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return iso;
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/** The browser's LOCAL calendar date, which is the day the calendar grid itself draws. */
export function localIsoToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Day number since the epoch, for distance comparisons only. Never rendered. */
function dayNumber(iso: string): number | null {
  const m = ISO_DATE.exec(iso);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : Math.round(ms / 86_400_000);
}

/**
 * Pick the date a new journal entry should open on.
 *
 * @param periods the OPEN periods, in any order
 * @param today   the reference calendar date, `yyyy-mm-dd`
 */
export function resolveDefaultEntryDate(
  periods: readonly OpenPeriodRange[] | undefined | null,
  today: string,
): EntryDateDefault {
  const valid = (periods ?? []).filter(
    (p) => ISO_DATE.test(p.startDate) && ISO_DATE.test(p.endDate) && p.startDate <= p.endDate,
  );

  if (valid.length === 0) {
    return { date: "", reason: "NO_OPEN_PERIODS", today, earliestOpen: null, latestOpen: null };
  }

  const earliestOpen = valid.reduce((a, p) => (p.startDate < a ? p.startDate : a), valid[0]!.startDate);
  const latestOpen = valid.reduce((a, p) => (p.endDate > a ? p.endDate : a), valid[0]!.endDate);

  if (valid.some((p) => today >= p.startDate && today <= p.endDate)) {
    return { date: today, reason: "TODAY_IS_OPEN", today, earliestOpen, latestOpen };
  }

  if (today > latestOpen) {
    return { date: latestOpen, reason: "TODAY_AFTER_ALL_OPEN", today, earliestOpen, latestOpen };
  }
  if (today < earliestOpen) {
    return { date: earliestOpen, reason: "TODAY_BEFORE_ALL_OPEN", today, earliestOpen, latestOpen };
  }

  // A gap between two open periods. Take the nearer edge; on an exact tie prefer the past one,
  // because a date already behind the accountant is the safer of two wrong guesses.
  const before = valid
    .map((p) => p.endDate)
    .filter((d) => d < today)
    .reduce<string | null>((a, d) => (a === null || d > a ? d : a), null);
  const after = valid
    .map((p) => p.startDate)
    .filter((d) => d > today)
    .reduce<string | null>((a, d) => (a === null || d < a ? d : a), null);

  const todayNo = dayNumber(today);
  let chosen = before ?? after ?? earliestOpen;
  if (before && after && todayNo !== null) {
    const distBefore = todayNo - (dayNumber(before) ?? todayNo);
    const distAfter = (dayNumber(after) ?? todayNo) - todayNo;
    chosen = distAfter < distBefore ? after : before;
  }

  return { date: chosen, reason: "TODAY_IN_A_GAP", today, earliestOpen, latestOpen };
}

/**
 * The sentence the screen shows above the calendar. `null` when today is postable and there is
 * genuinely nothing to say — the screen must not grow a banner that always fires, or accountants
 * will stop reading it on the day it matters.
 */
export function describeEntryDateDefault(result: EntryDateDefault): string | null {
  const today = formatIsoDateLong(result.today);

  if (result.reason === "TODAY_IS_OPEN") return null;

  if (result.reason === "NO_OPEN_PERIODS") {
    return `No accounting period is open, so this entry cannot be dated or saved. Provision or reopen a period first.`;
  }

  const span = `Open periods run ${formatIsoDateLong(result.earliestOpen ?? "")} to ${formatIsoDateLong(
    result.latestOpen ?? "",
  )}.`;
  const chosen = formatIsoDateLong(result.date);

  if (result.reason === "TODAY_AFTER_ALL_OPEN") {
    return `Today, ${today}, is past every open accounting period. ${span} This entry is dated ${chosen} — the latest date you can post to. Change it below, or open a period covering today.`;
  }
  if (result.reason === "TODAY_BEFORE_ALL_OPEN") {
    return `Today, ${today}, is before every open accounting period. ${span} This entry is dated ${chosen} — the earliest date you can post to. Change it below, or open a period covering today.`;
  }
  return `Today, ${today}, falls between two open accounting periods. ${span} This entry is dated ${chosen} — the nearest date you can post to. Change it below, or open a period covering today.`;
}
