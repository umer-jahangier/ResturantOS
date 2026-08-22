"use client";

import * as React from "react";
import { User } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The shared person avatar — an initials disc, optionally covered by a photograph.
 *
 * <h3>Why this file exists</h3>
 *
 * <p>The demo draws an avatar <b>ten times, nine of them inside a table cell</b>
 * (`DEMO-COMPONENTS.md` §2, `NEXUS_ERP_Demo.html:133-145` and the seven inline overrides at
 * `:1002-1006` / `:1284-1287`). We had <b>one</b>, and it was not a component: it was the class
 * list on the profile-menu trigger at `components/shared/top-bar.tsx:258`. Nothing exported it,
 * so nothing else could use it, so the nine table cells the product needs would each have
 * arrived as their own hand-rolled disc — which is exactly what the demo itself did, and why the
 * demo has seven different avatar gradients hardcoded in `style=` attributes and zero in CSS.
 *
 * <p>The measured cost of not having this primitive is therefore known in advance, from the
 * artefact we are copying. This file is that cost being refused once.
 *
 * <h3>It is not a button, and that is the whole design</h3>
 *
 * <p>The one call site we have today is a `DropdownMenuTrigger` — a real `<button>` with its own
 * `aria-label`, its own focus ring and its own press behaviour. A primitive that rendered a
 * `<button>` could not be adopted there without nesting interactive elements, which is invalid
 * HTML and produces a control screen readers cannot describe. So `Avatar` renders a plain
 * `<span>`: it composes INSIDE a button, a link, a table cell or nothing at all, and never
 * competes with its host for focus or for an accessible name.
 *
 * <p>Its focus affordance follows from that: the avatar has no tabindex, so it can never be
 * focused itself. When a focusable ANCESTOR is focused by keyboard it thickens its ring, via
 * two arbitrary variants that need no cooperation from the parent (no `group/` class to
 * remember, which means no call site can forget it). `top-bar.tsx` is not touched by this file.
 *
 * <h3>Silent by default (D-38-13)</h3>
 *
 * <p>Nine of the demo's ten avatars sit directly beside the person's name. An avatar in that
 * position is decoration, and announcing it makes a screen reader read every row twice — "A R,
 * Ahmed Raza, Super Admin". So `Avatar` is `aria-hidden` unless the caller passes `label`, which
 * is the case where the disc stands alone and genuinely carries the identity. There is no
 * default that guesses: you either give it words or it is silent.
 *
 * <h3>Tone is decoration and can never become meaning (D-38-12, D-38-13)</h3>
 *
 * <p>The tone is drawn ONLY from the two brand ramps, gold (`--brand-h`) and the teal
 * `secondary-*` ramp — never from `success`/`warning`/`danger`/`info`. That restraint is
 * deliberate and is the reverse of the usual "hash the name into a rainbow" avatar: in this
 * product a red disc beside a name would be read as a state, and D-38-12 already records that
 * the secondary ramp "MUST NOT carry state meaning" for the same reason. Identity is carried by
 * the initials — text, not hue — so colour is never the only channel here (D-38-13).
 *
 * <p>Every stop used sits between `-200` and `-500`. Measured with the repo's own
 * `colorjs.io` against `--primary-solid-foreground` in BOTH themes, the darkest stop in the set
 * (`-500`) is <b>6.20:1</b> (light) / <b>7.30:1</b> (dark) and the lightest is 12.80:1 / 15.07:1.
 * `-600` was measured at <b>4.31:1</b> in light mode and is excluded for that reason, not for
 * taste. So no pixel of any disc in any tone falls below AA for the initials sitting on it.
 *
 * <h3>Deterministic, and deterministic across machines</h3>
 *
 * <p>The tone comes from a 32-bit FNV-1a hash of a normalised key. No `Math.random`, no
 * `Date.now`, no module-level counter, no `Map` iteration order: the same person is the same
 * colour on every render, in every process, on every machine, and — because `toneKey` accepts a
 * stable id — under every spelling of their name. An avatar whose colour moved between the
 * server render and the client hydration would be a hydration mismatch on nine cells per page.
 *
 * <h3>Zones (D-38-04)</h3>
 *
 * <p>Safe in <b>all three</b> zones with no opt-in, including `operational` (POS, KDS). It uses
 * no `backdrop-filter`, no entrance animation, no parallax and no tilt. A static two-stop
 * gradient and a 1px ring are paint, not motion, and the component ships no "rich" variant to
 * forget to turn off — see the note at the foot of this file for what was deliberately not built.
 *
 * <h3>Why not `radix-ui`'s Avatar</h3>
 *
 * <p>Radix splits this into `Avatar.Root` / `Avatar.Image` / `Avatar.Fallback` and hands the
 * caller the composition. That pushes the two decisions that actually matter — what the initials
 * are, and what colour this person is — back out to all nine call sites, which is the precise
 * defect this file exists to close. Its image state machine also resolves client-side only, so a
 * server-rendered table would paint its photographs a frame late for no gain over
 * `<img onError>`.
 */

/**
 * The eight tones, as Tailwind gradient stop pairs.
 *
 * Exported so a test can assert the set itself rather than a rendered sample of it — the
 * contrast argument in the docblock is a claim about ALL eight, and a test that only ever sees
 * the three tones today's fixture names would not notice a ninth arriving off-contract.
 */
export const AVATAR_TONES = [
  "from-primary-200 to-primary-400",
  "from-secondary-200 to-secondary-400",
  "from-primary-300 to-primary-500",
  "from-secondary-300 to-secondary-500",
  "from-primary-300 to-secondary-500",
  "from-secondary-300 to-primary-500",
  "from-primary-200 to-secondary-400",
  "from-secondary-200 to-primary-400",
] as const;

/**
 * 32-bit FNV-1a over UTF-16 code units.
 *
 * `Math.imul` and `>>> 0` keep every intermediate an exact 32-bit integer, so this cannot drift
 * with the float behaviour of a JS engine; `charCodeAt` is not locale-sensitive. Both properties
 * are load-bearing — the output has to match between the Node render and the browser hydration.
 */
function fnv1a(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Collapse whitespace and case so "Ahmed  Raza " and "ahmed raza" are one person. */
function normaliseKey(key: string): string {
  return key.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The tone index for a key, in `[0, AVATAR_TONES.length)`. Pure and stable. */
export function avatarToneIndex(key: string): number {
  const normalised = normaliseKey(key);
  if (normalised === "") return 0;
  return fnv1a(normalised) % AVATAR_TONES.length;
}

/**
 * First letter of the first name plus first letter of the last, uppercased.
 *
 * A single-token name yields ONE letter, not two. "Ahmed" does not become "AH": the second
 * letter would be information the avatar invented, and a disc that reads "AH" next to a row
 * labelled "Ahmed" is a small lie in a product where nine of these appear per screen.
 * `Array.from` splits by code point, so a name outside the BMP does not lose half a character.
 */
export function avatarInitials(name: string): string {
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "";
  const head = Array.from(tokens[0]!)[0] ?? "";
  if (tokens.length === 1) return head.toUpperCase();
  const tail = Array.from(tokens[tokens.length - 1]!)[0] ?? "";
  return (head + tail).toUpperCase();
}

export type AvatarSize = "sm" | "md" | "lg";

/**
 * `md` (32px) is the default because it is BOTH sizes the brief asks for: the demo's table
 * avatars are 28-30px and `top-bar.tsx:258` is `size-8`. `sm` exists for a `DataGrid` compact
 * row (`h-8`), where a 32px disc would set the row height instead of fitting inside it.
 *
 * The type role is the contract's, never Tailwind's stock scale (gate G1): `text-label` is
 * 11px/16, which is the demo's own avatar font size measured at `:245`.
 */
const SIZE_CLASSES: Record<AvatarSize, string> = {
  sm: "size-6 text-label",
  md: "size-8 text-label",
  lg: "size-10 text-small",
};

const GLYPH_CLASSES: Record<AvatarSize, string> = {
  sm: "size-3",
  md: "size-4",
  lg: "size-5",
};

export interface AvatarProps {
  /** The person's display name. Supplies the initials, and the tone unless `toneKey` is given. */
  name: string;
  /**
   * A stable identifier — a user id — when the display name is not stable. "A. Raza" and "Ahmed
   * Raza" are one person and must be one colour; only the caller knows that, so only the caller
   * can say it.
   */
  toneKey?: string;
  /** Photograph URL. A load failure falls back to the initials silently — never a broken glyph. */
  src?: string | null;
  size?: AvatarSize;
  /**
   * The accessible name, for an avatar that STANDS ALONE.
   *
   * Omit it — the default — whenever the person's name is already rendered beside the disc, and
   * the avatar is marked `aria-hidden` so the row is announced once rather than twice. Passing
   * it makes the avatar a labelled `role="img"`, whose children are not announced, so the
   * initials are never read out as letters either way.
   */
  label?: string;
  className?: string;
}

export function Avatar({ name, toneKey, src, size = "md", label, className }: AvatarProps) {
  // Holding the failed URL rather than a boolean means a new `src` retries on its own, with no
  // effect and no key prop: the guard is `failedSrc !== src`, which a changed src fails.
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);

  const initials = avatarInitials(name);
  const toneIndex = avatarToneIndex(toneKey ?? name);
  const showImage = Boolean(src) && failedSrc !== src;

  return (
    <span
      data-slot="avatar"
      data-tone={toneIndex}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": "true" })}
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden",
        "rounded-full ring-1 ring-foreground/10",
        // The demo's identity recipe — linear-gradient(135deg, gold, teal) — through the token
        // ramps instead of the demo's inline hex. `bg-primary-solid` under it is not decoration:
        // it is the opaque fallback that paints if the gradient is ever unavailable, so the
        // initials always sit on a measured fill rather than on whatever is behind the disc.
        "bg-primary-solid bg-linear-to-br text-primary-solid-foreground",
        AVATAR_TONES[toneIndex],
        SIZE_CLASSES[size],
        "font-bold tracking-tight",
        // No tabindex here: the avatar is never the focus target. When the button or link
        // wrapping it takes keyboard focus, it thickens its own ring so the disc reads as part
        // of the focused control. Arbitrary variants, so no `group/` class is required of the
        // parent — a hook a call site can forget is a hook that will be forgotten.
        "[a:focus-visible_&]:ring-2 [a:focus-visible_&]:ring-ring",
        "[button:focus-visible_&]:ring-2 [button:focus-visible_&]:ring-ring",
        className,
      )}
    >
      {showImage ? (
        /* Avatar URLs are arbitrary remote origins, which next/image's optimiser would have
           to be told about one host at a time in next.config; and the element is 24-40px, so
           there is nothing for it to optimise. `MenuItemImage.tsx:92` reaches the same place
           for its own reasons. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!}
          alt=""
          aria-hidden="true"
          draggable={false}
          decoding="async"
          loading="lazy"
          data-testid="avatar-image"
          onError={() => setFailedSrc(src ?? null)}
          className="size-full object-cover"
        />
      ) : initials ? (
        <span data-testid="avatar-initials">{initials}</span>
      ) : (
        // A name we cannot take a letter from is rare but real (blank, or punctuation only).
        // A glyph is honest about that; a fabricated "?" would look like a state.
        <User className={GLYPH_CLASSES[size]} data-testid="avatar-glyph" aria-hidden="true" />
      )}
    </span>
  );
}

/*
 * Deliberately NOT built, so the next reader does not assume it was forgotten:
 *
 *  · **No `AvatarGroup` / stacked overlap.** The demo never stacks avatars — all ten are single
 *    discs — so there is no measured requirement, and an overlap rule invented here would be
 *    guessed rather than calibrated.
 *  · **No presence dot.** A green pip is a STATE, and D-38-13 keeps state in the semantic
 *    success/warning/danger set with a shape and a word beside the hue. It belongs on
 *    `StatusBadge`, not welded to an identity primitive where it would be colour-only.
 *  · **No "rich"/expressive variant.** The point of D-38-04 is that an operational surface is
 *    safe by DEFAULT; a component with an animated mode is a component that will appear on the
 *    KDS with the mode left on. There is nothing here to leave on.
 */
