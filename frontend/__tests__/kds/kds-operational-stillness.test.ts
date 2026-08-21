import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { FRONTEND_ROOT } from "../lib/theme/module-graph";

/**
 * D-38-04, on the boards: **depth cues only. No perpetual decorative motion.**
 *
 * <h3>The defect this locks shut</h3>
 *
 * Three KDS surfaces hand-rolled a pulsing loading placeholder — `expo-board.tsx`'s six check
 * cards, `kds-clear-stale.tsx`'s header chip and `kds-cleared-board.tsx`'s four rows — each
 * wrapping a `bg-white/10` block in Tailwind's `animate-pulse`. That is an infinite, unprompted
 * repaint on a wall-mounted screen a cook stares past all shift, in the one zone whose whole
 * definition is that it does not do that.
 *
 * `components/ui/skeleton.tsx` has existed for exactly this since 34-05: it reads the zone and
 * renders a FLAT `--muted` block on an operational surface, keeping the shimmer for the
 * back-office screens where the suggestion of progress is worth something.
 * `__tests__/components/state-character.test.tsx` already proves that component behaves. What it
 * cannot prove — and what actually failed here — is that the boards CALL it.
 *
 * <h3>Why a source scan and not a render</h3>
 *
 * The evidence run reported "0 running animations" on all three boards, and it was not wrong: the
 * probe waits ~5.5 s for loading to settle, and by then the pulsing element has unmounted. The
 * motion is real, it is simply gone before anything measures it — and on the board that never
 * loads (an offline pass, a stalled query) it never goes at all. A render-time assertion inherits
 * the same blind spot: it can only see the loading state it managed to reach. The class in the
 * source is the fact, so the source is what is read.
 *
 * <p>Comments are stripped before the scan, and a hit only counts inside a STRING LITERAL. The
 * three files above now carry docblocks NAMING `animate-pulse` as the thing they no longer do,
 * and a scanner that cannot tell a class list from prose would fail on its own tombstones —
 * which is a gate that gets deleted the first time it cries wolf.
 */

const KDS_DIR = resolve(FRONTEND_ROOT, "components/kds");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out.sort();
}

/**
 * Blank out every comment, preserving the line count so a report still names the real line.
 *
 * Line-start heuristics are not enough: this repo's block comments continue with bare prose
 * rather than a leading `*`, so `/* ... animate-pulse ... *\/` spanning four lines reads as three
 * violations to a scanner that only looks at the first character.
 */
function stripComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (block) =>
    block.replace(/[^\n]/g, " "),
  );
  return withoutBlocks
    .split("\n")
    .map((line) => (line.trim().startsWith("//") ? "" : line))
    .join("\n");
}

/**
 * A Tailwind class only ever reaches the DOM from inside a string literal, so that is the only
 * place a hit counts. Prose that merely names the class is not a class.
 */
function isClassString(line: string): boolean {
  return /["'`][^"'`]*animate-pulse/.test(line);
}

describe("D-38-04 — the KDS boards do not animate while they wait", () => {
  const files = sourceFiles(KDS_DIR);

  it("scans a non-trivial number of KDS sources (a scanner that reads nothing passes anything)", () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it("hand-rolls no `animate-pulse` placeholder anywhere under components/kds", () => {
    const offenders: string[] = [];
    for (const file of files) {
      stripComments(readFileSync(file, "utf8"))
        .split("\n")
        .forEach((line, i) => {
          if (isClassString(line)) {
            offenders.push(`${relative(FRONTEND_ROOT, file)}:${i + 1} — ${line.trim()}`);
          }
        });
    }
    expect(
      offenders,
      "perpetual decorative motion in the `operational` zone (D-38-04). Use " +
        "`components/ui/skeleton.tsx`, which is zone-aware and sits still on a kitchen screen:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it.each(["expo-board.tsx", "kds-clear-stale.tsx", "kds-cleared-board.tsx"])(
    "%s renders its loading state through the zone-aware <Skeleton>",
    (name) => {
      const source = readFileSync(join(KDS_DIR, name), "utf8");
      expect(source).toContain('from "@/components/ui/skeleton"');
      expect(source).toMatch(/<Skeleton\b/);
    },
  );
});
