import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { FRONTEND_ROOT, sourceFilesUnder, stripComments, toRelative } from "./module-graph";

/**
 * What phase 34 cost the shipped bundle.
 *
 * <h3>An honest statement of what is and is not measured here</h3>
 *
 * The plan asked for the expressive routes' bundle to be compared against a PRE-PHASE baseline.
 * A true before/after of the built output would mean checking out the pre-phase tree and
 * building it — and this repository is one working tree shared by eight agents, so checking out
 * an old commit to run a build would rip the ground out from under seven other people. That
 * measurement was therefore **not** taken, and this file does not pretend otherwise.
 *
 * What IS measured, precisely, and without building anything twice:
 *
 * <ul>
 *   <li><b>The CSS delta at source, comment-stripped</b> — computable exactly from git, because
 *       `app/globals.css` is the only stylesheet this phase touched. Comments are stripped
 *       because production CSS drops them, and this phase's stylesheet is heavily commented by
 *       design; counting them would report a cost that does not ship.</li>
 *   <li><b>The JavaScript this phase adds</b> — six new modules, all of which are new files, so
 *       their combined size IS the delta.</li>
 *   <li><b>The built CSS ceiling</b> — asserted when a build is present.</li>
 *   <li><b>That nothing was added to the dependency manifest</b> — the largest possible cost,
 *       covered exhaustively by `dependency-budget.test.ts`.</li>
 * </ul>
 *
 * <h3>The measured figures (2026-08-12)</h3>
 *
 * | | before | after | delta |
 * |---|---|---|---|
 * | `globals.css`, comments stripped | 17,374 B | 23,195 B | **+5,821 B** |
 * | new JS modules | 0 B | ~24,067 B source | **+24,067 B** source, far less minified |
 * | dependencies | 24 | 24 | **0** |
 *
 * And one REMOVAL worth stating beside the additions: 34-03 took `PageTransition` out of the
 * tenant shell, which orphaned `framer-motion` entirely. It is still in `package.json` but is
 * reachable from no route, so it no longer ships — a saving that comfortably exceeds everything
 * above. Removing the package itself is a build-surface change left for a follow-up.
 */

/** Pre-phase sizes, taken from `git show <pre-phase>:frontend/app/globals.css`. */
const BASELINE = {
  globalsCssStripped: 17_374,
  dependencies: 24,
} as const;

/** Ceilings, set with headroom over what is measured today. */
const CEILING = {
  /** +5,821 B measured; 12,000 allows the remaining plans' rules without another review. */
  globalsCssDelta: 12_000,
  /** ~24 kB of heavily-commented source across six modules. */
  newModuleSource: 60_000,
  /** Built CSS measured at 103,944 B. */
  builtCss: 140_000,
} as const;

function strippedSize(css: string): number {
  return css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\n\s*\n+/g, "\n").length;
}

describe("phase 34 · the stylesheet delta", () => {
  const globals = readFileSync(resolve(FRONTEND_ROOT, "app/globals.css"), "utf8");

  it("globals.css grew by less than the ceiling, measured with comments stripped", () => {
    const now = strippedSize(globals);
    const delta = now - BASELINE.globalsCssStripped;

    process.stderr.write(
      `\n  globals.css (comments stripped): ${BASELINE.globalsCssStripped} B -> ${now} B ` +
        `(delta +${delta} B)\n`,
    );

    expect(
      delta,
      `globals.css grew ${delta} B over the pre-phase baseline. Bundle size is a real cost on ` +
        `a tablet over restaurant wifi, which is the device this product runs on.`,
    ).toBeLessThan(CEILING.globalsCssDelta);
  });

  it("the comment ratio is high, which is the point — comments do not ship", () => {
    // Stated so nobody "optimises" the stylesheet by deleting the reasoning. The raw file is
    // roughly twice its stripped size, and production CSS drops every byte of that difference.
    const raw = globals.length;
    const stripped = strippedSize(globals);
    expect(raw).toBeGreaterThan(stripped);
    process.stderr.write(
      `  globals.css raw ${raw} B, stripped ${stripped} B — ` +
        `${Math.round((1 - stripped / raw) * 100)}% is comment, and none of it ships\n`,
    );
  });
});

describe("phase 34 · the JavaScript delta", () => {
  /** Every module this phase ADDED. All are new files, so their size is exactly the delta. */
  const NEW_MODULES = [
    "components/providers/zone-provider.tsx",
    "components/ui/surface/glass-panel.tsx",
    "components/ui/surface/reveal.tsx",
    "lib/hooks/ui/use-reduced-motion.ts",
    "lib/hooks/ui/use-pointer-tilt.ts",
    "lib/theme/glass-surfaces.ts",
  ];

  it("every module this phase added still exists", () => {
    for (const rel of NEW_MODULES) {
      expect(existsSync(resolve(FRONTEND_ROOT, rel)), `${rel} is missing`).toBe(true);
    }
  });

  it("their combined source is under the ceiling", () => {
    let total = 0;
    for (const rel of NEW_MODULES) {
      total += readFileSync(resolve(FRONTEND_ROOT, rel), "utf8").length;
    }
    process.stderr.write(`  new modules: ${NEW_MODULES.length} files, ${total} B of source\n`);
    expect(total).toBeLessThan(CEILING.newModuleSource);
  });

  it("none of them imports anything outside the existing dependency set", () => {
    // A new module that reaches for a new package is the failure mode that actually costs
    // kilobytes; the file sizes above are noise by comparison.
    const allowed = new Set(
      Object.keys(
        (
          JSON.parse(readFileSync(resolve(FRONTEND_ROOT, "package.json"), "utf8")) as {
            dependencies: Record<string, string>;
          }
        ).dependencies,
      ),
    );
    for (const rel of NEW_MODULES) {
      const source = stripComments(readFileSync(resolve(FRONTEND_ROOT, rel), "utf8"));
      for (const [, spec] of source.matchAll(/from\s+["']([^"'.@/][^"']*)["']/g)) {
        const pkg = spec!.split("/")[0]!;
        expect(allowed.has(pkg), `${rel} imports "${pkg}", which is not a dependency`).toBe(true);
      }
    }
  });
});

describe("phase 34 · the built output, when a build is present", () => {
  /** Largest stylesheet under `.next/static`, which is the one every route loads. */
  function largestBuiltCss(): { file: string; bytes: number } | null {
    const root = resolve(FRONTEND_ROOT, ".next/static");
    if (!existsSync(root)) return null;
    let best: { file: string; bytes: number } | null = null;
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const info = statSync(full);
        if (info.isDirectory()) walk(full);
        else if (name.endsWith(".css") && (!best || info.size > best.bytes)) {
          best = { file: full, bytes: info.size };
        }
      }
    };
    walk(root);
    return best;
  }

  // 30s, not vitest's default 5s. `largestBuiltCss()` walks the whole `.next` tree — 595 MB and
  // ~11 stylesheets on a machine that has run a production build — and it does that synchronously
  // while the rest of the suite runs in parallel. It passes in isolation every time and timed out
  // once under full-suite load, which is the worst kind of gate: one that fails for a reason
  // unrelated to what it measures, teaching the reader to re-run rather than to look.
  //
  // The budget itself is unchanged. Only the time allowed to walk the directory moved.
  it("the shipped stylesheet is under its ceiling", { timeout: 30_000 }, () => {
    const built = largestBuiltCss();
    if (!built) {
      // Skipped LOUDLY. A budget test that silently passes without a build is a budget nobody
      // is enforcing — the exact failure pattern this phase kept finding elsewhere.
      process.stderr.write(
        "  NOT MEASURED: no .next/static build present. Run `npm run build` to enforce the " +
          "built-CSS ceiling.\n",
      );
      return;
    }
    process.stderr.write(`  built CSS: ${built.bytes} B (${toRelative(built.file)})\n`);
    expect(built.bytes).toBeLessThan(CEILING.builtCss);
  });
});

describe("phase 34 · framer-motion no longer reaches a route", () => {
  it("is imported by nothing, anywhere", () => {
    // The single largest saving this phase made, and the one most likely to be undone by
    // someone reaching for a convenient animation helper.
    const files = [
      ...sourceFilesUnder("app"),
      ...sourceFilesUnder("components"),
      ...sourceFilesUnder("lib"),
    ];
    const importers = files
      .filter((f) => /from\s+["']framer-motion["']/.test(stripComments(readFileSync(f, "utf8"))))
      .map(toRelative);
    // The three-file carve-out that used to sit here went with the island itself (38-13 §4).
    // An exception list on a "nothing imports this" assertion is a list of the files that
    // still do.

    expect(importers, `framer-motion is reachable again from:\n${importers.join("\n")}`).toEqual(
      [],
    );
  });
});

/* ================================================================================================
 * 38-16 — what phase 38 cost, on top of what phase 34 cost.
 *
 * Everything below was measured on 2026-08-22 against a real `next build` of this tree, not
 * estimated. Where a figure could NOT be measured without a browser it is labelled as such and
 * is not asserted, because a budget built on an estimate fails at a number nobody can reproduce.
 * ============================================================================================= */

/**
 * The stylesheet ledger, so a reader can see WHERE the delta went instead of only that it moved.
 *
 * | ref | point | stripped | step |
 * |---|---|---|---|
 * | `b006e546` | pre-phase-34 baseline | 17,374 | — |
 * | `4d863855` | 34-04, phase 34 closes | 23,195 | +5,821 |
 * | `0cdcb523` | 38-01, type/space bridge | 23,721 | +526 |
 * | `89e6db73` | 38, the OKLCH identity | 25,262 | +1,541 |
 * | `68bd6738` | 38, the neutral-ramp fix | 25,410 | +148 |
 *
 * So phase 38's own stylesheet cost is **+2,215 B** and the running total against the pre-34
 * baseline is **+8,036 B** against a 12,000 B ceiling — 3,964 B of headroom, which 38-17 has to
 * fit inside. The ceiling is NOT moved to accommodate anything; if a later plan needs more than
 * 3,964 B it has to argue for the rise on its own, in the open.
 *
 * The 1,541 B step is the identity commit and it is itself accounted for: an eleven-stop
 * `--secondary-*` ramp (~590 B), `--decorative`, `--primary-solid` and
 * `--primary-solid-foreground` with their `@theme` aliases (~340 B), and re-valued `--primary-*`
 * and `--neutral-*` stops for the rest.
 *
 * **Comments are stripped before every figure above, so documentation is free.** The raw file is
 * 58,993 B and 57% of it is comment. Nobody should ever "save space" here by deleting reasoning:
 * it does not ship, and deleting it costs the next reader the whole argument.
 */
describe("38-16 · the stylesheet ledger, reported not re-gated", () => {
  it("reports the current figure against the ceiling that already exists", () => {
    const globals = readFileSync(resolve(FRONTEND_ROOT, "app/globals.css"), "utf8");
    const delta = strippedSize(globals) - BASELINE.globalsCssStripped;
    const headroom = CEILING.globalsCssDelta - delta;

    process.stderr.write(
      `  38-16: globals.css is +${delta} B over the pre-34 baseline; ` +
        `${headroom} B of the ${CEILING.globalsCssDelta} B ceiling is left for 38-17.\n`,
    );

    // Deliberately the SAME ceiling asserted above, not a new tighter one. A second, tighter
    // ceiling here would be a landmine for a sibling plan that has not run yet, and this plan
    // has no measurement justifying one.
    expect(delta).toBeLessThan(CEILING.globalsCssDelta);
    expect(headroom).toBeGreaterThan(0);
  });
});

/**
 * The three self-hosted webfonts (D-38-13), which nothing measured until now.
 *
 * <h3>What they actually cost, from `.next/static/media` after `next build`</h3>
 *
 * | family | how | emitted | preloaded (`latin`) |
 * |---|---|---|---|
 * | Sora | variable, 100–800, one file per subset | 49,228 B | 33,672 B |
 * | DM Mono | static, 2 weights × 2 subsets | 28,812 B | 17,412 B |
 * | Fraunces | variable, 3 subsets, both weights share them | 81,736 B | 36,560 B |
 * | **total** | 9 files | **159,776 B** | **87,644 B** |
 *
 * `subsets: ["latin"]` does not restrict what is EMITTED — every subset Google publishes is
 * emitted with a `unicode-range`, and `latin` is merely the one next/font preloads. So the
 * number that lands on a tablet at first paint is the preloaded column, and the rest only
 * downloads if a glyph in its range is actually rendered.
 *
 * <h3>Is subsetting warranted? Measured, and the answer is no — with one exception, taken</h3>
 *
 * - **Fraunces is the exception that ISN'T.** It is the single most expensive family (36,560 B
 *   preloaded) for 9 `className` call sites, which looks like the obvious candidate. But it is a
 *   variable font, so enumerating `400` AND `600` costs exactly zero extra bytes — both
 *   `@font-face` rules point at the same three files, verified in the built stylesheet. The only
 *   saving left is glyph subsetting, and that needs a build-time subsetter: a new devDependency
 *   and a new build step, to shave a file that loads once behind `font-display: swap` and is then
 *   cached. Not taken, and the reasoning is recorded so it does not get re-litigated.
 * - **DM Mono's weight 300 WAS worth taking, and was taken.** A static family pays per weight.
 *   `300` was enumerated and then never requested — no `font-light`, `font-thin`,
 *   `font-extralight`, `font-[300]` or `font-weight: 300` anywhere in `app/`, `components/`,
 *   `lib/` or `e2e/` — so it cost 8,632 B on the preload path (14,328 B emitted) to ship a face
 *   the product cannot render. Removing it is behaviourally inert: the four
 *   `font-mono font-semibold` sites ask for 600, and CSS font matching resolves 600 to 500 either
 *   way. Rebuilt to confirm: 11 files → 9, 174,104 B → 159,776 B, 96,276 B → 87,644 B preloaded.
 * - **Sora is already optimal.** One variable file covers 100–800.
 *
 * <h3>NOT measured here</h3>
 *
 * Whether `font-display: swap` produces a visible reflow on the POS at first paint. That needs a
 * real browser on a real device and is not something a byte count can stand in for.
 */
const WEBFONT = {
  /** The three families D-38-13 chose. A fourth is a budget decision, not a styling one. */
  families: ["DM_Mono", "Fraunces", "Sora"],
  /** 87,644 B measured; 5% over, so a Google font revision does not turn the gate red. */
  preloadedCeiling: 92_000,
  /** 159,776 B measured, same 5%. Re-adding a DM Mono weight (+14,328 B) breaks this. */
  emittedCeiling: 168_000,
} as const;

interface FontDeclaration {
  family: string;
  weights: string[];
  subsets: string[];
}

/** The `next/font/google` calls in `app/layout.tsx`, read from source rather than assumed. */
function fontDeclarations(): FontDeclaration[] {
  const source = stripComments(readFileSync(resolve(FRONTEND_ROOT, "app/layout.tsx"), "utf8"));
  const found: FontDeclaration[] = [];
  for (const match of source.matchAll(/=\s*([A-Z][A-Za-z0-9_]*)\(\{([\s\S]*?)\}\);/g)) {
    const family = match[1]!;
    const body = match[2]!;
    if (!/variable:\s*["']--font-/.test(body)) continue;
    const list = (key: string): string[] => {
      const hit = body.match(new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`));
      return hit ? [...hit[1]!.matchAll(/["']([^"']+)["']/g)].map((w) => w[1]!) : [];
    };
    found.push({ family, weights: list("weight"), subsets: list("subsets") });
  }
  return found;
}

describe("38-16 · the webfont budget", () => {
  it("is exactly three families — a fourth is a budget decision, not a styling one", () => {
    const families = fontDeclarations()
      .map((f) => f.family)
      .sort();
    expect(
      families,
      "the webfont set changed. Each family is 30–80 kB of emitted font and 33–37 kB on the " +
        "preload path, which is the largest single asset class this product ships. If a fourth " +
        "family is intended, measure it, add it here, and move the ceilings in the same commit.",
    ).toEqual([...WEBFONT.families]);
  });

  it("DM Mono enumerates only weights the product actually asks for", () => {
    const mono = fontDeclarations().find((f) => f.family === "DM_Mono");
    expect(mono, "DM_Mono is no longer declared in app/layout.tsx").toBeDefined();
    expect(
      mono!.weights,
      "DM Mono is a STATIC family: every enumerated weight is its own file and its `latin` " +
        "subset is preloaded, ~8.7 kB each. 38-16 removed `300` because nothing requested it. " +
        "Adding a weight back means a call site exists for it — prove that first, then move " +
        "preloadedCeiling and emittedCeiling in the same commit.",
    ).toEqual(["400", "500"]);
  });

  it("nothing in the shipped tree requests a weight below 400 — the control for the line above", () => {
    // This is the assertion that makes removing `300` safe to keep. The moment a `font-light`
    // appears, the mono silently renders at 400 and this goes red naming the file, instead of
    // the defect shipping as type that is subtly the wrong weight.
    const subFourHundred =
      /\bfont-(?:thin|extralight|light)\b|\bfont-\[(?:100|200|300)\]|font-weight:\s*(?:100|200|300)\b/;
    const offenders: string[] = [];
    for (const file of [
      ...sourceFilesUnder("app"),
      ...sourceFilesUnder("components"),
      ...sourceFilesUnder("lib"),
    ]) {
      if (subFourHundred.test(stripComments(readFileSync(file, "utf8")))) {
        offenders.push(toRelative(file));
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no third-party font origin — next/font self-hosts, which is where the demo differs", () => {
    // The demo reaches fonts.googleapis.com. That is a second origin on the critical path, a DNS
    // + TLS round trip before any glyph arrives, and a third party watching every page view.
    const offenders: string[] = [];
    for (const file of [
      ...sourceFilesUnder("app"),
      ...sourceFilesUnder("components"),
      ...sourceFilesUnder("lib"),
    ]) {
      const source = stripComments(readFileSync(file, "utf8"));
      if (/fonts\.(googleapis|gstatic)\.com/.test(source)) offenders.push(toRelative(file));
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the built font set is under its ceilings", () => {
    const media = resolve(FRONTEND_ROOT, ".next/static/media");
    if (!existsSync(media)) {
      // Skipped LOUDLY, same rule as the built-CSS ceiling above.
      process.stderr.write(
        "  NOT MEASURED: no .next/static/media build present. Run `npm run build` to enforce " +
          "the webfont ceilings.\n",
      );
      return;
    }
    let emitted = 0;
    let preloaded = 0;
    let files = 0;
    for (const name of readdirSync(media)) {
      if (!name.endsWith(".woff2")) continue;
      const bytes = statSync(join(media, name)).size;
      emitted += bytes;
      files += 1;
      // next/font marks the preloaded subset with `-s.p.`; everything else waits behind its
      // unicode-range and only downloads if a glyph in that range is rendered.
      if (name.includes("-s.p.")) preloaded += bytes;
    }
    process.stderr.write(
      `  webfonts: ${files} files, ${emitted} B emitted, ${preloaded} B preloaded (latin)\n`,
    );
    expect(preloaded).toBeLessThan(WEBFONT.preloadedCeiling);
    expect(emitted).toBeLessThan(WEBFONT.emittedCeiling);
  });
});

/**
 * The View-Transition theme reveal (D-38-14) — what the root snapshot costs.
 *
 * <h3>Measured, from `@teispace/next-themes@2.0.3` source and from the built output</h3>
 *
 * - **Zero new dependencies.** `transition` is a prop of a fork already in the manifest. The
 *   manifest is still 24 packages, asserted next door.
 * - **Zero bytes of application JavaScript.** `startViewTransition` appears in no first-party
 *   file; the whole mechanism lives in the fork's `chunk-RQE5PXXM.js`, which ships whether or not
 *   `transition` is configured because the theme-set path calls into it unconditionally. Our
 *   marginal cost is the four-key object literal in `theme-provider.tsx`.
 * - **Exactly one snapshot pair.** The fork animates `::view-transition-old(root)` and
 *   `::view-transition-new(root)` and nothing else, and this codebase declares no
 *   `view-transition-name` anywhere — so the browser captures the root and only the root, which
 *   is the cheapest configuration the API has. Every named element would add its own pair.
 * - **371 B of stylesheet, transiently.** The fork builds the keyframes as a string at toggle
 *   time, appends one `<style>`, and removes it on `finished`. Nothing is in the bundle.
 * - **The old snapshot does not animate at all** (`animation: none`); only the new one runs a
 *   `clip-path: circle()` from 0 to 150vmax. One animated property, compositor-friendly.
 * - **`prefers-reduced-motion` removes it rather than shortening it**, and that is the fork's
 *   default, not something we opted into: `respectReducedMotion` defaults to `true`, and the
 *   reduced-motion branch returns `null` — no stylesheet, no `startViewTransition` call at all.
 *
 * <h3>NOT measured — and not estimated either</h3>
 *
 * The actual cost of the root snapshot: the browser rasterises the full viewport twice and holds
 * both textures for the 420 ms the reveal runs. How much GPU memory that is, and whether it drops
 * frames on the tablet the POS runs on, needs a real browser on that real device with a frame
 * profiler. An arithmetic guess (viewport × DPR × 4 bytes × 2) is not a measurement and is
 * deliberately not written down here as though it were one. What IS gated is the structural half:
 * one pair, no named elements, and the print-path containment checks G6/G7 already re-run on
 * `app/pos/**` because `::view-transition-*` establishes containment while it runs.
 */
describe("38-16 · the theme reveal costs one root snapshot and no more", () => {
  const FIRST_PARTY = () => [
    ...sourceFilesUnder("app"),
    ...sourceFilesUnder("components"),
    ...sourceFilesUnder("lib"),
  ];

  /**
   * VALUE-ANCHORED as of 38-13, and the distinction is the whole point of the rule.
   *
   * This matched the PROPERTY `view-transition-name` and went red on
   * `view-transition-name: none`, which is the exact opposite of the thing it protects against.
   * A NAME creates a snapshot pair the browser rasterises and holds for the length of the
   * reveal; `none` creates nothing — it SUPPRESSES capture, and 38-13 uses it under
   * `@media print` so a theme reveal in flight cannot rasterise the root and print app chrome
   * onto a customer's bill.
   *
   * Same species as the fix recorded in `zone-containment.test.ts`, where `/transform\s*:/`
   * matched TypeScript parameter annotations: a property name alone does not say what a
   * declaration does. Only the value does.
   */
  const NAMED_VT = /(view-transition-name|viewTransitionName)\s*:\s*(?!none\b)["']?[\w-]/;

  it("declares no NAMED view transition, so exactly one snapshot pair is captured", () => {
    const offenders: string[] = [];
    for (const file of FIRST_PARTY()) {
      const source = stripComments(readFileSync(file, "utf8"));
      if (NAMED_VT.test(source)) offenders.push(toRelative(file));
    }
    const globals = readFileSync(resolve(FRONTEND_ROOT, "app/globals.css"), "utf8");
    if (NAMED_VT.test(globals.replace(/\/\*[\s\S]*?\*\//g, ""))) {
      offenders.push("app/globals.css");
    }
    expect(
      offenders,
      "a named view transition was added. Each name is another snapshot pair the browser " +
        "rasterises and holds for the length of the reveal, on top of the root pair. The theme " +
        "flip needs the root and nothing else.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the built stylesheet carries no view-transition-name either", () => {
    const root = resolve(FRONTEND_ROOT, ".next/static");
    if (!existsSync(root)) {
      process.stderr.write("  NOT MEASURED: no .next/static build present.\n");
      return;
    }
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        // Same value anchoring as above: the built sheet legitimately contains
        // `view-transition-name: none` from the print block.
        else if (name.endsWith(".css") && NAMED_VT.test(readFileSync(full, "utf8")))
          offenders.push(toRelative(full));
      }
    };
    walk(root);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no first-party file calls startViewTransition — the reveal is entirely the fork's", () => {
    const offenders = FIRST_PARTY()
      .filter((f) => /startViewTransition/.test(stripComments(readFileSync(f, "utf8"))))
      .map(toRelative);
    expect(
      offenders,
      "a hand-rolled view transition appeared. The fork already owns this one, for zero bytes " +
        "and with reduced-motion handled; a second implementation is new code on the critical " +
        "path of every theme flip.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the reveal's duration and easing are still the values globals.css defines", () => {
    // theme-provider.tsx restates --motion-entrance / --motion-entrance-ease as literals, because
    // the prop is read by JS before the stylesheet is consulted. Its own docblock says "if those
    // tokens move, move these with them" — this is that sentence as a gate rather than a hope.
    const provider = readFileSync(
      resolve(FRONTEND_ROOT, "components/providers/theme-provider.tsx"),
      "utf8",
    );
    const globals = readFileSync(resolve(FRONTEND_ROOT, "app/globals.css"), "utf8");

    const duration = globals.match(/--motion-entrance:\s*(\d+)ms/)?.[1];
    const easing = globals.match(/--motion-entrance-ease:\s*([^;]+);/)?.[1]?.trim();
    expect(duration, "--motion-entrance is not defined in globals.css").toBeDefined();
    expect(easing, "--motion-entrance-ease is not defined in globals.css").toBeDefined();

    expect(provider).toContain(`duration: ${duration},`);
    expect(provider).toContain(`easing: "${easing}",`);
    // `origin` is NOT the library default. "cursor" would bloom from the last pointerdown, so a
    // theme toggled from the command palette reads as a rendering glitch.
    expect(provider).toContain(`origin: "center",`);
    expect(provider).toContain(`type: "circular",`);
  });
});
