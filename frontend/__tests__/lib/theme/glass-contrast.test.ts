import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import Color from "colorjs.io";

import { token, rawToken, tokenNames, type Scope } from "./css-tokens";
import { FRONTEND_ROOT } from "./module-graph";
import { compositeOver, wcagContrastCheck } from "@/lib/theme/wcag-validator";
import {
  DECLARED_GLASS_TOKENS,
  DEPTH_TOKENS,
  FLOOR_RATIO,
  GLASS_SURFACES,
} from "@/lib/theme/glass-surfaces";

/**
 * The phase-34 glass contrast table — the §3.8 table of phase 20, extended rather than
 * replaced, and measured under BOTH real deployment conditions.
 *
 * <h3>Why two conditions and not one</h3>
 *
 * `backdrop-filter` is unsupported or disabled in real deployments — an old Android WebView,
 * a hardened enterprise browser, a user with GPU acceleration off. D-34-04 says every glass
 * surface must still meet contrast when it is not there. Those are two DIFFERENT colours, so
 * they are two different measurements:
 *
 * <ol>
 *   <li><b>Fallback</b> — the foreground against the surface's opaque colour. No compositing;
 *       an ordinary opaque pairing measured by the function that measured phase 20's 53.</li>
 *   <li><b>Enhancement</b> — the foreground against the fill COMPOSITED over each declared
 *       substrate in turn, worst case taken. This is the supported case as it renders.</li>
 * </ol>
 *
 * <p>Both figures are recorded as drift gates in the same style phase 20 records its 53, so an
 * alpha nudged by 0.02 fails loudly rather than quietly moving a ratio nobody re-checks.
 *
 * <p><b>Measured 2026-08-11.</b> The binding constraint across the whole table is
 * `--foreground-tertiary` on the light panel composited over `--surface-3`, at 5.34:1. That is
 * the number to watch: it has the least headroom over the 4.5:1 floor, so it is what will
 * break first if a fill alpha drops or a surface step darkens.
 */

const CSS = readFileSync(resolve(FRONTEND_ROOT, "app/globals.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** [surfaceId, foreground, scope, fallbackRatio, worstCompositeRatio] */
type GlassRow = readonly [string, string, Scope, number, number];

const ROWS: readonly GlassRow[] = [
  // ── light ────────────────────────────────────────────────────────────────────
  ["panel", "--foreground", "light", 18.01, 17.73],
  ["panel", "--foreground-secondary", "light", 8.26, 8.13],
  ["panel", "--foreground-tertiary", "light", 5.42, 5.34],
  ["overlay", "--foreground", "light", 17.49, 18.17],
  ["overlay", "--foreground-secondary", "light", 8.02, 8.34],
  // ── dark ─────────────────────────────────────────────────────────────────────
  ["panel", "--foreground", "dark", 15.64, 14.31],
  ["panel", "--foreground-secondary", "dark", 11.12, 10.17],
  ["panel", "--foreground-tertiary", "dark", 7.11, 6.5],
  ["overlay", "--foreground", "dark", 14.13, 14.35],
  ["overlay", "--foreground-secondary", "dark", 10.04, 10.2],
];

const surface = (id: string) => {
  const found = GLASS_SURFACES.find((s) => s.id === id);
  if (!found) throw new Error(`no glass surface with id "${id}"`);
  return found;
};

/** Worst-case composite ratio across every declared substrate, and which substrate produced it. */
function worstComposite(
  fg: string,
  fillToken: string,
  substrates: readonly string[],
  scope: Scope,
): { ratio: number; substrate: string } {
  let worst = Infinity;
  let which = "";
  for (const sub of substrates) {
    const { ratio } = wcagContrastCheck(
      token(fg, scope),
      compositeOver(token(fillToken, scope), token(sub, scope)),
    );
    if (ratio < worst) {
      worst = ratio;
      which = sub;
    }
  }
  return { ratio: worst, substrate: which };
}

describe("D-34-04 · condition one — the surface with the compositing filter UNAVAILABLE", () => {
  it.each(ROWS.map((r) => [`${r[2]} · ${r[0]} · ${r[1]}`, r] as const))("%s", (_label, row) => {
    const [id, fg, scope, expectedFallback] = row;
    const s = surface(id);
    const { ratio } = wcagContrastCheck(token(fg, scope), token(s.fallbackToken, scope));

    // 1. the real gate — this is what ships where backdrop-filter is not available
    expect(
      ratio,
      `${fg} on ${s.fallbackToken} (${scope}) must clear ${s.floor} (≥${FLOOR_RATIO[s.floor]}:1) ` +
        `with the filter DISABLED — that is the whole of D-34-04`,
    ).toBeGreaterThanOrEqual(FLOOR_RATIO[s.floor]);

    // 2. the drift gate
    expect(
      Math.abs(ratio - expectedFallback),
      `${fg} on ${s.fallbackToken} (${scope}): measured ${ratio}:1, table records ${expectedFallback}:1`,
    ).toBeLessThanOrEqual(0.02);
  });
});

describe("D-34-01 · condition two — the surface as it actually renders (composited)", () => {
  it.each(ROWS.map((r) => [`${r[2]} · ${r[0]} · ${r[1]}`, r] as const))("%s", (_label, row) => {
    const [id, fg, scope, , expectedComposite] = row;
    const s = surface(id);
    const { ratio, substrate } = worstComposite(fg, s.fillToken, s.substrateTokens, scope);

    expect(
      ratio,
      `${fg} over ${s.fillToken} composited on ${substrate} (${scope}) must clear ${s.floor}. ` +
        `A glass surface that drops text below its floor is a regression, not a style (D-34-01).`,
    ).toBeGreaterThanOrEqual(FLOOR_RATIO[s.floor]);

    expect(
      Math.abs(ratio - expectedComposite),
      `${fg} over ${s.id} (${scope}): measured ${ratio}:1 worst-case (on ${substrate}), ` +
        `table records ${expectedComposite}:1`,
    ).toBeLessThanOrEqual(0.02);
  });
});

describe("D-34-04 · structural properties the numbers cannot express", () => {
  it("the manifest and the stylesheet are mutually exhaustive", () => {
    // The realistic way this guarantee decays is not a wrong number — it is a NEW glass token
    // added later with no declared substrate set, which then goes unmeasured forever.
    const inCss = new Set<string>();
    for (const block of ["root", "dark", "kds"] as const) {
      for (const name of tokenNames(block)) {
        if (name.startsWith("--glass-")) inCss.add(name);
      }
    }
    const declared = new Set<string>(DECLARED_GLASS_TOKENS);

    const undeclared = [...inCss].filter((n) => !declared.has(n)).sort();
    expect(
      undeclared,
      "glass token(s) exist in globals.css that the manifest does not know about, so nothing " +
        "measures them. Add them to glass-surfaces.ts with their permitted substrates.",
    ).toEqual([]);

    const missing = [...declared].filter((n) => !inCss.has(n)).sort();
    expect(
      missing,
      "the manifest names glass token(s) the stylesheet does not declare — the table is " +
        "measuring something that does not ship",
    ).toEqual([]);
  });

  it.each(
    GLASS_SURFACES.flatMap((s) =>
      s.substrateTokens.flatMap((sub) =>
        (["light", "dark"] as const).map(
          (scope) => [`${scope} · ${s.id} · ${sub}`, sub, scope] as const,
        ),
      ),
    ),
  )("%s is opaque", (_label, sub, scope) => {
    // A translucent substrate makes the composite undefined — compositeOver throws on it, and
    // this assertion is what turns that throw into a named failure instead of a stack trace.
    const alpha = new Color(token(sub, scope)).alpha ?? 1;
    expect(alpha, `${sub} (${scope}) must be opaque to serve as a substrate`).toBe(1);
  });

  it.each(GLASS_SURFACES.map((s) => [s.id, s] as const))(
    "%s: the fallback is a designed colour, not the fill with its alpha stripped",
    (_id, s) => {
      // A fallback that is merely the fill at alpha 1 has not been designed for the degraded
      // case — it has been RENAMED for it, and it will not have been looked at.
      for (const scope of ["light", "dark"] as const) {
        const fill = new Color(token(s.fillToken, scope));
        const stripped = new Color(token(s.fillToken, scope));
        stripped.alpha = 1;
        const fallback = new Color(token(s.fallbackToken, scope));

        const delta = Math.abs((fallback.oklch?.[0] ?? 0) - (stripped.oklch?.[0] ?? 0));
        expect(
          delta,
          `${s.fallbackToken} (${scope}) is the same lightness as ${s.fillToken} with alpha ` +
            `stripped. The opaque case needs its own value, not a rename.`,
        ).toBeGreaterThan(0.001);
        expect(fill.alpha ?? 1, `${s.fillToken} must actually be translucent`).toBeLessThan(1);
        expect(fallback.alpha ?? 1, `${s.fallbackToken} must be opaque`).toBe(1);
      }
    },
  );

  it("every glass surface class declares its opaque background OUTSIDE any feature query", () => {
    // The single most important structural property in this plan. If the base declaration were
    // to move inside the feature query, the degraded path would silently become "no background
    // at all" and every one of the condition-one measurements above would be measuring a colour
    // that never renders.
    for (const s of GLASS_SURFACES) {
      const baseRule = new RegExp(
        `(^|\\})\\s*\\.${s.className}\\s*\\{[^}]*background-color:\\s*var\\(${s.fallbackToken}\\)`,
        "m",
      );
      expect(
        baseRule.test(CSS),
        `.${s.className} must declare background-color: var(${s.fallbackToken}) as a BASE rule. ` +
          `A fallback reachable only through a feature query is a fallback nobody renders and ` +
          `therefore nobody checks (D-34-04).`,
      ).toBe(true);
    }
  });

  it("no glass or depth token is authored at a fixed hue", () => {
    // D-UI-01: the whole system regenerates from ONE number. A glass fill that hard-codes white
    // is a value that stops following the brand the moment a tenant changes its hue.
    for (const name of DECLARED_GLASS_TOKENS) {
      if (name === "--glass-saturate" || name.endsWith("-blur")) continue; // not colours
      for (const scope of ["light", "dark"] as const) {
        const block = scope === "light" ? "root" : "dark";
        if (!tokenNames(block).includes(name)) continue;
        expect(
          rawToken(name, scope),
          `${name} (${scope}) must be authored against var(--brand-h)`,
        ).toContain("var(--brand-h)");
      }
    }
  });
});

describe("D-34-06 · depth is depth, not tint", () => {
  it.each(
    DEPTH_TOKENS.flatMap((name) =>
      (["light", "dark"] as const).map((scope) => [`${scope} · ${name}`, name, scope] as const),
    ),
  )("%s has chroma zero on every layer", (_label, name, scope) => {
    // Phase 20's elevation rule, restated for the new levels: a shadow that carries chroma
    // tints the surface it falls on, and the tint compounds across stacked layers.
    const value = token(name, scope);
    const colours = value.match(/oklch\([^)]*\)/g) ?? [];
    expect(colours.length, `${name} should declare at least one shadow colour`).toBeGreaterThan(0);
    for (const colour of colours) {
      const parts = colour
        .replace(/oklch\(|\)/g, "")
        .split("/")[0]!
        .trim()
        .split(/\s+/);
      expect(Number(parts[1]), `${name} (${scope}): layer "${colour}" carries chroma`).toBe(0);
    }
  });

  it.each(DEPTH_TOKENS.map((n) => [n, n] as const))(
    "%s keeps identical geometry across themes, differing only in alpha",
    (_label, name) => {
      // Dark deepens the alpha because a shadow alone is invisible on near-black — the same
      // rule --elev-* already follows. What must NOT differ is the geometry, or the two themes
      // drift into different depth languages one tweak at a time.
      const geometry = (scope: Scope) =>
        token(name, scope)
          .replace(/oklch\([^)]*\)/g, "«c»")
          .replace(/\s+/g, " ")
          .trim();
      expect(geometry("dark"), `${name}: dark geometry must match light`).toBe(geometry("light"));
    },
  );
});
