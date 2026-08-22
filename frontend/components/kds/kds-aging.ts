/**
 * KDS ticket ageing — the encoding, isolated from the card that renders it.
 *
 * <h3>Why this is not "pick a colour"</h3>
 *
 * UI-SPEC §3.7 measured the three ageing colours against simulated colour-vision
 * deficiency. `--kds-fresh` against `--kds-warn` separates by ΔE2000 **8.3 under
 * protanopia** — the weakest pairing anywhere in the design system, and it sits on the
 * one screen read under time pressure. A protanope reading a wall-mounted board across a
 * hot kitchen is not going to resolve 8.3 ΔE, so colour ALONE IS FORBIDDEN here.
 *
 * The contract is therefore three redundant channels, each independently sufficient:
 *
 *   1. **Left border width** — 2px / 4px / 6px. Survives greyscale, survives CVD, survives
 *      a screen with the contrast knob wound down. It is geometry, not colour.
 *   2. **A distinct icon** — Clock / AlertTriangle / Flame. Different SHAPES, not one shape
 *      in three colours; `Flame` is additionally filled so it reads as a solid mass.
 *   3. **Chip text** — the timer always, plus the literal words "DUE" and "LATE". Text is
 *      the only channel that survives a monochrome thermal-printer-grade display.
 *
 * And late gets a fourth: `fillsCard`. **Late is a FILL change, not a hue change** — the
 * entire card body moves to `--kds-late-fill`, which is a ~0.16 ΔL greyscale step and the
 * most robust encoding available. It is also the most alarming, which is correct: a late
 * ticket is the one thing on this board that must interrupt.
 *
 * <h3>What is deliberately unchanged</h3>
 *
 * The fraction logic. `ageMs / (escalationThresholdSeconds * 1000)`, warn at 0.66, late at
 * 1.0 — carried over byte-for-byte from the pre-phase-21 `getAgingTreatment`. It scales
 * with each station's OWN `escalationThresholdSeconds` rather than the industry's fixed
 * 5-and-8-minute convention, which is the more principled rule and was already right. A
 * grill and a dessert pass do not age at the same speed; the data already knows that.
 *
 * <h3>What LEFT, and why it had to</h3>
 *
 * This file used to own two elapsed-time formatters of its own — `formatAge` (`mm:ss`, then
 * `h:mm:ss`) and `formatAgeLong` (`4d 17h`). They are gone. `lib/format/elapsed.ts` names this
 * file in its own docblock as one of the two duplicates it exists to kill, and while both lived
 * the product shipped THREE duration formatters that disagreed: the same ticket read `4d 17h`
 * here and `4d` there, and neither of them ever stopped counting, so a check left open over a
 * close rendered `113h 52m` in the same red as one four minutes late.
 *
 * Both were also UNBOUNDED, which is the half that costs money. `elapsed.ts` stops counting at
 * 24 h, names the DATE instead, and returns `withinUrgencyWindow` as a value so a surface cannot
 * style a five-day-old ticket as urgent by forgetting a threshold it had copied.
 *
 * The THRESHOLDS in this file did not move and must not: `getAgingState`'s fraction is measured
 * against each station's own escalation target, which is a different question from "is this
 * reading still live work at all". Only the formatting left.
 */

import { readElapsed } from "@/lib/format/elapsed";

export type KdsAgingState = "fresh" | "warn" | "late";

/** Icon identity as a value, so this module carries no JSX and no React import. */
export type KdsAgingIcon = "clock" | "alert-triangle" | "flame";

export interface KdsAgingTreatment {
  state: KdsAgingState;
  /** CHANNEL 1 — geometry. Survives greyscale and every form of CVD. */
  borderWidthPx: 2 | 4 | 6;
  /** CHANNEL 2 — shape. Three different glyphs, not one glyph in three colours. */
  icon: KdsAgingIcon;
  /** CHANNEL 3 — text. Empty for fresh: the timer itself is the word. */
  chipSuffix: "" | "DUE" | "LATE";
  /**
   * CHANNEL 4, late only — the card body fill moves to `--kds-late-fill` (§3.7). This is
   * the strongest encoding in the system and is reserved for the state that must interrupt.
   */
  fillsCard: boolean;
  /** Tailwind token class for the border + chip + icon colour (never the only signal). */
  accentClass: string;
  /**
   * What a screen reader says instead of seeing any of the above.
   *
   * The age inside it is `lib/format/elapsed.ts`'s `srLabel` — words, never the ticket face's
   * `07:42`, which a screen reader announces as a clock time ("seven forty-two") and which is a
   * different fact entirely.
   */
  srLabel: string;
}

export const DEFAULT_ESCALATION_THRESHOLD_SECONDS = 900; // 15 minutes

/**
 * The fraction thresholds. Exported so a test asserts against the same two numbers the
 * component uses rather than re-typing them and drifting.
 */
export const KDS_WARN_FRACTION = 0.66;
export const KDS_LATE_FRACTION = 1;

const TREATMENTS: Record<KdsAgingState, Omit<KdsAgingTreatment, "state" | "srLabel">> = {
  fresh: {
    borderWidthPx: 2,
    icon: "clock",
    chipSuffix: "",
    fillsCard: false,
    accentClass: "text-kds-fresh",
  },
  warn: {
    borderWidthPx: 4,
    icon: "alert-triangle",
    chipSuffix: "DUE",
    fillsCard: false,
    accentClass: "text-kds-warn",
  },
  late: {
    borderWidthPx: 6,
    icon: "flame",
    chipSuffix: "LATE",
    fillsCard: true,
    accentClass: "text-kds-late",
  },
};

/**
 * The station-relative ageing state. Fraction logic preserved exactly from the pre-phase-21
 * card (UI-SPEC §7.2 "Keep `getAgingTreatment`'s fraction logic exactly").
 */
export function getAgingState(ageMs: number, escalationThresholdSeconds: number): KdsAgingState {
  const threshold = escalationThresholdSeconds || DEFAULT_ESCALATION_THRESHOLD_SECONDS;
  const fraction = ageMs / (threshold * 1000);
  if (fraction >= KDS_LATE_FRACTION) return "late";
  if (fraction >= KDS_WARN_FRACTION) return "warn";
  return "fresh";
}

/**
 * @param ageMs how long the ticket has been up, on the caller's shared KDS clock.
 * @param escalationThresholdSeconds THIS station's target — never a global convention.
 * @param now the same clock tick `ageMs` was measured against. Only the spoken age needs it,
 *   and only past thirty days, where {@link readElapsed} names the DATE the ticket was fired
 *   rather than counting days at it — which it cannot do from an age alone. Defaulted so the
 *   two-argument call still works; a caller that has a clock should pass it.
 */
export function getAgingTreatment(
  ageMs: number,
  escalationThresholdSeconds: number = DEFAULT_ESCALATION_THRESHOLD_SECONDS,
  now: number = ageMs,
): KdsAgingTreatment {
  const state = getAgingState(ageMs, escalationThresholdSeconds);
  const base = TREATMENTS[state];
  // `now - ageMs` is the instant the ticket was fired, so `readElapsed` measures exactly
  // `ageMs` back and can still name a date past its own bound.
  const spokenAge = readElapsed(now - ageMs, now).srLabel;
  const srLabel =
    state === "late"
      ? `Late — ${spokenAge} since fired, past this station's target`
      : state === "warn"
        ? `Due — ${spokenAge} since fired, approaching this station's target`
        : `On time — ${spokenAge} since fired`;
  return { state, srLabel, ...base };
}
