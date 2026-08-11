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

  it("the shipped stylesheet is under its ceiling", () => {
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
  it("is imported by nothing outside the orphaned page-transition island", () => {
    // The single largest saving this phase made, and the one most likely to be undone by
    // someone reaching for a convenient animation helper.
    const files = [
      ...sourceFilesUnder("app"),
      ...sourceFilesUnder("components"),
      ...sourceFilesUnder("lib"),
    ];
    const importers = files
      .filter((f) => /from\s+["']framer-motion["']/.test(stripComments(readFileSync(f, "utf8"))))
      .map(toRelative)
      .filter(
        (f) => !f.startsWith("components/shared/page-transition") && f !== "lib/motion/variants.ts",
      );

    expect(importers, `framer-motion is reachable again from:\n${importers.join("\n")}`).toEqual(
      [],
    );
  });
});
