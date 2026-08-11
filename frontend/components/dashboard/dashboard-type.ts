/**
 * The phase-20 type scale, as Tailwind classes — dashboard copy.
 *
 * Same reason as `components/kds/kds-type.ts`: UI-SPEC §3.11 ships `--text-h1`, `--text-body`
 * and the rest as plain custom properties and deliberately does NOT bridge them into
 * `@theme`, because doing so would silently re-typeset ~700 existing `text-sm` call sites in
 * one commit (`globals.css:399-408`). Screens opt in surface by surface until that bridge
 * lands with PageHeader/PageBody (§10.2 step 4).
 *
 * Duplicated rather than shared because `components/kds/**` and `components/dashboard/**` are
 * being rebuilt by concurrent work and a shared module in a third directory is a merge
 * conflict waiting to be resolved by whoever loses. Six lines is cheaper than that.
 */

export const T_DISPLAY = "text-[length:var(--text-display)] leading-[var(--text-display-lh)]";
export const T_H1 = "text-[length:var(--text-h1)] leading-[var(--text-h1-lh)]";
export const T_H2 = "text-[length:var(--text-h2)] leading-[var(--text-h2-lh)]";
export const T_BODY = "text-[length:var(--text-body)] leading-[var(--text-body-lh)]";
export const T_SMALL = "text-[length:var(--text-small)] leading-[var(--text-small-lh)]";
export const T_LABEL = "text-[length:var(--text-label)] leading-[var(--text-label-lh)]";
