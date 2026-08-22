import type { Zone } from "@/components/providers/zone-provider";

/**
 * The entrance class the shared portalled overlays use, and the one rule for who may wear it.
 *
 * <h3>Why this is a function and not a string in five files</h3>
 *
 * <p>Every overlay in `components/ui` is imported by the POS and the KDS. D-38-04 gives those two
 * surfaces depth cues and nothing else — no entrance animation, no parallax, no tilt — and the
 * spec's own warning is that nobody violates it on purpose: *"they violate it by putting glass on
 * a shared `Card` the POS imports."* The stock shadcn overlays arrived carrying `zoom-in-95` and
 * `slide-in-from-*`, so a cashier opening a modifier dialog two hundred times a shift was
 * inheriting a transform-carrying entrance from a file nobody thought of as a POS file.
 *
 * <h3>Two independent channels, because neither covers the other's blind spot</h3>
 *
 * <ol>
 *   <li><b>This function</b> decides whether the class is emitted at all, reading the zone from
 *       React context — which portals preserve — rather than from DOM ancestry, which they do
 *       not. Per D-38-05 a modal inherits the zone that OPENED it, so no component hard-codes
 *       its own answer.</li>
 *   <li><b>The cascade</b> decides whether the class does anything:
 *       `[data-zone="expressive"] .vdl-enter-scale` in globals.css (34-02's vocabulary, and the
 *       same rule `Reveal` rides on). It also carries the `prefers-reduced-motion` removal, which
 *       the Tailwind entrance utilities this replaced did not.</li>
 * </ol>
 *
 * <p>The consequence worth stating: the class reaching a restrained surface animates nothing
 * today, because the rule is expressive-scoped. That is UI-SPEC §5 — restrained gets elevation
 * and ≤150ms transitions, no decorative motion — and if that is ever revisited it is one
 * selector in globals.css, not five component edits.
 *
 * <p>The class carries no resting style. Strip it and the overlay is exactly where it was, at
 * full opacity (the resting-state contract in globals.css). That is what makes it safe to omit
 * on the operational zone: omission removes an animation, never content.
 */
export const ENTRANCE_CLASS = "vdl-enter-scale";

/**
 * The entrance class for `zone`, or `undefined` where motion is not licensed.
 *
 * <p>Returns `undefined` rather than `""` so `cn()` drops it entirely and the operational DOM
 * carries no trace of a motion vocabulary it is not allowed to use.
 */
export function overlayEntranceClass(zone: Zone): string | undefined {
  return zone === "operational" ? undefined : ENTRANCE_CLASS;
}
