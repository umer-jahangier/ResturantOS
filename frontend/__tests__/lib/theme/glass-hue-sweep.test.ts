import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { rawToken, type Scope } from "./css-tokens";
import { FRONTEND_ROOT } from "./module-graph";
import { compositeOver, wcagContrastCheck } from "@/lib/theme/wcag-validator";
import { FLOOR_RATIO, GLASS_SURFACES } from "@/lib/theme/glass-surfaces";

/**
 * Glass contrast across the WHOLE `--brand-h` range — not only at the shipped 195.
 *
 * <h3>What this is, and what it is NOT</h3>
 *
 * It would be easy to describe this as protecting tenants from picking a brand hue that drops
 * text below AA. **That is not what it does, and claiming so would be wrong** — the claim was
 * made during this phase and is corrected here.
 *
 * `app/api/theme/route.ts` is the only runtime path that can retint the product, and it emits
 * exactly thirteen declarations: `--primary-50 … --primary-950`, `--primary` and
 * `--primary-foreground`. It does **not** emit `--brand-h`, and it does not emit any neutral,
 * surface or foreground token. Every input to a glass measurement — the fill, its substrates
 * and its foregrounds — resolves through the neutral ramp at `--brand-h`, so a tenant changing
 * their brand colour cannot move a single figure in the glass contrast table. Verified by
 * reading the route rather than assumed.
 *
 * <h3>So what is this for</h3>
 *
 * `--brand-h` is a BUILD-TIME knob, and D-UI-01's whole claim is that the system regenerates
 * from that one number. If it is ever changed — a rebrand, a white-label build, a different
 * default — every glass surface must still clear its floor. Today that is unproven at any hue
 * but 195, so the regeneration claim holds for the primary ramp (which phase 20 checked) and is
 * merely hoped for on the surfaces this phase added.
 *
 * This sweeps all 360 degrees at 5° steps in both themes and both deployment conditions.
 */

/** Resolve a token's `var()` chain with `--brand-h` forced to `hue`. */
function tokenAtHue(name: string, scope: Scope, hue: number): string {
  let value = rawToken(name, scope);
  for (let depth = 0; value.includes("var("); depth += 1) {
    if (depth > 16) throw new Error(`cyclic var() chain resolving ${name}`);
    value = value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, ref: string) =>
      ref === "--brand-h" ? String(hue) : rawToken(ref, scope),
    );
  }
  return value;
}

const HUES = Array.from({ length: 72 }, (_, i) => i * 5); // 0, 5, … 355

interface Worst {
  ratio: number;
  hue: number;
  detail: string;
}

function sweep(measure: (hue: number) => { ratio: number; detail: string }): Worst {
  let worst: Worst = { ratio: Infinity, hue: -1, detail: "" };
  for (const hue of HUES) {
    const { ratio, detail } = measure(hue);
    if (ratio < worst.ratio) worst = { ratio, hue, detail };
  }
  return worst;
}

describe("D-34-04 · glass clears its floor at EVERY brand hue, not only at 195", () => {
  const cases = GLASS_SURFACES.flatMap((surface) =>
    surface.foregroundTokens.flatMap((fg) =>
      (["light", "dark"] as const).map(
        (scope) => [`${scope} · ${surface.id} · ${fg}`, surface, fg, scope] as const,
      ),
    ),
  );

  it.each(cases)("%s — filter unavailable", (_label, surface, fg, scope) => {
    const worst = sweep((hue) => ({
      ratio: wcagContrastCheck(
        tokenAtHue(fg, scope, hue),
        tokenAtHue(surface.fallbackToken, scope, hue),
      ).ratio,
      detail: `${fg} on ${surface.fallbackToken}`,
    }));

    expect(
      worst.ratio,
      `worst hue is ${worst.hue}° at ${worst.ratio}:1 (${worst.detail}). A design system that ` +
        `is accessible at one hue is accessible by accident.`,
    ).toBeGreaterThanOrEqual(FLOOR_RATIO[surface.floor]);
  });

  it.each(cases)("%s — composited over every declared substrate", (_label, surface, fg, scope) => {
    const worst = sweep((hue) => {
      let low = Infinity;
      let which = "";
      for (const sub of surface.substrateTokens) {
        const composited = compositeOver(
          tokenAtHue(surface.fillToken, scope, hue),
          tokenAtHue(sub, scope, hue),
        );
        const { ratio } = wcagContrastCheck(tokenAtHue(fg, scope, hue), composited);
        if (ratio < low) {
          low = ratio;
          which = sub;
        }
      }
      return { ratio: low, detail: `${fg} over ${surface.fillToken} on ${which}` };
    });

    expect(
      worst.ratio,
      `worst hue is ${worst.hue}° at ${worst.ratio}:1 (${worst.detail})`,
    ).toBeGreaterThanOrEqual(FLOOR_RATIO[surface.floor]);
  });

  it("records the single worst pairing across the entire sweep", () => {
    let worst = { ratio: Infinity, label: "" };
    for (const surface of GLASS_SURFACES) {
      for (const fg of surface.foregroundTokens) {
        for (const scope of ["light", "dark"] as const) {
          for (const hue of HUES) {
            for (const sub of surface.substrateTokens) {
              const composited = compositeOver(
                tokenAtHue(surface.fillToken, scope, hue),
                tokenAtHue(sub, scope, hue),
              );
              const { ratio } = wcagContrastCheck(tokenAtHue(fg, scope, hue), composited);
              if (ratio < worst.ratio) {
                worst = { ratio, label: `${scope}/${surface.id}/${fg} over ${sub} @ ${hue}°` };
              }
            }
          }
        }
      }
    }
    // Printed so the figure lands in the phase's SPEC rather than only in a green tick.
    process.stderr.write(`\n  GLASS HUE SWEEP — worst case: ${worst.ratio}:1 (${worst.label})\n`);
    expect(worst.ratio).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the runtime theme route cannot move a glass measurement", () => {
  /**
   * This is the assertion that makes the docblock's claim checkable rather than a comment that
   * silently stops being true. If someone later adds `--brand-h` (or a neutral, or a surface)
   * to the theme route, glass contrast becomes tenant-controlled at runtime — and THEN the
   * appearance screen genuinely does need a guard.
   */
  const route = readFileSync(resolve(FRONTEND_ROOT, "app/api/theme/route.ts"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

  /** Custom properties the route emits into its generated stylesheet. */
  const emitted = [...route.matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]!);

  it("emits only primary-ramp tokens", () => {
    expect(
      emitted.length,
      "the route emits nothing — this test would pass vacuously",
    ).toBeGreaterThan(0);
    const nonPrimary = emitted.filter((name) => !name.startsWith("--primary"));
    expect(
      nonPrimary,
      "the runtime theme route now emits tokens outside the primary ramp. If any of these feed " +
        "a glass fill, substrate or foreground, then a TENANT can move glass contrast at " +
        "runtime and the sweep above (a build-time guarantee) is no longer sufficient — the " +
        "appearance screen needs its own contrast guard at that point.\n" +
        nonPrimary.join("\n"),
    ).toEqual([]);
  });

  it("does not emit --brand-h", () => {
    expect(
      route.includes("--brand-h"),
      "--brand-h became runtime-settable. Every glass token is authored against it, so glass " +
        "contrast would become tenant-controlled.",
    ).toBe(false);
  });

  it("no glass input resolves through the primary ramp", () => {
    // The other half of the argument: even though the route moves --primary-*, no glass
    // measurement reads it. Checked by resolving each input and asserting no primary token
    // appears anywhere in its var() chain.
    const chainOf = (name: string, scope: Scope): string[] => {
      const seen: string[] = [];
      let value = rawToken(name, scope);
      for (let depth = 0; value.includes("var(") && depth < 16; depth += 1) {
        value = value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, ref: string) => {
          seen.push(ref);
          return ref === "--brand-h" ? "195" : rawToken(ref, scope);
        });
      }
      return seen;
    };

    for (const surface of GLASS_SURFACES) {
      const inputs = [
        surface.fillToken,
        surface.fallbackToken,
        ...surface.substrateTokens,
        ...surface.foregroundTokens,
      ];
      for (const input of inputs) {
        for (const scope of ["light", "dark"] as const) {
          const chain = chainOf(input, scope);
          const viaPrimary = chain.filter((ref) => /^--primary/.test(ref));
          expect(
            viaPrimary,
            `${input} (${scope}) resolves through ${viaPrimary.join(", ")}, which the theme ` +
              `route overrides at runtime — so this glass measurement IS tenant-controlled.`,
          ).toEqual([]);
        }
      }
    }
  });
});
