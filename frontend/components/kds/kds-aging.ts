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
 */

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
  /** What a screen reader says instead of seeing any of the above. */
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

export function getAgingTreatment(
  ageMs: number,
  escalationThresholdSeconds: number = DEFAULT_ESCALATION_THRESHOLD_SECONDS,
): KdsAgingTreatment {
  const state = getAgingState(ageMs, escalationThresholdSeconds);
  const base = TREATMENTS[state];
  const srLabel =
    state === "late"
      ? `Late — ${formatAge(ageMs)} since fired, past this station's target`
      : state === "warn"
        ? `Due — ${formatAge(ageMs)} since fired, approaching this station's target`
        : `On time — ${formatAge(ageMs)} since fired`;
  return { state, srLabel, ...base };
}

/**
 * `mm:ss`, per the §7.2 ticket face.
 *
 * Above an hour it becomes `h:mm:ss` rather than letting the minute field run to four
 * digits. A ticket that has been on the board for four days is a real thing in seeded and
 * misconfigured environments, and `5772:14` is not a legible number at two metres — it
 * reads as noise, and a board that shows noise for its most alarming state is worse than
 * one that shows nothing.
 */
/**
 * The same age in PROSE, for the places a sentence is being read rather than a card scanned:
 * `"4 min"`, `"3h 52m"`, `"5d 3h"`.
 *
 * {@link formatAge} is a timer on a ticket face and stays exactly that — `mm:ss` counting up, read
 * at two metres. It is unusable in a sentence: the F17 confirmation has to say how old the oldest
 * ticket is, and "Oldest 123:35:12" is a number nobody can convert under time pressure into "five
 * days". Two formatters because there are genuinely two jobs, not because one was forgotten.
 */
export function formatAgeLong(ageMs: number): string {
  const totalMinutes = Math.max(0, Math.floor(ageMs / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) {
    const minutes = totalMinutes % 60;
    return minutes === 0 ? `${totalHours}h` : `${totalHours}h ${minutes}m`;
  }
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}

export function formatAge(ageMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(ageMs / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (totalMinutes < 60) return `${pad(totalMinutes)}:${pad(seconds)}`;
  const hours = Math.floor(totalMinutes / 60);
  return `${hours}:${pad(totalMinutes % 60)}:${pad(seconds)}`;
}
