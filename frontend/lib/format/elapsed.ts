/**
 * Bounded elapsed-time formatting — the one place that decides when a clock stops counting.
 *
 * <h3>The defect this exists to kill</h3>
 *
 * A kitchen board renders `Oldest 113h 52m` today, and the dashboard repeats the same ticket
 * as `114:01:07` under the words ACT NOW. Both numbers are TRUE and both are USELESS: a cook
 * cannot convert 113 hours into "the Friday before last" while plating, and the urgency
 * treatment wrapped around them is a lie — nothing about a five-day-old ticket is actionable
 * in the next ninety seconds. Worse, it is a lie told in the SAME colour as the ticket that is
 * genuinely four minutes late, which is how a board teaches the people reading it to stop
 * believing the colour that matters. `station-picker.tsx:40-47` and `kds-aging.ts:150-158` each
 * grew their own unbounded formatter, so the two surfaces cannot even be fixed once. This
 * module is that one place (38-05 task 3, shared with 38-09 task 5).
 *
 * <h3>Why TWO formats, and why that is not duplication</h3>
 *
 * There are genuinely two jobs, and `__tests__/kds/kds-clear-stale.test.tsx:239` already says so
 * at the assertion:
 *
 *   - {@link formatElapsedCompact} is a TIMER ON A TICKET FACE. It is read at two metres, in a
 *     fixed-width column, by someone who is not reading it so much as glancing at it. `07:42`.
 *   - {@link formatElapsedLong} is PROSE INSIDE A SENTENCE. "This ticket has been up for 5d."
 *     `123:35:12` in that slot is a number nobody converts under pressure, which is exactly why
 *     the long form exists BESIDE the compact one and not INSTEAD of it.
 *
 * <h3>The thresholds, argued against how a cook actually reads a board</h3>
 *
 * | age | compact | long | why this boundary |
 * |---|---|---|---|
 * | `< 1 min`   | `00:41`  | `under a minute` | The count-up is the point. Prose has no useful word for 41 seconds, and `0 min` is a worse lie than a vague one. |
 * | `< 1 h`     | `07:42`  | `7 min`          | **Every ticket a kitchen legitimately holds lives here.** This band is the product; the rest is damage control. |
 * | `< 24 h`    | `3h 52m` | `3h 52m`         | Seconds are DROPPED at one hour, see below. |
 * | `< 30 d`    | `7 Aug`  | `5d`             | **The bound.** Counting stops. See below. |
 * | `≥ 30 d`    | `7 Aug`  | `7 Aug 2026`     | Past a month even days stop being a quantity anyone converts. `43d` is `113h 52m` wearing a smaller unit. |
 *
 * **Seconds are dropped at one hour, in BOTH forms.** Two reasons, and the second is the
 * binding one. (a) `13:47` must not be able to mean both thirteen minutes and thirteen hours on
 * the same board — a mm:ss timer and an h:mm timer are visually identical and catastrophically
 * different, so above an hour the units are spelled (`3h 52m`) and the ambiguity cannot arise.
 * (b) A ticking seconds column is MOTION. D-38-04 forbids attention-seeking animation in the
 * `operational` zone, and a second-hand repainting once a second on a ticket nobody is racing is
 * the most attention-seeking thing on an otherwise deliberately still board — spent on the one
 * ticket least deserving of attention.
 *
 * **The bound is 24 hours, and past it the compact form STOPS COUNTING and names the day.**
 * Not a longer unit — a different KIND of answer. A restaurant closes; the trading day cuts at
 * 04:00 branch-local. A ticket that survived a close is not late work, it is left-over data, and
 * the only question worth answering about it is *which day did this come from* so someone can go
 * and clear it. `7 Aug` answers that in six characters. `113h 52m` does not answer it at all.
 * The date is deliberately a DATE and never the word "yesterday": with a 04:00 cut, "yesterday"
 * has two meanings at 02:00, and this product has already shipped one trading-day boundary bug
 * of exactly that shape.
 *
 * **The long form crosses the same 24 h bound to `5d`, not to a date.** This is not an
 * inconsistency, it is the audience. Prose lives in a confirmation dialog that is read ONCE,
 * deliberately, with the reader stopped — `Clear 1 ticket … the oldest has been up for 5d` is
 * the sentence that makes someone press the button. The compact form lives on a surface that is
 * SCANNED, where a duration past the bound is pure noise. Same bound, different thing on the
 * far side of it, because "how long has this been here" and "which day is this from" are
 * different questions and only one of them survives being glanced at.
 *
 * <h3>Urgency is a returned value, not a rendering accident</h3>
 *
 * {@link readElapsed} returns `withinUrgencyWindow`. Past the bound it is `false` and the caller
 * MUST drop the late fill and the Flame icon (38-05 verification: *"a ticket older than 24h does
 * not receive the `late` fill"*). It is returned rather than recomputed at each call site
 * because the two live defect sites prove that a threshold duplicated is a threshold that drifts.
 * Note also that the encoding stays multi-channel per D-38-13 / UI-SPEC §3.7 without the caller
 * doing anything: past the bound the TEXT ITSELF changes shape, from a running timer to a date.
 * That is a redundant, colour-independent channel, and it survives greyscale.
 *
 * <h3>Purity</h3>
 *
 * `now` is an explicit parameter. Nothing here reads `Date.now()`, for two reasons: the KDS
 * already has a shared 10-second clock (`useKdsClock`) precisely so that every surface agrees on
 * one `now` and an age does not depend on what else happened to re-render; and this repo already
 * carries one test that hardcoded a date and went red when the world moved on. Tests here derive
 * every instant from a fixed `now` constant, so there is no second one.
 *
 * <h3>Zone</h3>
 *
 * Safe in **every** zone — `operational` (POS, KDS) and `expressive` alike. It is a pure string
 * function: no DOM, no classes, no timers, no `backdrop-filter`, nothing to animate. It renders
 * NO money; money goes through `components/ui/money-display.tsx` and nowhere else, this module
 * included.
 */

/** The bound. Past this the compact form stops counting and urgency is withdrawn. */
export const ELAPSED_URGENCY_BOUND_MS = 24 * 60 * 60 * 1000;

/** Past this even the prose form gives up on days and prints the date. */
export const ELAPSED_ABSOLUTE_BOUND_MS = 30 * 24 * 60 * 60 * 1000;

/** What every face renders when the instant is unusable — never `0`, never a date. */
export const ELAPSED_UNKNOWN = "—";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** An instant, in whichever of the three shapes the caller already holds. */
export type ElapsedInstant = number | string | Date;

export interface ElapsedOptions {
  /**
   * IANA zone for the absolute stamp past the bound — the BRANCH's clock, never the browser's.
   * A boundary printed in the wrong zone is the failure `kds-clear-stale.tsx` was written to
   * stop being invisible, so the caller is expected to pass the branch zone it already knows.
   * An unknown IANA name falls back to the runtime zone rather than throwing a `RangeError` out
   * of a render: a date in the reader's own zone beats a crashed board.
   */
  timeZone?: string;
  /** BCP-47 tag for the absolute stamp. `en-GB` matches the rest of the product's date copy. */
  locale?: string;
}

export interface ElapsedReading {
  /** Milliseconds elapsed, clamped at zero. `null` when `since` was not a usable instant. */
  ageMs: number | null;
  /** Ticket-face form. See {@link formatElapsedCompact}. */
  compact: string;
  /** Prose form, for a sentence. See {@link formatElapsedLong}. */
  long: string;
  /**
   * `false` once the age crosses {@link ELAPSED_URGENCY_BOUND_MS}, and `false` for an unusable
   * instant. When this is `false` the caller MUST NOT apply the late fill, the warn accent or
   * any other urgency treatment — the reading is history, not work.
   */
  withinUrgencyWindow: boolean;
  /**
   * What a screen reader says. Always spelled out in words, never the compact form: `07:42`
   * is announced as a clock time ("seven forty-two"), which is a different fact entirely.
   */
  srLabel: string;
}

const DEFAULT_LOCALE = "en-GB";

function toEpochMs(value: ElapsedInstant): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Elapsed milliseconds between two instants, clamped at zero.
 *
 * The clamp is not defensive tidiness. Ticket instants are stamped by `kitchen-service` and
 * compared against a browser clock, so a few seconds of skew routinely puts `since` in the
 * future. Unclamped that is a negative age, which floors to `-1d` and would send a ticket
 * fired three seconds ago straight past the bound and out of the urgency window — the exact
 * inversion of what this module is for.
 */
export function elapsedMs(since: ElapsedInstant, now: ElapsedInstant): number | null {
  const sinceMs = toEpochMs(since);
  const nowMs = toEpochMs(now);
  if (sinceMs === null || nowMs === null) return null;
  return Math.max(0, nowMs - sinceMs);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** `Intl` with the branch zone, degrading to the runtime zone rather than throwing. */
function formatInZone(
  at: Date,
  options: Intl.DateTimeFormatOptions,
  { timeZone, locale = DEFAULT_LOCALE }: ElapsedOptions,
): string {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(at);
  } catch {
    try {
      return new Intl.DateTimeFormat(locale, options).format(at);
    } catch {
      return new Intl.DateTimeFormat(DEFAULT_LOCALE, options).format(at);
    }
  }
}

const DAY_AND_MONTH: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
const DAY_MONTH_YEAR: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
};
const YEAR_ONLY: Intl.DateTimeFormatOptions = { year: "numeric" };

/**
 * `7 Aug` — the six-character answer to "which day is this from".
 *
 * The year appears ONLY when it differs from `now`'s year in the same zone. A ticket from last
 * August rendering a bare `7 Aug` beside one from this August is the ambiguity this whole module
 * is about, and the comparison is made in the branch zone because 31 Dec 23:30 PKT is already
 * next year in UTC.
 */
function absoluteShort(
  sinceMs: number,
  nowMs: number,
  options: ElapsedOptions,
): string {
  const at = new Date(sinceMs);
  const sameYear =
    formatInZone(at, YEAR_ONLY, options) === formatInZone(new Date(nowMs), YEAR_ONLY, options);
  return formatInZone(at, sameYear ? DAY_AND_MONTH : DAY_MONTH_YEAR, options);
}

/** `7 Aug 2026` — prose has room for the year, and always carries it. */
function absoluteLong(sinceMs: number, options: ElapsedOptions): string {
  return formatInZone(new Date(sinceMs), DAY_MONTH_YEAR, options);
}

function compactFrom(
  ageMs: number,
  sinceMs: number,
  nowMs: number,
  options: ElapsedOptions,
): string {
  if (ageMs < HOUR_MS) {
    const totalSeconds = Math.floor(ageMs / 1000);
    return `${pad2(Math.floor(totalSeconds / 60))}:${pad2(totalSeconds % 60)}`;
  }
  if (ageMs < ELAPSED_URGENCY_BOUND_MS) {
    const totalMinutes = Math.floor(ageMs / MINUTE_MS);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }
  return absoluteShort(sinceMs, nowMs, options);
}

function longFrom(ageMs: number, sinceMs: number, options: ElapsedOptions): string {
  if (ageMs < MINUTE_MS) return "under a minute";
  if (ageMs < HOUR_MS) return `${Math.floor(ageMs / MINUTE_MS)} min`;
  if (ageMs < ELAPSED_URGENCY_BOUND_MS) {
    const totalMinutes = Math.floor(ageMs / MINUTE_MS);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
  }
  if (ageMs < ELAPSED_ABSOLUTE_BOUND_MS) return `${Math.floor(ageMs / DAY_MS)}d`;
  return absoluteLong(sinceMs, options);
}

function srLabelFrom(ageMs: number, sinceMs: number, options: ElapsedOptions): string {
  if (ageMs < MINUTE_MS) return "under a minute";
  if (ageMs < HOUR_MS) {
    const totalSeconds = Math.floor(ageMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds === 0
      ? plural(minutes, "minute")
      : `${plural(minutes, "minute")} ${plural(seconds, "second")}`;
  }
  if (ageMs < ELAPSED_URGENCY_BOUND_MS) {
    const totalMinutes = Math.floor(ageMs / MINUTE_MS);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0
      ? plural(hours, "hour")
      : `${plural(hours, "hour")} ${plural(minutes, "minute")}`;
  }
  if (ageMs < ELAPSED_ABSOLUTE_BOUND_MS) return plural(Math.floor(ageMs / DAY_MS), "day");
  return absoluteLong(sinceMs, options);
}

/**
 * Both faces, the age and the urgency verdict, from one call.
 *
 * Prefer this over the two formatters wherever a surface renders a time AND styles it. Reading
 * the text from one function and the threshold from another is precisely how `Oldest 113h 52m`
 * ended up wrapped in an ACT NOW treatment: two answers to one question, drifting apart.
 */
export function readElapsed(
  since: ElapsedInstant,
  now: ElapsedInstant,
  options: ElapsedOptions = {},
): ElapsedReading {
  const ageMs = elapsedMs(since, now);
  if (ageMs === null) {
    return {
      ageMs: null,
      compact: ELAPSED_UNKNOWN,
      long: ELAPSED_UNKNOWN,
      // An age we cannot compute is never urgent. Guessing "urgent" from missing data is how a
      // board cries wolf; guessing "fine" at worst leaves a ticket looking ordinary.
      withinUrgencyWindow: false,
      srLabel: "age unknown",
    };
  }
  const sinceMs = toEpochMs(since) as number;
  const nowMs = toEpochMs(now) as number;
  return {
    ageMs,
    compact: compactFrom(ageMs, sinceMs, nowMs, options),
    long: longFrom(ageMs, sinceMs, options),
    withinUrgencyWindow: ageMs < ELAPSED_URGENCY_BOUND_MS,
    srLabel: srLabelFrom(ageMs, sinceMs, options),
  };
}

/**
 * The ticket face: `00:41` · `07:42` · `3h 52m` · `7 Aug`.
 *
 * Pair it with {@link readElapsed}'s `srLabel` — announced on its own, `07:42` is a clock time.
 */
export function formatElapsedCompact(
  since: ElapsedInstant,
  now: ElapsedInstant,
  options: ElapsedOptions = {},
): string {
  return readElapsed(since, now, options).compact;
}

/**
 * The sentence: `under a minute` · `7 min` · `3h 52m` · `5d` · `7 Aug 2026`.
 *
 * Reads correctly after "has been up for", which is the whole reason it is not the compact form.
 */
export function formatElapsedLong(
  since: ElapsedInstant,
  now: ElapsedInstant,
  options: ElapsedOptions = {},
): string {
  return readElapsed(since, now, options).long;
}

/**
 * `false` once the age crosses the bound — the caller drops the late fill and the Flame icon.
 *
 * Exported separately for the surfaces that style a row without printing its age.
 */
export function isWithinUrgencyWindow(since: ElapsedInstant, now: ElapsedInstant): boolean {
  const ageMs = elapsedMs(since, now);
  return ageMs !== null && ageMs < ELAPSED_URGENCY_BOUND_MS;
}
