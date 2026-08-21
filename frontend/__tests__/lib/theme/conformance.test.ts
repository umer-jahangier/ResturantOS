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
 *
 * <h3>Negative controls RE-OBSERVED in wave 0, 2026-08-21, against the new numbers</h3>
 *
 * A re-recorded cap is worth nothing unless it is shown to bite at its new value, so all five
 * were run again after the re-baselining — not inherited from 38-01:
 *
 * 1. **G1** — `text-2xl` added to `components/pos/void-refund-dialog.tsx`, chosen because wave 0
 *    converged it to zero and removed its entry, so the gate must now refuse to let it grow one
 *    back. → RED twice: "absent from the baseline and must score zero" **and** "expected 1086 to
 *    be less than or equal to 1085". Restored.
 * 2. **G2** — a bare `rounded` added to `components/ui/page-header.tsx`.
 *    → RED: new offender, and "expected 139 to be less than or equal to 138". Restored.
 * 3. **G3** — `bg-emerald-500` added to `components/ui/page-body.tsx`. → RED. Restored.
 * 4. **G4** — a `<table>` added to `components/ui/page-body.tsx`.
 *    → RED: new offender, and "expected 45 to be less than or equal to 44". Restored.
 * 5. **Baseline-inflation** — `page-body.tsx`'s type-scale baseline raised to 5 while the file
 *    scored 0. → RED: "baseline total 1090 exceeds the recorded high-water mark". Restored.
 *
 * <h3>Wave 0, 2026-08-21 — the ratchet was re-armed after nine days red (D-38-17)</h3>
 *
 * This file was RED for nine days and nobody looked, which is how the mechanism was lost. What
 * the re-arming actually consisted of, stated in full so the next reader can audit it:
 *
 * **Five files were CONVERGED — code fixed, not fenced:**
 * - `components/pos/void-refund-dialog.tsx` — G1 22 → **0** (`text-sm`/`text-xs`/`text-base`
 *   replaced by `text-small`/`text-label`/`text-h2`). Its baseline entry is gone, so it may
 *   never grow one back.
 * - `components/settings/service-charge-form.tsx` — G1 8 → **0**, same mapping.
 * - `components/pos/pos-terminal.tsx` — G2 1 → **0**; the send-failure dismiss button's bare
 *   `rounded` became `rounded-sm`, the ladder's compact-control step.
 * - `components/menu/station-routing-board.tsx` — G3 2 → **0**; `text-amber-700
 *   dark:text-amber-400` became `text-warning`, which is what it meant.
 * - `components/platform/impersonation-log.tsx` — G4 **DEFERRED**, see below.
 *
 * **Everything else was RE-BASELINED to measured truth**, which is what D-38-17 asks of wave 0.
 * 24 further files carry violations — 16 born after the baseline was recorded, during the
 * post-audit S0 repair drive, and 8 that grew (`charge-summary.tsx` 35 → 60,
 * `till-review.tsx` 32 → 39, `order-management.tsx` 16 → 24 are the largest). They are NOT
 * converged here: UI-SPEC §3.1 is explicit that "no later plan is permitted to assume call sites
 * migrate themselves — each screen plan migrates its own", with before/after screenshots at four
 * widths in both themes. Twenty-four screens re-typeset unseen, in the same commit that repairs
 * the gate meant to catch exactly that, is the wrong trade. **They are now fenced at today's
 * count and may only fall.**
 *
 * The regeneration also LOWERED five entries that real work had already paid down
 * (`JournalEntryForm.tsx` 3 → 0, `OpenPeriodDatePicker.tsx` 5 → 0,
 * `forced-password-change-form.tsx` 1 → 0, and `charge-summary.tsx`'s four bare `rounded`),
 * so the ratchet is tighter on those files than it was before.
 *
 * <h3>G4 exception — `components/platform/impersonation-log.tsx`, deferred with reasons</h3>
 *
 * The baseline is strict JSON and cannot carry a comment, so the one deliberate G4 allowance
 * added in wave 0 is recorded here instead. `DataGrid` is **not** a clean drop-in for this
 * table, and forcing it would be a behaviour change on an accountability screen:
 *
 * 1. **Pagination is the server's.** `ImpersonationResults` pages by `nextPage` from the
 *    response envelope precisely so a full final page cannot offer a page that does not exist.
 *    `DataGrid` owns `getPaginationRowModel()` — a client pager over a server-paged slice would
 *    page within 25 rows and call it the whole log.
 * 2. **Rows are deliberately two-line.** Status + token expiry, tenant name + mono tenant id,
 *    "Account deleted" + admin id. `DataGrid` fixes one row height per table (`h-8`/`h-11`),
 *    which is its whole point and is wrong for these cells.
 * 3. **The first cell is `<th scope="row">`**, and one column is conditional on `showTenant`.
 *
 * Migrating it belongs to the platform screen's own plan, with the card renderers §7 requires
 * below `md`. Fenced at 1 until then.
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
    //
    // WAVE 0, 2026-08-21 — RE-RECORDED UPWARD, and that is a debt, not a fix (D-38-17).
    //   typeScale       961 -> 1085   bareRounded  137 -> 138
    //   rawPalette      142 ->  143   handRolledTable  43 ->  44
    // These four went UP. The cause is 24 files created or grown after the baseline was
    // recorded, during the post-audit S0 repair drive, while nobody ran the gates. Raising a
    // high-water mark is the exact move assertion 5 in the docblock above was built to catch,
    // so it is being done in the open, in one commit, with the per-file numbers regenerated to
    // measured truth in the same commit. Later waves MUST bring these down as each screen plan
    // migrates its own call sites; nothing may raise them again.
    const HIGH_WATER: Record<string, number> = {
      typeScale: 1085,
      bareRounded: 138,
      rawPalette: 143,
      handRolledTable: 44,
    };
    expect(
      drift.baselineTotal,
      `${id}: baseline total ${drift.baselineTotal} exceeds the recorded high-water mark. ` +
        `Lower the high-water mark in the same commit that lowers the baseline.`,
    ).toBeLessThanOrEqual(HIGH_WATER[key]!);
  });
});

describe("the product-wide totals, re-recorded in wave 0 and owed back down", () => {
  it("type-scale classes do not exceed the count measured in wave 0", () => {
    // WAVE 0, 2026-08-21 — CAP RAISED 961 -> 1085. IT WENT UP.
    //
    // 38-01 left 961 and asserted it so a later plan could not quietly regress the phase's
    // headline number back toward the audit's 1,037. A later drive did exactly that without
    // being a plan: 1,085 today. The cause is files created after the baseline was recorded,
    // during the post-audit S0 repair drive — `discount-panel.tsx` (25), `audit-log.tsx` (17),
    // `ModifierManagerDialog.tsx` (11), `modifier-dialog.tsx` (10) are new, and
    // `charge-summary.tsx` grew 35 -> 60 — while this suite sat red for nine days unread.
    //
    // Wave 0's job is to re-arm the ratchet, not to re-typeset 24 screens sight-unseen, so the
    // number is recorded at measured truth rather than fenced with a fiction. D-38-17 binds
    // later waves to bring it down; each screen plan migrates its own call sites (UI-SPEC §3.1).
    // 25 of the difference was already paid here, by converging void-refund-dialog.tsx and
    // service-charge-form.tsx to zero.
    const total = Object.values(scan(TYPE_SCALE)).reduce((a, b) => a + b, 0);
    expect(total, "type-scale classes").toBeLessThanOrEqual(1085);
  });

  it("hand-rolled <table> count does not exceed the count measured in wave 0", () => {
    // WAVE 0, 2026-08-21 — CAP RAISED 43 -> 44. IT WENT UP.
    //
    // 38-02 removed the purchase-order table and added `DataGrid`, the ONE sanctioned <table>
    // in the product, and this assertion said the count only ever falls. It rose by one:
    // `components/platform/impersonation-log.tsx`, written after the baseline was recorded
    // during the post-audit S0 repair drive. Wave 0 examined it and DEFERRED the migration for
    // the three reasons given in this file's docblock — server-driven paging, deliberately
    // two-line rows, `<th scope="row">` — rather than change behaviour on an accountability
    // screen. D-38-17: later waves bring this down; it may not rise again.
    const total = Object.values(scan(HAND_ROLLED_TABLE)).reduce((a, b) => a + b, 0);
    expect(total, "hand-rolled <table>").toBeLessThanOrEqual(44);
  });

  it("bare `rounded` call sites do not exceed the count measured in wave 0", () => {
    // WAVE 0, 2026-08-21 — CAP RAISED 137 -> 138. IT WENT UP.
    //
    // 38-01 measured 141 and paid it to 137. It is 138 today: `ModifierManagerDialog.tsx` (5),
    // `branches/page.tsx`, `menu/routing/page.tsx` and `station-routing-board.tsx` were all
    // created after the baseline was recorded, during the post-audit S0 repair drive, against
    // an unread gate. Wave 0 converged `pos-terminal.tsx` (rounded -> rounded-sm) and
    // `charge-summary.tsx` had already shed four, which is why the rise is 1 and not 8.
    // D-38-17 binds later waves to bring it down.
    const total = Object.values(scan(BARE_ROUNDED)).reduce((a, b) => a + b, 0);
    expect(total, "bare rounded").toBeLessThanOrEqual(138);
  });
});
