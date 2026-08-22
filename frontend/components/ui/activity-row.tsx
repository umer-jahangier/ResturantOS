"use client";

import * as React from "react";
import Link from "next/link";

import { useZone } from "@/components/providers/zone-provider";
import { cn } from "@/lib/utils";

/**
 * The activity-feed row (N5) — a hue-tinted icon chip, a sentence with its SUBJECT promoted to
 * full brightness, and a right-pinned relative time.
 *
 * <h3>Why this exists when two things already wear the name</h3>
 *
 * `components/ui/alert.tsx` is a **bordered box notice** — one message, standing alone, with a
 * title and a description. It is not a feed. `ExceptionList` in `dashboard/portlets/portlet.tsx`
 * IS the nearest feed and stays exactly where it is: it is a *portlet body*, it triages by an
 * uppercase ACT/CHECK/FYI word, and it has no timestamp column at all. Neither one renders the
 * thing the demo does five times: a chronological stream where the reader scans the **subjects**
 * down the left edge, takes the hue as a pre-answer to "how bad", and reads the time on the right
 * to decide whether it is still true.
 *
 * The two are meant to sit side by side, so the shared conventions are shared on purpose: the same
 * tone vocabulary (`danger`/`warning`/`info` are spelled the same as `ExceptionRow["severity"]`),
 * the same `divide-border` hairline, the same `--foreground-tertiary` for metadata. What differs
 * is only what the demo measured as different — the chip, and the time.
 *
 * <h3>The timestamp, and why it is a STRING</h3>
 *
 * `timeLabel` is already formatted by the caller. This is a deliberate refusal of the two defects
 * relative time reliably produces:
 *
 *   · **Hydration.** A relative label computed from `Date.now()` renders one value on the server
 *     and a different one in the browser milliseconds later, and React reconciles that as a text
 *     mismatch. There is no clock read anywhere in this file.
 *   · **Unbounded duration.** This product currently renders `Oldest 113h 52m` on a live KDS,
 *     which is not a duration a human parses — it is a number that has escaped. Bounding is a
 *     formatting decision, it belongs in one place, and that place is `lib/format/elapsed.ts`
 *     (built alongside this by 38's sibling work). **This component deliberately ships no
 *     formatter of its own**; a second implementation is how the KDS got the first one wrong.
 *
 * Pass `dateTime` (an ISO 8601 string) as well and the label is wrapped in a real `<time>` with a
 * machine-readable `dateTime` — the precise instant reaches assistive tech and the DOM without
 * anything being *rendered* from it, so the hydration guarantee survives.
 *
 * <h3>Colour is never the only channel (D-38-13, UI-SPEC §4.2)</h3>
 *
 * **A state tone prints its word on the screen.** Not `sr-only` — visibly, in the row, next to
 * the chip. This is the rule `stat-tile.tsx` states for its delta ("which is why it is visible
 * text and not `sr-only`") and the rule `ExceptionList` in `dashboard/portlets/portlet.tsx`
 * already follows with its uppercase ACT / CHECK / FYI. §4.2 asks for text, shape **or** icon and
 * it asks for it *visibly*; `sr-only` serves only the reader who was never at risk from hue.
 *
 * <p><b>Why the word and not a tone-derived glyph.</b> The other way to satisfy §4.2 here is to
 * derive `icon` from `tone`, making shape the second channel. That was rejected: the glyph is the
 * caller's domain noun — a box for stock, a receipt for a void — and it is what makes a feed
 * scannable down its left edge. Deriving it would spend the row's only shape channel restating
 * something the word says better, and would leave the caller nowhere to put the noun. The
 * consequence is explicit and accepted: **the glyph is NOT a function of `tone`**, two severities
 * may legitimately share an icon, and the *word* is what separates them. That is the one channel
 * this component guarantees, so it is the one a caller cannot take away — `toneLabel` renames the
 * word, but an empty string no longer deletes it.
 *
 * <p>`icon` stays REQUIRED for the same reason it always was: a row with no glyph at all leans
 * that much harder on hue. The sentence itself also always states the fact in words — hue only
 * accelerates a scan, it never carries the fact alone.
 *
 * `secondary` (the teal) is offered as a CATEGORICAL tone and must never mean state. D-38-12/13
 * measured teal(182) at ΔE2000 **18.68** from `--success-600` — the closest pair in the whole
 * semantic set, and the one pairing a user will read as "green, so fine". Use it to distinguish a
 * *kind* of activity, never a severity. The demo's sixth hue is purple; there is no purple token
 * (`grep -c '--purple' globals.css` → 0) and one is not invented here.
 *
 * <h3>Zones (D-38-04) — designed for all three, safe in `operational` by default</h3>
 *
 * There is no `backdrop-filter`, no entrance animation, no parallax and no tilt in this file, so a
 * feed on the POS or a KDS board is legal as written. The single piece of richness — a ≤150 ms
 * hover colour transition on a linked row — is withheld in the `operational` zone by reading
 * `useZone()`, the same mechanism `Skeleton` uses to stop shimmering on a terminal. Anything
 * beyond that (glass, lift) is opt-in through `className` at an `expressive` call site.
 *
 * <h3>Money</h3>
 *
 * `children` is `ReactNode` precisely so a caller can put `<MoneyDisplay paisa={…} />` inside the
 * sentence. This file formats no currency, not even in a title attribute — paisa are BIGINT and
 * `MoneyDisplay` is the one site that turns them into text.
 */

/**
 * The hue channel. Four tones carry state; three are categorical.
 *
 * Spelled to match `ExceptionRow["severity"]` where they overlap so the two feeds do not disagree
 * about what "danger" is called one component apart.
 */
export type ActivityTone =
  | "danger"
  | "warning"
  | "success"
  | "info"
  | "accent"
  | "secondary"
  | "neutral";

/**
 * Chip tints sit at 10 % — the demo measures its own at ~8 %, and 10 is the nearest step that
 * still reads on a white card in light mode, which the dark-only demo never had to survive.
 */
const TONE_TINT: Record<ActivityTone, string> = {
  danger: "bg-destructive/10",
  warning: "bg-warning/10",
  success: "bg-success/10",
  info: "bg-info/10",
  accent: "bg-primary/10",
  secondary: "bg-secondary-500/10",
  neutral: "bg-muted",
};

/**
 * The ink — worn by the chip glyph AND by the tone word, from one record, so the two channels
 * cannot drift into two different reds.
 *
 * Two tones need an explicit per-theme stop to run at full strength: `--warning` resolves to
 * `--warning-400` in BOTH themes (L 0.74 — a pale yellow that is a fine fill and an illegible
 * glyph on white), and `--secondary` is the shadcn neutral, not the teal ramp, so the teal is
 * named by its stop. The other five already flip themselves.
 */
const TONE_INK: Record<ActivityTone, string> = {
  danger: "text-destructive",
  warning: "text-warning-700 dark:text-warning-400",
  success: "text-success",
  info: "text-info",
  accent: "text-primary",
  secondary: "text-secondary-700 dark:text-secondary-400",
  neutral: "text-foreground-secondary",
};

/**
 * The text channel for the tones that mean something. Categorical tones say nothing, because
 * they claim no severity for a word to carry.
 */
const TONE_WORD: Record<ActivityTone, string | null> = {
  danger: "Critical",
  warning: "Warning",
  success: "Completed",
  info: "Information",
  accent: null,
  secondary: null,
  neutral: null,
};

/**
 * Uppercased in CSS, not in the string. A DOM value of `CRITICAL` gets spelled out letter by
 * letter by some screen readers; `text-transform` is a rendering instruction that the
 * accessibility tree never sees. Same `text-label`/`tracking` treatment `DataGrid` gives a column
 * header and `ExceptionList` gives its severity tag, so the word reads as a tag on the row rather
 * than as the first word of the sentence.
 *
 * <p>`whitespace-nowrap` for the same reason the time column carries it: `INFORMATION` is the
 * longest word here, and a tag that breaks across two lines mid-word reads as damage rather than
 * as a severity. The sentence beside it is the flexible one — it holds `min-w-0 flex-1`, so it is
 * the element that gives up the space on a 390px feed.
 */
const TONE_WORD_CLASS =
  "shrink-0 text-label font-semibold uppercase tracking-wider whitespace-nowrap";

/**
 * The time column. `--foreground-tertiary`, which D-38-13 LIFTED to L 0.62 for exactly this use:
 * the demo prints timestamps in a tier that measures 3.21:1 and fails AA for read-for-meaning text.
 * `tabular-nums` so a column of "2m ago" / "14m ago" does not jitter as the feed refreshes.
 */
const TIME_CLASS = "shrink-0 text-label whitespace-nowrap text-foreground-tertiary tabular-nums";

export interface ActivityRowProps {
  /**
   * The chip glyph — a lucide icon, sized by the caller. Required: it is the non-colour channel
   * that makes the tone readable without hue (D-38-13). Marked `aria-hidden` here, because the
   * row's meaning lives in `children`.
   */
  icon: React.ReactNode;
  /**
   * The sentence. `ReactNode`, not `string`, because the subject is bold INSIDE the sentence —
   * wrap it in {@link ActivitySubject} — and because a caller may need `<MoneyDisplay>` in it.
   */
  children: React.ReactNode;
  /**
   * The relative time, ALREADY formatted and ALREADY bounded, e.g. `"2m ago"`. Format it with
   * `lib/format/elapsed.ts`; never with `Date.now()` at render.
   */
  timeLabel: string;
  /** ISO 8601 instant. Rendered only as `<time dateTime>` — never turned into visible text. */
  dateTime?: string;
  /** Defaults to `neutral`: a row that forgot to declare a tone claims no severity. */
  tone?: ActivityTone;
  /**
   * Renames the tone word for a state tone, or supplies one for a categorical tone.
   *
   * <p>It cannot DELETE a state tone's word: a blank falls back to the default. The word is the
   * non-colour channel a state tone is required to carry (D-38-13), so a prop that removes it is
   * a prop that hands the row back to hue alone.
   */
  toneLabel?: string;
  /** Makes the whole row a real link. Omit for a read-only feed; there is no `onClick` mode. */
  href?: string;
  className?: string;
}

export function ActivityRow({
  icon,
  children,
  timeLabel,
  dateTime,
  tone = "neutral",
  toneLabel,
  href,
  className,
}: ActivityRowProps) {
  const zone = useZone();
  // `||`, not `??`: a blank `toneLabel` falls back to the tone's own word rather than deleting
  // it. `??` would let `toneLabel=""` strip a state tone's only non-colour channel.
  const word = toneLabel?.trim() || TONE_WORD[tone];

  const body = (
    <>
      <span
        aria-hidden="true"
        data-slot="activity-icon"
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-md [&_svg]:size-3.5",
          TONE_TINT[tone],
          TONE_INK[tone],
        )}
      >
        {icon}
      </span>
      {word ? (
        <span data-slot="activity-tone" className={cn(TONE_WORD_CLASS, TONE_INK[tone])}>
          {word}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 text-small text-foreground-secondary">{children}</span>
      {/*
       * `<time>` only when there is a real instant to carry: a bare `<time>` whose content is
       * "2m ago" is invalid HTML, because without `dateTime` the element's text IS the machine
       * value. So the relative label degrades to a span rather than lying in the markup.
       */}
      {dateTime ? (
        <time dateTime={dateTime} data-slot="activity-time" className={TIME_CLASS}>
          {timeLabel}
        </time>
      ) : (
        <span data-slot="activity-time" className={TIME_CLASS}>
          {timeLabel}
        </span>
      )}
    </>
  );

  const rowClass = cn(
    "flex w-full items-center gap-2.5 py-2.5 text-left",
    href &&
      cn(
        // 44px, not the demo's 38 — D-38-15 records its touch targets as a NEGATIVE reference.
        "-mx-2 min-h-11 rounded-md px-2 hover:bg-surface-2 focus-visible:bg-surface-2",
        // The focus outline itself is global (`globals.css` `:focus-visible`); the surface change
        // above is a second channel so the row is findable inside a scrolling feed.
        zone !== "operational" && "transition-colors duration-150",
      ),
    className,
  );

  return (
    <li data-slot="activity-row" data-tone={tone} data-zone={zone}>
      {href ? (
        <Link href={href} className={rowClass}>
          {body}
        </Link>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </li>
  );
}

/**
 * The promoted subject inside the sentence — the demo's `.alert-text strong`, which is the whole
 * reason the feed is scannable: `--text-2` for the sentence, full `--text` for the noun the reader
 * is actually hunting for.
 */
export function ActivitySubject({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <strong className={cn("font-semibold text-foreground", className)}>{children}</strong>;
}

export interface ActivityFeedProps {
  /** {@link ActivityRow} children — each renders an `<li>`. */
  children: React.ReactNode;
  /** Names the feed for screen readers, e.g. `"Recent inventory alerts"`. */
  label: string;
  className?: string;
}

/**
 * The list the rows live in.
 *
 * Shipped in the same file rather than left to call sites because `ActivityRow` renders an `<li>`,
 * and a list item without a list is the kind of quiet semantic break that survives review. It also
 * owns the hairline — `divide-y` gives the demo's "border-bottom except the last child" for free,
 * with no `:last-child` rule to get wrong.
 */
export function ActivityFeed({ children, label, className }: ActivityFeedProps) {
  return (
    <ul
      aria-label={label}
      data-slot="activity-feed"
      className={cn("flex flex-col divide-y divide-border", className)}
    >
      {children}
    </ul>
  );
}
