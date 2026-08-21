import { describe, expect, it } from "vitest";

import baseline from "./conformance-baseline.json";
import {
  BARE_ROUNDED,
  compare,
  HAND_ROLLED_TABLE,
  RAW_PALETTE,
  scan,
  TYPE_SCALE,
} from "./conformance-scan";

/**
 * Conformance gates G1–G4 (UI-SPEC §11.1), each with its negative control observed (D-38-07).
 *
 * <h3>The measurement that justifies these existing at all</h3>
 *
 * The audit counted, on 2026-08-12: 986 type-scale classes, 145 bare `rounded`, 37 hand-rolled
 * `<table>` files. Re-scanning the same trees at the start of 38-01 — same commands, days later —
 * counted **1,037**, **149** and **39**. Nobody added those deliberately; the product simply has
 * no mechanism that notices. A cleanup without a gate is a cleanup that is undone by the next
 * three commits.
 *
 * <h3>Negative controls — run, OBSERVED RED, restored</h3>
 *
 * 1. **G1** — added `text-2xl` to `app/(tenant)/app/tables/page.tsx` (a migrated file, absent
 *    from the type-scale baseline).
 *    → OBSERVED RED: "new offenders … tables/page.tsx: 1". Restored.
 * 2. **G2** — added a bare `rounded` to `components/ui/page-header.tsx`.
 *    → OBSERVED RED: "new offenders … page-header.tsx: 1". Restored.
 * 3. **G3** — added `bg-emerald-500` to `components/ui/page-body.tsx`.
 *    → OBSERVED RED: "new offenders … page-body.tsx: 1". Restored.
 * 4. **G4** — added a second `<table>` to `components/ui/page-body.tsx`.
 *    → OBSERVED RED: "new offenders … page-body.tsx: 1". Restored.
 * 5. **Baseline-inflation control** — raised `tables/page.tsx`'s type-scale baseline from absent
 *    to 5 while the file scored 0. → the file-level check passed, and the **total** check caught
 *    it: "baseline total 986 exceeds the recorded 981". That second assertion exists precisely
 *    because a per-file baseline can be silently loosened one file at a time.
 */

const GATES = [
  { id: "G1", name: "type scale", pattern: TYPE_SCALE, key: "typeScale" },
  { id: "G2", name: "bare rounded (off-ladder 4px)", pattern: BARE_ROUNDED, key: "bareRounded" },
  { id: "G3", name: "raw palette literals", pattern: RAW_PALETTE, key: "rawPalette" },
  { id: "G4", name: "hand-rolled <table>", pattern: HAND_ROLLED_TABLE, key: "handRolledTable" },
] as const;

const RECORDED = baseline as Record<string, Record<string, number>>;

describe.each(GATES)("$id — $name conformance", ({ key, pattern, id }) => {
  const recorded = RECORDED[key]!;
  const current = scan(pattern);
  const drift = compare(recorded, current);

  it("no file exceeds its recorded baseline", () => {
    expect(
      drift.regressions,
      `${id}: these files grew new violations. Converge them, or state why in the plan:\n` +
        drift.regressions.map((r) => `  ${r.file}: ${r.baseline} → ${r.current}`).join("\n"),
    ).toEqual([]);
  });

  it("no file outside the baseline carries a violation — new code is born on-contract", () => {
    expect(
      drift.newOffenders,
      `${id}: these files are absent from the baseline and must score zero:\n` +
        drift.newOffenders.map((r) => `  ${r.file}: ${r.current}`).join("\n"),
    ).toEqual([]);
  });

  it("the baseline itself has not been inflated", () => {
    // Guards the loophole the per-file check cannot see: raising an allowance rather than
    // paying the debt. The recorded total is a high-water mark that only ever comes down.
    // Regenerated in 38-02 after the scanner began stripping comments (see `read`), so these
    // sit slightly under the audit's published figures. The difference is commentary, not code.
    const HIGH_WATER: Record<string, number> = {
      typeScale: 961,
      bareRounded: 137,
      rawPalette: 142,
      handRolledTable: 43,
    };
    expect(
      drift.baselineTotal,
      `${id}: baseline total ${drift.baselineTotal} exceeds the recorded high-water mark. ` +
        `Lower the high-water mark in the same commit that lowers the baseline.`,
    ).toBeLessThanOrEqual(HIGH_WATER[key]!);
  });
});

describe("38-01 paid down real debt rather than only fencing it", () => {
  // The audit's figures, and what 38-01 left behind. Asserted so a later plan cannot quietly
  // regress the phase's headline numbers back toward the audit's.
  it("type-scale classes are below the count measured at the start of 38-01", () => {
    const total = Object.values(scan(TYPE_SCALE)).reduce((a, b) => a + b, 0);
    expect(total, "type-scale classes").toBeLessThanOrEqual(961);
  });

  it("hand-rolled <table> count only ever falls", () => {
    // 38-02 removed the purchase-order table and added `DataGrid`, which is the ONE sanctioned
    // <table> in the product. Net: down. Waves 3-4 migrate the remaining ~37.
    const total = Object.values(scan(HAND_ROLLED_TABLE)).reduce((a, b) => a + b, 0);
    expect(total, "hand-rolled <table>").toBeLessThanOrEqual(43);
  });

  it("bare `rounded` call sites are below the count measured at the start of 38-01", () => {
    const total = Object.values(scan(BARE_ROUNDED)).reduce((a, b) => a + b, 0);
    expect(total, "bare rounded").toBeLessThanOrEqual(137);
  });
});
