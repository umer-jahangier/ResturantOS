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

/**
 * D-38-04 / UI-SPEC §7.2 — the bump-collapse exception, and its FENCE.
 *
 * <h3>The adjudication (38-13, conflict 2)</h3>
 *
 * The 400 ms collapse on `kds-item-column.tsx` is a SANCTIONED §7.2 EXCEPTION, not a gate hole.
 * It runs only in the window after the cook themself pressed `F`, and it is the only signal that
 * an OPTIMISTIC bump landed — the mutation is still in flight and the card is still in the DOM,
 * so without it a successful bump and a dead keypress are the same picture. That is feedback,
 * which §7.2 permits, and it is the opposite of the ambient motion the operational zone forbids:
 * nothing starts it but a human hand.
 *
 * <h3>Two corrections to the record, found while adjudicating it</h3>
 *
 * <b>1. It never turned the "0 running animations" gate red.</b> That gate
 * (`reduced-motion.spec.ts`) filtered on `getComputedStyle(el).animationName`, and a CSS
 * TRANSITION has no animation-name — only `@keyframes` do. So the collapse was invisible to it
 * in both directions, before and after 38-05 touched it. The premise that this exception was
 * costing 400 ms of red was wrong; the gate simply could not see transitions at all, which is a
 * larger hole than the one it was accused of having. Fixed there by measuring `getAnimations()`,
 * which returns `CSSTransition` objects too.
 *
 * <b>2. The mechanism the source comment claimed did not exist.</b> `kds-item-column.tsx` said
 * the card "carries `data-collapsing="true"` for the whole window, so a gate that samples
 * mid-bump excludes it by SELECTOR rather than by hoping to sample at rest." The attribute was
 * real; no gate anywhere referenced it. A fence described in a comment and absent from every
 * test is the thing the comment was written to prevent. It exists now — in the e2e sweep by
 * selector, and here by source.
 *
 * <h3>Why this half is a source scan</h3>
 *
 * Same reason as the `animate-pulse` scan above: the state only exists for 400 ms after an
 * input, so a render-time probe can only see it if it wins a race. The class list is the fact.
 */
describe("D-38-04 · the KDS bump-collapse exception cannot quietly grow", () => {
  const files = sourceFiles(KDS_DIR);

  /** Class-string content only — prose that merely names a class is not a class. */
  function classStrings(source: string): string[] {
    const out: string[] = [];
    for (const literal of stripComments(source).matchAll(/["'`]([^"'`\n]*)["'`]/g)) {
      if (/(^|[\s:])(transition|duration|animate)-/.test(literal[1]!)) out.push(literal[1]!);
    }
    return out;
  }

  it("`transition-all` appears in no class string under components/kds", () => {
    /*
     * `all` transitions every animatable property, so the day someone adds a `transform` or a
     * `filter` to a collapsing card the exception silently widens into exactly the compositing
     * motion D-38-04 forbids — and the gate would be arguing about a property nobody chose to
     * animate. Naming the property is what shuts that door.
     */
    const offenders: string[] = [];
    for (const file of files) {
      classStrings(readFileSync(file, "utf8"))
        .filter((c) => /(^|[\s:])transition-all\b/.test(c))
        .forEach((c) => offenders.push(`${relative(FRONTEND_ROOT, file)} — ${c}`));
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("every transition in the operational tree names a NON-COMPOSITING property", () => {
    // opacity and colour are paint-only. transform/filter/size/geometry are not, and on a wall
    // display read at two metres they are the difference between feedback and performance.
    const ALLOWED = new Set(["transition-opacity", "transition-colors"]);
    const offenders: string[] = [];
    for (const file of files) {
      for (const cls of classStrings(readFileSync(file, "utf8"))) {
        for (const token of cls.split(/\s+/)) {
          const bare = token.replace(/^.*:/, "");
          if (/^transition-/.test(bare) && !ALLOWED.has(bare)) {
            offenders.push(`${relative(FRONTEND_ROOT, file)} — ${token}`);
          }
        }
      }
    }
    expect(
      offenders,
      "A transition on a compositing property in the operational zone. §7.2 permits ONE " +
        "exception — the bump collapse — and it is an opacity fade.\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the collapse is the only motion-safe transition, and it is opacity", () => {
    const hits: string[] = [];
    for (const file of files) {
      classStrings(readFileSync(file, "utf8"))
        .filter((c) => /motion-safe:transition-/.test(c))
        .forEach((c) => hits.push(`${relative(FRONTEND_ROOT, file)} — ${c}`));
    }
    expect(hits.length, `expected exactly one, found:\n${hits.join("\n")}`).toBe(1);
    expect(hits[0]).toContain("components/kds/kds-item-column.tsx");
    expect(hits[0]).toContain("motion-safe:transition-opacity");
    // A cook who asked their OS for reduced motion gets no transition at all — the card is
    // simply `hidden`, which is a resting state rather than an animated one.
    expect(hits[0], "the reduced-motion branch must remove it, not shorten it").toContain(
      "motion-reduce:hidden",
    );
  });

  it("the collapsing card is selector-addressable, so a runtime gate can exclude it", () => {
    /*
     * THE fence. Without this attribute a browser sweep has to distinguish sanctioned feedback
     * from ambient decoration by sampling at the right moment, which it cannot do reliably — so
     * it would either flake or be written to ignore transitions entirely, which is what
     * `reduced-motion.spec.ts` did.
     *
     * With it, the rule is mechanical: at rest no such element exists and the count is 0
     * unconditionally; mid-bump exactly the sanctioned element is excluded, BY NAME.
     */
    const source = readFileSync(join(KDS_DIR, "kds-item-column.tsx"), "utf8");
    expect(source).toMatch(/data-collapsing=\{isCollapsing \? "true" : undefined\}/);
    // `undefined` and not `"false"`: the attribute must be ABSENT at rest, so `[data-collapsing]`
    // selects the collapsing cards and nothing else.
    expect(source).not.toMatch(/data-collapsing=\{[^}]*"false"/);
  });
});
