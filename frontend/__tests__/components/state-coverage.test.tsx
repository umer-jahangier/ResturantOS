import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CatalogItemCombobox } from "@/components/shared/catalog-item-combobox";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";

import { FRONTEND_ROOT } from "../lib/theme/module-graph";

/**
 * Plan 38-12's three unwritten unit gates: **error-path coverage**, **filtered-empty ≠ empty**,
 * and **the spinner law**.
 *
 * <h3>Why these are here and not argued from the source in a plan summary</h3>
 *
 * 34-05 shipped its two gates as prose — "distinguishability is currently argued from the code
 * rather than asserted by rendering both states and comparing" — and the phase after it had to
 * re-measure everything from scratch to find out whether the claim was still true. A property
 * nobody can re-check in one command is a property that decays silently, which is precisely how
 * GA-001 survived eleven screens for a whole phase.
 *
 * <p>`state-character.test.tsx` already proves the SHARED surfaces behave: an error is louder
 * than an empty state, a skeleton sits still on an operational zone, `QueryBoundary` checks error
 * before empty. What it cannot prove — and what actually failed, twice — is that the call sites
 * REACH those surfaces. Six dialogs owned a correct error component and never rendered it. So
 * three of the four assertions below read the shipped source rather than a render: the class or
 * the missing destructure is the fact, and a render can only ever see the state it managed to
 * reach.
 *
 * <h3>Negative controls — run, OBSERVED RED, restored (D-38-07)</h3>
 *
 * 0. **The control that changed the gate.** The first draft asked, per file, "mentions
 *    `isLoading` but not `error`?". Deleting `isError` from `StockCountDialog`'s
 *    `useIngredients()` and both of its call-site props → **STILL GREEN**, because the file
 *    contains a `toast.error` — at the time the validation guard, since re-graded to
 *    `toast.warning`; the mutation's `onError` toast satisfies it just as well. The gate would
 *    have shipped certifying the defect it was written for. Rewritten to classify each hook by reading its
 *    body and to judge each query SITE rather than each file. The controls below are against the
 *    rewritten version.
 * 1. Removed `isError` from `components/shared/uom-select.tsx`'s `useUoms()` destructure and its
 *    three uses. → RED: "handles a query's failure as well as its pending state" listed
 *    `components/shared/uom-select.tsx — useUoms()`. Restored.
 * 2. Reduced the same destructure to `const { data: uoms } = useUoms()`. → RED on the OTHER half:
 *    "a query read with NO flags at all is on a ratchet that only turns down" — the file is not
 *    on the recorded list and may not join it. Restored.
 * 3. Made `DataGrid`'s filtered-empty branch reuse `emptyTitle` / `emptyDescription`. → RED, two
 *    tests: "says something DIFFERENT" and "a filter that narrows to zero rows still reaches a
 *    state". Restored. (The plan's negative control 5 — the one 34-05 skipped.)
 * 4. Reverted `DataGrid` to `data.length === 0`. → RED: "a filter that narrows to zero rows still
 *    reaches a state" — neither state rendered and `getByText` found nothing. Restored.
 * 5. Added an `animate-pulse` div beside `components/pos/menu-grid.tsx`'s skeleton. → RED: "no
 *    hand-rolled `animate-pulse` placeholder under components/pos". Restored.
 * 6. Removed the `busy &&` guard from `components/kds/expo-board.tsx`'s spinner. → RED: "every
 *    remaining spinner is gated on something being in flight". Restored.
 * 7. Dropped `role="alert"` from `CatalogItemCombobox`'s failure notice. → RED, two tests:
 *    "differs by ROLE, by COPY and by AFFORDANCE" and the precedence one. Restored.
 */

// ─────────────────────────────────────────────────────────────────────────────────────────
// Shared source-scanning helpers
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Blank out every comment, preserving the line count so a report names the real line.
 *
 * Copied in shape from `__tests__/kds/kds-operational-stillness.test.ts`, and for its reason: the
 * files this scans now carry docblocks NAMING `animate-pulse` and `isError` as the things they no
 * longer get wrong, and a scanner that cannot tell prose from code fails on its own tombstones.
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

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out.sort();
}

const APP_TREES = ["app", "components"].map((d) => resolve(FRONTEND_ROOT, d));
const ALL_SOURCES = APP_TREES.flatMap(sourceFiles);

function rel(file: string): string {
  return relative(FRONTEND_ROOT, file);
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// Gate 1 — error-path coverage. Plan 38-12 verification row 1: baseline 18 → 0.
// ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * Queries and mutations are told apart by READING THE HOOK, not by guessing from its name.
 *
 * <h3>Why the obvious version of this gate is a false green</h3>
 *
 * The first draft asked, per FILE, "does it mention `isLoading` without mentioning `error`?".
 * Deleting `isError` from `StockCountDialog` and both of its call-site props left it GREEN,
 * because the file still contained a `toast.error` from a MUTATION's `onError` — a message about
 * a write, satisfying a check about a read. The gate would have
 * shipped, and it would have certified the exact defect it was written for.
 *
 * <p>The second problem is the opposite one: a strict per-query scan drowns in mutations.
 * `useCreateVendor().isPending` gates a Save button, and its failure belongs in `onError`, not in
 * a `role="alert"` box where a list would go. 163 of the 285 hooks in `lib/` are mutations, so a
 * scan that cannot tell them apart reports 76 offenders of which 12 are real — and a gate with a
 * 6:1 false-positive rate is a gate someone deletes.
 *
 * <p>So the classification is read from the hook's own body: `useMutation(` makes it a mutation,
 * `useQuery(`/`useInfiniteQuery(`/`useQueries(` makes it a query. That is a fact in the source,
 * it is re-derived on every run, and a hook that changes kind changes this gate's answer with it.
 */
function classifyHooks(): Map<string, "query" | "mutation"> {
  const kinds = new Map<string, "query" | "mutation">();
  for (const file of sourceFiles(resolve(FRONTEND_ROOT, "lib"))) {
    const source = stripComments(readFileSync(file, "utf8"));
    const decls = [...source.matchAll(/export\s+(?:function|const)\s+(use[A-Z]\w*)/g)];
    decls.forEach((decl, i) => {
      const from = decl.index! + decl[0].length;
      const to = i + 1 < decls.length ? decls[i + 1]!.index! : source.length;
      const body = source.slice(from, to);
      if (/\buseMutation\s*[<(]/.test(body)) kinds.set(decl[1]!, "mutation");
      else if (/\buse(?:Infinite)?Quer(?:y|ies)\s*[<(]/.test(body) && !kinds.has(decl[1]!)) {
        kinds.set(decl[1]!, "query");
      }
    });
  }
  return kinds;
}

/** `const { data, isLoading } = useThing(` */
const DESTRUCTURED_QUERY = /(?:const|let)\s*\{([^{}]*?)\}\s*=\s*(use[A-Z]\w*)\s*\(/gs;
/** `const q = useThing(` */
const NAMED_QUERY = /(?:const|let)\s+(\w+)\s*=\s*(use[A-Z]\w*)\s*\(/g;
const PENDING = /\b(?:isLoading|isPending)\b/;
const FAILURE = /\b(?:isError|error)\b/;

/**
 * The one file whose query failure is handled without naming `isError`, with the reason.
 *
 * <p>It is a real handler, not an oversight — `till-session-bar.tsx` renders *"Unavailable —
 * could not read this till's totals"* plus a retry, reached by `expectedCashPaisa === null &&
 * !reconPending`. The gate cannot see that shape and should not try to: a scanner that accepts
 * arbitrary derived booleans accepts everything.
 *
 * <p>An exemption must name a FILE and a reason. There is deliberately no way to exempt a
 * directory, and the cap below is what stops this list becoming the place the gate goes to die.
 */
const HANDLES_FAILURE_WITHOUT_NAMING_IT: Record<string, string> = {
  "components/pos/till-session-bar.tsx":
    "`useTillReconciliation` failure is rendered as 'Unavailable — could not read this till's totals' with a retry, reached via `expectedCashPaisa === null && !reconPending` rather than via `isError`.",
};

describe("38-12 · every screen that can wait can also fail", () => {
  const hookKinds = classifyHooks();

  it("scans a non-trivial number of sources (a scanner that reads nothing passes anything)", () => {
    expect(ALL_SOURCES.length).toBeGreaterThan(300);
    // If this collapses, `classifyHooks` has stopped parsing and every query below silently
    // stops being a query — the quietest way for this whole gate to become decorative.
    const queries = [...hookKinds.values()].filter((k) => k === "query").length;
    const mutations = [...hookKinds.values()].filter((k) => k === "mutation").length;
    expect(queries, "query hooks classified").toBeGreaterThan(80);
    expect(mutations, "mutation hooks classified").toBeGreaterThan(100);
  });

  it("handles a query's failure as well as its pending state", () => {
    const offenders: string[] = [];
    let considered = 0;

    for (const file of ALL_SOURCES) {
      const source = stripComments(readFileSync(file, "utf8"));
      const bad: string[] = [];

      for (const m of source.matchAll(DESTRUCTURED_QUERY)) {
        const [, body = "", hook = ""] = m;
        if (hookKinds.get(hook) !== "query" || !PENDING.test(body)) continue;
        considered += 1;
        if (!FAILURE.test(body)) bad.push(`${hook}()`);
      }

      for (const m of source.matchAll(NAMED_QUERY)) {
        const [, name = "", hook = ""] = m;
        if (hookKinds.get(hook) !== "query") continue;
        if (!new RegExp(`\\b${name}\\.(?:isLoading|isPending)\\b`).test(source)) continue;
        considered += 1;
        if (new RegExp(`\\b${name}\\.(?:isError|error)\\b`).test(source)) continue;
        // Passed WHOLE into a boundary, which owns the failure on the caller's behalf.
        if (new RegExp(`query=\\{[^}]*\\b${name}\\b`).test(source)) continue;
        bad.push(`${name} = ${hook}()`);
      }

      if (bad.length && !HANDLES_FAILURE_WITHOUT_NAMING_IT[rel(file)]) {
        offenders.push(`${rel(file)} — ${bad.join(", ")}`);
      }
    }

    // The scan must be looking at the population the plan measured. 77 query pending-reads
    // today; a refactor that drops this near zero has broken the regex, not the codebase.
    expect(considered, "query pending-reads examined").toBeGreaterThan(50);

    expect(
      offenders,
      "GA-001, bug shape 2: a QUERY's pending state read without its failure. `data ?? []` " +
        "turns the error into a zero-length array one line later and the screen tells the " +
        "reader their business has nothing in it while the service is down. Wrap it in " +
        "`QueryBoundary`, or destructure `isError` and render `QueryErrorNotice`:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  /**
   * The gate's other half, and the honest statement of its boundary.
   *
   * <h3>What the assertion above cannot see</h3>
   *
   * It answers "does a query whose PENDING state is read also handle failure?". The purest form
   * of bug shape 2 reads neither: `const { data: ingredients } = useIngredients()` — no
   * `isLoading`, no `isError`, and one line later `ingredients ?? []`. There are **35** of those,
   * in **26** files. Six of them are what this plan spent its afternoon on, including the three
   * purchasing lists that printed "Unknown vendor" on every row during an outage.
   *
   * <p>The remaining 29 are not all defects — a lookup map that degrades to a dash is sometimes
   * the right answer — and deciding one by one is a larger job than this plan owns. So they are
   * RECORDED rather than banned, on the same ratchet `__tests__/lib/theme/conformance.test.ts`
   * uses: the number may fall and may never rise, and a file that is not on the list may not
   * acquire one. That is a number the next phase inherits instead of a vibe.
   */
  const SILENT_QUERY_READS: Record<string, number> = {
    "app/(tenant)/app/finance/accounts/page.tsx": 1,
    "app/(tenant)/app/finance/periods/page.tsx": 1,
    "app/(tenant)/app/inventory/recipes/[menuItemId]/page.tsx": 4,
    "app/(tenant)/app/inventory/stock/page.tsx": 1,
    "components/finance/AccountCodeSelect.tsx": 1,
    "components/finance/ExpenseFormDialog.tsx": 1,
    "components/finance/GeneralLedger.tsx": 1,
    "components/finance/ProvisionPeriodDialog.tsx": 1,
    "components/inventory/CategoryFormDialog.tsx": 1,
    "components/inventory/IngredientFormDialog.tsx": 4,
    "components/inventory/OpeningBalanceDialog.tsx": 1,
    "components/inventory/RecipeFormDialog.tsx": 3,
    "components/inventory/StockCountDialog.tsx": 1,
    "components/inventory/StockTransferDialog.tsx": 1,
    "components/inventory/UomFormDialog.tsx": 1,
    "components/menu/MenuItemFormDialog.tsx": 1,
    "components/pos/charge-summary.tsx": 1,
    "components/pos/order-panel.tsx": 1,
    "components/pos/order-table-detail-drawer.tsx": 1,
    "components/pos/pos-terminal.tsx": 1,
    "components/pos/table-select-combobox.tsx": 1,
    "components/purchasing/ApPaymentDialog.tsx": 1,
    "components/purchasing/MockGrnReceivePanel.tsx": 1,
    "components/purchasing/PurchaseOrderFormDialog.tsx": 2,
    "components/purchasing/VendorInvoiceFormDialog.tsx": 1,
    "components/ui/command-palette.tsx": 1,
  };

  it("a query read with NO flags at all is on a ratchet that only turns down", () => {
    const current: Record<string, number> = {};
    for (const file of ALL_SOURCES) {
      const source = stripComments(readFileSync(file, "utf8"));
      let n = 0;
      for (const m of source.matchAll(DESTRUCTURED_QUERY)) {
        const [, body = "", hook = ""] = m;
        if (hookKinds.get(hook) !== "query") continue;
        if (PENDING.test(body) || FAILURE.test(body)) continue;
        n += 1;
      }
      if (n) current[rel(file)] = n;
    }

    const born = Object.keys(current).filter((f) => SILENT_QUERY_READS[f] === undefined);
    expect(
      born,
      "new code is born asking the failure question. These files read a query's `data` and " +
        "neither its pending state nor its failure — `data ?? []` will turn the next outage " +
        "into an empty list:\n" +
        born.join("\n"),
    ).toEqual([]);

    const regressions = Object.entries(current)
      .filter(([f, n]) => n > (SILENT_QUERY_READS[f] ?? 0))
      .map(([f, n]) => `  ${f}: ${SILENT_QUERY_READS[f]} → ${n}`);
    expect(regressions, `the ratchet only turns down:\n${regressions.join("\n")}`).toEqual([]);

    const total = Object.values(current).reduce((a, b) => a + b, 0);
    expect(total, "silent query reads product-wide").toBeLessThanOrEqual(35);
    // The recorded list must not be padded in the same commit that lowers the count.
    expect(
      Object.values(SILENT_QUERY_READS).reduce((a, b) => a + b, 0),
      "the recorded baseline itself has been inflated",
    ).toBeLessThanOrEqual(35);
  });

  it("the exemption list is not a place things quietly accumulate", () => {
    for (const [path, reason] of Object.entries(HANDLES_FAILURE_WITHOUT_NAMING_IT)) {
      const source = stripComments(readFileSync(resolve(FRONTEND_ROOT, path), "utf8"));
      expect(PENDING.test(source), `${path} no longer reads a pending flag — drop the entry`).toBe(
        true,
      );
      expect(reason.length, `${path} needs a reason, not a rubber stamp`).toBeGreaterThan(60);
    }
    expect(
      Object.keys(HANDLES_FAILURE_WITHOUT_NAMING_IT).length,
      "exemptions — if this is growing, the gate is being routed around rather than satisfied",
    ).toBeLessThanOrEqual(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Gate 2 — no perpetual motion on an operational surface. Plan 38-12 verification rows 5 and 6.
// ─────────────────────────────────────────────────────────────────────────────────────────

/** A Tailwind class only reaches the DOM from inside a string literal. Prose naming it is prose. */
function classHits(source: string, cls: string): number[] {
  const lines = stripComments(source).split("\n");
  const pattern = new RegExp(`["'\`][^"'\`]*${cls}`);
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (pattern.test(line)) hits.push(i + 1);
  });
  return hits;
}

/**
 * A spinner is a perpetual animation. It is permitted only while something is genuinely in
 * flight, because then it stops on its own and it is the only signal that a tap registered — it
 * is never a REGION's loading state, which is what a skeleton is for (UI-SPEC §25).
 *
 * <p>The two exemptions are the two spinners that cannot be gated on a line, and both are
 * bounded by their own mount:
 */
const UNGATED_SPINNER_OK: Record<string, string> = {
  "components/shared/branch-switch-overlay.tsx":
    "The whole component early-returns on `!isVisible`, so the spinner cannot render outside a switch in progress.",
  "components/ui/sonner.tsx":
    "sonner's `loading:` icon slot. Rendered only for a `toast.loading`, which resolves or rejects.",
};

const IN_FLIGHT = /isPending|isLoading|isFetching|isRefetching|busy|replaying|IN_FLIGHT|\?|&&/;

describe("38-12 · no perpetual motion reaches an operational surface (D-38-04)", () => {
  it.each(["components/pos", "components/kds"])(
    "no hand-rolled `animate-pulse` placeholder under %s",
    (dir) => {
      const offenders: string[] = [];
      for (const file of sourceFiles(resolve(FRONTEND_ROOT, dir))) {
        for (const line of classHits(readFileSync(file, "utf8"), "animate-pulse")) {
          offenders.push(`${rel(file)}:${line}`);
        }
      }
      expect(
        offenders,
        "perpetual decorative motion in the `operational` zone. `components/ui/skeleton.tsx` " +
          "reads the zone and sits STILL on a till and a kitchen screen:\n" +
          offenders.join("\n"),
      ).toEqual([]);
    },
  );

  it("no layout renders a spinner as its bootstrap state", () => {
    // The one every signed-in user met on every route, on all 65 routes, including the POS and
    // the KDS — a spinner in the SHELL is a spinner on the till. It is a `PageSkeleton` now.
    const layouts = ALL_SOURCES.filter((f) => /\/layout\.tsx$/.test(f));
    expect(layouts.length, "layouts found").toBeGreaterThan(3);
    const offenders = layouts.filter(
      (f) => classHits(readFileSync(f, "utf8"), "animate-spin").length > 0,
    );
    expect(offenders.map(rel), "a shell-level spinner reaches every zone").toEqual([]);
  });

  it("every remaining spinner is gated on something being in flight", () => {
    const offenders: string[] = [];
    for (const file of ALL_SOURCES) {
      if (UNGATED_SPINNER_OK[rel(file)]) continue;
      const lines = stripComments(readFileSync(file, "utf8")).split("\n");
      for (const line of classHits(readFileSync(file, "utf8"), "animate-spin")) {
        // The condition is often the JSX line above — `{busy ? (` then the icon.
        const window = lines.slice(Math.max(0, line - 4), line).join("\n");
        if (!IN_FLIGHT.test(window))
          offenders.push(`${rel(file)}:${line} — ${lines[line - 1]?.trim()}`);
      }
    }
    expect(
      offenders,
      "an ungated spinner is a perpetual animation. A spinner may report an action in " +
        "flight; it may never be a region's loading state — use a skeleton matched to the " +
        "final dimensions (UI-SPEC §25):\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Gate 3 — filtered-empty is a different state from empty. Plan 38-12 verification row 3.
// ─────────────────────────────────────────────────────────────────────────────────────────

interface Row {
  id: string;
  name: string;
}

const COLUMNS: ColumnDef<Row, unknown>[] = [{ accessorKey: "name", header: "Name", id: "name" }];

describe("38-12 · filtered-empty is not the same state as empty (UI-SPEC §8.3)", () => {
  it("says something DIFFERENT, and offers a different way out", async () => {
    const onCreate = vi.fn();
    const onClear = vi.fn();

    const { container: emptyTree, unmount } = render(
      <DataGrid
        columns={COLUMNS}
        data={[]}
        emptyTitle="No purchase orders yet"
        emptyDescription="Raise your first order to start tracking spend."
        emptyAction={{ label: "New purchase order", onClick: onCreate }}
      />,
    );
    const emptyText = emptyTree.textContent ?? "";
    unmount();

    const { container: filteredTree } = render(
      <DataGrid
        columns={COLUMNS}
        data={[]}
        isFiltered
        onClearFilters={onClear}
        emptyTitle="No purchase orders yet"
        emptyDescription="Raise your first order to start tracking spend."
        emptyAction={{ label: "New purchase order", onClick: onCreate }}
      />,
    );
    const filteredText = filteredTree.textContent ?? "";

    expect(
      filteredText,
      "'No purchase orders yet' shown to someone who typed a search is the product telling " +
        "them their business has nothing in it",
    ).not.toBe(emptyText);
    expect(emptyText).toMatch(/No purchase orders yet/);
    expect(filteredText).not.toMatch(/No purchase orders yet/);
    expect(filteredText).toMatch(/filters/i);

    // Different AFFORDANCE, not just different words: a create CTA answers a question the
    // person filtering did not ask.
    expect(screen.queryByRole("button", { name: "New purchase order" })).toBeNull();
    const clear = screen.getByRole("button", { name: "Clear all" });
    await userEvent.click(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("a filter that narrows to zero rows still reaches a state", () => {
    // The hole: `columnFilters` is applied INSIDE the table, so `data` arrived full, filtered to
    // nothing, and fell through both branches — a header, a pager reading "0 of 3", and a body
    // with no rows and no sentence in it at all.
    render(
      <DataGrid
        columns={COLUMNS}
        data={[
          { id: "1", name: "Chicken" },
          { id: "2", name: "Rice" },
          { id: "3", name: "Oil" },
        ]}
        columnFilters={[{ id: "name", value: "zzzz" }]}
        emptyTitle="No ingredients yet"
      />,
    );
    expect(screen.getByText(/Nothing matches these filters/)).toBeInTheDocument();
    expect(screen.queryByText("No ingredients yet")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// Gate 4 — the same distinguishability, inside a dropdown. Plan 38-12 task 1.
// ─────────────────────────────────────────────────────────────────────────────────────────

describe("38-12 · a picker's failure is not its empty result", () => {
  async function openPicker(props: Partial<React.ComponentProps<typeof CatalogItemCombobox>>) {
    const view = render(
      <CatalogItemCombobox options={[]} value={null} onSelect={() => {}} {...props} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Select an item/ }));
    return view;
  }

  it("differs by ROLE, by COPY and by AFFORDANCE", async () => {
    const onRetry = vi.fn();

    const { unmount } = await openPicker({
      emptyHeading: "No ingredients match",
      emptyBody: "Try a different search.",
    });
    const emptyText = document.body.textContent ?? "";
    expect(
      screen.queryByRole("alert"),
      "an empty search result must not claim a failure — the mirror image of GA-001",
    ).toBeNull();
    unmount();

    await openPicker({
      isError: true,
      errorLabel: "your ingredients",
      onRetry,
      emptyHeading: "No ingredients match",
      emptyBody: "Try a different search.",
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-testid", "catalog-combobox-error");
    expect(alert.textContent).toMatch(/Couldn.t load your ingredients/);
    expect(
      document.body.textContent,
      "a failed catalog must never be described as a search that matched nothing",
    ).not.toMatch(/No ingredients match/);
    expect(document.body.textContent).not.toBe(emptyText);

    await userEvent.click(screen.getByTestId("catalog-combobox-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("is checked BEFORE loading and before empty, like every other boundary in the product", async () => {
    await openPicker({ isError: true, isLoading: true, errorLabel: "your ingredients" });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it("carries the destructive family, which the empty branch must not", async () => {
    const { container, unmount } = await openPicker({ isError: true });
    // The popover portals out of `container`, so the assertion reads the document.
    expect(document.body.innerHTML).toMatch(/destructive/);
    unmount();
    void container;

    await openPicker({ emptyHeading: "No matches", emptyBody: "Try a different search." });
    expect(
      document.body.innerHTML,
      "an empty state that borrows the danger ramp claims a failure that did not happen",
    ).not.toMatch(/destructive/);
  });
});
