"use client";

import { ThemeProvider as NextThemesProvider } from "@teispace/next-themes";
import type { ComponentProps } from "react";

/**
 * The light/dark switch, and its reveal (D-38-14).
 *
 * `transition` is a first-class prop of `@teispace/next-themes@2.0.3` — see
 * `node_modules/@teispace/next-themes/dist/types-Cm_0mzdd.d.ts:28-51`. It drives the
 * View Transitions API, so this costs **zero new dependencies**: `package.json` stays at
 * exactly 24 runtime deps, which `dependency-budget.test.ts` asserts. `startViewTransition`
 * appears nowhere else in this codebase; the fork owns it.
 *
 * `origin: "center"` is deliberate and is NOT the library default (`"cursor"`). The reveal
 * is meant to read as a single light source opening from the middle of the screen. With
 * `"cursor"` the circle originates at the last pointerdown — so a theme toggled from the
 * command palette (`top-bar.tsx`, ⌘K → "Toggle theme") would bloom from wherever the user
 * happened to click last, which reads as a rendering glitch rather than an intent.
 *
 * `duration` and `easing` are `--motion-entrance` / `--motion-entrance-ease` from
 * `globals.css`, restated as literals because this prop is read by JS before the stylesheet
 * is consulted. If those tokens move, move these with them.
 *
 * Three behaviours are inherited from the fork and deliberately NOT reimplemented here:
 *   1. `prefers-reduced-motion` suppresses the reveal by REMOVING it, not by shortening it.
 *      A 1 ms circular wipe is still a circular wipe.
 *   2. Engines without View Transitions no-op silently and the theme still flips.
 *   3. `disableTransitionOnChange` is reconciled internally — the kill-sheet that normally
 *      suppresses CSS transitions during a theme flip is skipped while a view transition is
 *      running, so the two mechanisms do not cancel each other.
 *
 * PRINT SAFETY — the gate this must clear before it ships anywhere near the POS.
 * `::view-transition-*` pseudo-elements create their own stacking and containment context
 * while running, and `receipt-print.css` depends on `position: fixed` resolving against the
 * viewport. G6 (containing-block/print safety) and G7 (rendered-PDF) are re-run on
 * `app/pos/**` for exactly this reason. A theme animation that prints the sidebar onto a
 * customer's bill is not a nice touch.
 */
/**
 * DARK IS THE DEFAULT, AND `enableSystem` STAYS ON. Both halves matter.
 *
 * This was `defaultTheme="system"`, which meant the product opened in whatever the machine
 * happened to prefer. The reference the owner reviews against is dark-only — `grep -c
 * 'prefers-color-scheme|data-theme'` over `Docs/NEXUS_ERP_Demo.html` returns **0**, it has no
 * light path at all — so on a light-mode laptop the first screen of the product was a white
 * office app being compared to a dark one, and "does not match the demo" was the correct
 * reading. The gold-on-blue-black identity is a DARK identity; the light theme is a faithful
 * translation of it, but it is the translation, not the original.
 *
 * `enableSystem` is deliberately NOT removed. Dropping it would delete the "System" option
 * from `ThemeToggle` and strand anyone who wants the OS to drive it. What `defaultTheme`
 * governs is only the resolution when NOTHING has been chosen: a stored choice in
 * `localStorage` still wins, and an explicit "System" selection still follows the OS —
 * including into light. Light mode remains fully supported and fully gated (every §3.8 light
 * pairing is still measured in `design-tokens.test.ts`); it is no longer what a first-time
 * visitor is shown.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      transition={{
        type: "circular",
        origin: "center",
        duration: 420,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
