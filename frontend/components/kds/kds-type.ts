/**
 * The phase-20 type scale, as Tailwind classes.
 *
 * UI-SPEC §3.11 ships `--text-kds`, `--text-h2` and the rest as plain custom properties
 * and DELIBERATELY does not bridge them into `@theme` — `globals.css:399-408` explains
 * why: Tailwind owns the `--text-*` namespace, so declaring `--text-small: 13px` inside
 * `@theme` would silently re-typeset all ~700 existing `text-sm` call sites in one commit.
 * That bridge is scheduled for the PageHeader/PageBody step (§10.2 step 4), surface by
 * surface, where it can be reviewed.
 *
 * Until then a screen that wants the scale has to reference the properties directly. These
 * constants are that reference, in one place, so the KDS board is on the real tokens today
 * without touching `globals.css` (phase 20 owns it) and without a single hard-coded px.
 *
 * The full class strings are written out literally because Tailwind v4 scans raw source
 * text — a composed or templated class name would not be emitted.
 */

/** 22/28 weight-600 — the item line, sized for two metres. Measured 16.09:1 on --kds-card (re-measured after the board moved onto --neutral-h). */
export const T_KDS = "text-[length:var(--text-kds)] leading-[var(--text-kds-lh)]";
/** 20/28 — board heading. */
export const T_H1 = "text-[length:var(--text-h1)] leading-[var(--text-h1-lh)]";
/** 16/24 — order number, age chip. */
export const T_H2 = "text-[length:var(--text-h2)] leading-[var(--text-h2-lh)]";
/** 15/22 — modifiers, notes. */
export const T_BODY = "text-[length:var(--text-body)] leading-[var(--text-body-lh)]";
/** 13/18 — table, service type. */
export const T_SMALL = "text-[length:var(--text-small)] leading-[var(--text-small-lh)]";
/** 11/16 — column headers, flags. */
export const T_LABEL = "text-[length:var(--text-label)] leading-[var(--text-label-lh)]";
