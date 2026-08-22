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
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
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
