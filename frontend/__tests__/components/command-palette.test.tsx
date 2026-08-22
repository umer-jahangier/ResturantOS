import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { server } from "@/mocks/server";
import { clearSession, seedSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import {
  matchScore,
  termScore,
  SCORE_PREFIX,
  SCORE_WORD_PREFIX,
} from "@/lib/command-palette/match";
import {
  ACTION_COMMANDS,
  PAGE_COMMANDS,
  commandSearchFields,
} from "@/lib/command-palette/registry";
import { resetRecentsCache, RECENTS_LIMIT } from "@/lib/command-palette/recents";
import { CommandPalette } from "@/components/ui/command-palette";

/**
 * The command palette — 38-11, UI-SPEC §10.
 *
 * <h3>The defect these tests were written against, reproduced first</h3>
 *
 * 38-11's negative control #1 says: *"Restore subsequence matching → the `ord`/`Dashboard` case
 * must go red. Run this against today's code first and confirm it reproduces the live defect — if
 * the check passes against the current 87-line palette, the check is wrong."*
 *
 * Run before any of this shipped, against the old palette, with `cmdk`'s built-in
 * `defaultFilter` (`command-score`) — the filter it used:
 *
 * ```
 * defaultFilter("Dashboard", "ord")    →  0.02887  (non-zero: it MATCHES)
 * defaultFilter("Orders",    "ord")    →  0.98990  (prefix)
 * defaultFilter("Dashboard", "board")  →  0.17     (an interior substring also matches)
 * ```
 *
 * That is the live defect in one line: with only "Dashboard" in the list, a search for `ord`
 * returns a dashboard. `matchScore(["Dashboard"], "ord")` is **0**, and the case is asserted by
 * name below.
 *
 * <h3>Negative controls — run, OBSERVED RED, restored (D-38-07)</h3>
 *
 * 1. **Matching.** Replaced `termScore`'s prefix/word-boundary rules with a subsequence scan.
 *    → RED, four tests at once: *"`ord` does NOT match `Dashboard`"*, *"matches an interior WORD
 *    but never an interior substring"*, *"splits on punctuation…"* and — at the rendered level —
 *    *"`ord` never offers Dashboard"*, where the Dashboard row came back. Restored. This is
 *    control #1 above, re-run against the NEW code.
 * 2. **Permission filtering.** Gave the cashier fixture `finance.journal.view`.
 *    → RED: *"a cashier's palette does not offer a finance route"* failed on `General Ledger`.
 *    Restored. Control #3.
 * 3. **Layer boundary.** Added `import { PosRepository } from "@/lib/repositories/pos.repository"`
 *    to `command-palette.tsx`. → RED: *"imports nothing from Layer 1 or Layer 2"*. `eslint` agreed
 *    from the other side: *"'@/lib/repositories/pos.repository' import is restricted … Layer
 *    boundary violation"*. Restored. Control #2.
 * 4. **Empty state.** Replaced both lines with `No results`. → RED: *"a cashier's empty state
 *    names only the categories their palette actually searched"*. Restored. Control #4.
 * 5. **`aria-modal`.** Removed `aria-modal="true"` from `DialogContent` (restored byte-identical,
 *    md5 checked). → RED: *"is a modal dialog — aria-modal is true, not null"*. Control #5. The
 *    audit measured `null` here on the live palette, so this is not hypothetical.
 * 6. **Theme origin.** Dropped the explicit `transition` argument so the call became
 *    `setTheme(next)`. → RED: *"toggles the theme through the shared cycle and passes origin
 *    center explicitly"*. Restored (D-38-14).
 */

const { setTheme } = vi.hoisted(() => ({ setTheme: vi.fn() }));
const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/app/dashboard",
}));

vi.mock("@teispace/next-themes", () => ({
  useTheme: () => ({ theme: "light", setTheme }),
}));

const ENTERPRISE_FEATURES = [
  "FEATURE_POS",
  "FEATURE_KDS",
  "FEATURE_INVENTORY",
  "FEATURE_FINANCE",
  "FEATURE_VENDOR",
  "FEATURE_HR",
  "FEATURE_CRM",
  "FEATURE_NLQ",
  "FEATURE_REPORTING_ADVANCED",
];

/** The nav-relevant subset of a real OWNER grant — same shape as `nav-permission-matrix.test.tsx`. */
const OWNER_PERMISSIONS = [
  "pos.order.view",
  "pos.order.create",
  "pos.kds.view",
  "pos.till.review",
  "pos.till.open",
  "pos.menu.manage",
  "pos.menu.view",
  "pos.tables.admin",
  "pos.terminals.admin",
  "pos.printers.admin",
  "pos.tax.manage",
  "inventory.item.view",
  "finance.journal.view",
  "vendor.view",
  "vendor.po.create",
  "crm.customer.view",
  "hr.employee.view",
  "hr.config.view",
  "reporting.report.view",
  "reporting.dashboard.view",
  "nlq.query.run",
  "nlq.settings.manage",
  "audit.log.view",
  "ops.health.view",
  "rbac.manage",
];

/** A CASHIER holds the till and the order, and deliberately nothing financial. */
const CASHIER_PERMISSIONS = [
  "pos.order.view",
  "pos.order.create",
  "pos.till.open",
  "pos.menu.view",
];

const ORDER_NO = "ORD-20260811-0017";
const ORDER_ID = "3f6d2a10-0000-4000-8000-000000000017";

function seedFeatures(features: string[] = ENTERPRISE_FEATURES) {
  server.use(
    http.get("*/api/v1/feature-flags", () =>
      HttpResponse.json({ data: { features }, meta: null, warnings: [] }),
    ),
  );
}

function seedOrderSearch() {
  server.use(
    http.get("*/api/v1/pos/orders", () =>
      HttpResponse.json({
        data: [
          {
            orderId: ORDER_ID,
            orderNo: ORDER_NO,
            tableId: null,
            tableName: "Table 4",
            type: "DINE_IN",
            derivedStatus: "SERVED",
            cashierId: null,
            cashierName: null,
            coverCount: 2,
            totalPaisa: 165700,
            openedAt: "2026-08-11T12:00:00Z",
            settlementStatus: "CLOSED",
            paymentStatus: "PAID",
            amountPaidPaisa: 165700,
            itemQuantity: 3,
            distinctItemCount: 3,
          },
        ],
        meta: { page: 0, size: 6, totalElements: 1, totalPages: 1 },
        warnings: [],
      }),
    ),
  );
}

function renderPalette() {
  const onOpenChange = vi.fn();
  const Wrapper = createQueryWrapper();
  render(
    <Wrapper>
      <CommandPalette open onOpenChange={onOpenChange} />
    </Wrapper>,
  );
  return { onOpenChange };
}

async function openWithQuery(text: string) {
  const user = userEvent.setup();
  const handles = renderPalette();
  const input = await screen.findByTestId("command-palette-input");
  await user.type(input, text);
  return { user, input, ...handles };
}

beforeEach(() => {
  push.mockClear();
  setTheme.mockClear();
  window.localStorage.clear();
  resetRecentsCache();
});

afterEach(() => {
  cleanup();
  clearSession();
  window.localStorage.clear();
  resetRecentsCache();
});

// ── Matching (unit) ────────────────────────────────────────────────────────────────────────────

describe("matching — prefix and word boundary, never subsequence", () => {
  it("`ord` matches `Orders` as a prefix", () => {
    expect(matchScore(["Orders"], "ord")).toBe(SCORE_PREFIX);
  });

  it("`ord` matches `ORD-20260811-0017` — the order number the palette exists to find", () => {
    expect(matchScore([ORDER_NO], "ord")).toBe(SCORE_PREFIX);
  });

  it("`ord` does NOT match `Dashboard` — the audit's measured defect, asserted by name", () => {
    // d-a-s-h-b-O-a-R-D. A subsequence matcher scores this; a prefix matcher must not.
    expect(matchScore(["Dashboard"], "ord")).toBe(0);
    expect(termScore(["Dashboard"], "ord")).toBe(0);
  });

  it("matches an interior WORD but never an interior substring", () => {
    expect(termScore(["General Ledger"], "ledger")).toBe(SCORE_WORD_PREFIX);
    // "board" is inside "Dashboard" but starts no word in it.
    expect(termScore(["Dashboard"], "board")).toBe(0);
  });

  it("splits on punctuation, so a trailing order sequence is findable on its own", () => {
    expect(termScore([ORDER_NO], "0017")).toBe(SCORE_WORD_PREFIX);
    expect(termScore([ORDER_NO], "20260811")).toBe(SCORE_WORD_PREFIX);
  });

  it("requires EVERY term of a multi-word query to match", () => {
    expect(matchScore(["Purchase Orders"], "purchase ord")).toBeGreaterThan(0);
    expect(matchScore(["Orders"], "purchase ord")).toBe(0);
  });

  it("is case-insensitive and treats a blank query as matching nothing", () => {
    expect(matchScore(["ORD-1"], "ord")).toBeGreaterThan(0);
    expect(matchScore(["Orders"], "   ")).toBe(0);
  });
});

// ── The registry ───────────────────────────────────────────────────────────────────────────────

describe("registry — every destination is real, gated and unique", () => {
  const all = [...ACTION_COMMANDS, ...PAGE_COMMANDS];

  it("has unique ids — recents are keyed on them", () => {
    const ids = all.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers no route the nav config marks as unbuilt", () => {
    // `/app/reporting` and `/platform/tenants` are `comingSoon` in sidebar-nav-items.ts and 404.
    expect(all.some((command) => command.comingSoon === true)).toBe(false);
    expect(all.some((command) => command.href === "/app/reporting")).toBe(false);
    expect(all.some((command) => command.href === "/platform/tenants")).toBe(false);
  });

  it("reaches beyond the sidebar — the tab-only screens are addressable", () => {
    const hrefs = new Set(all.map((command) => command.href));
    for (const href of [
      "/app/finance/transactions",
      "/app/finance/ar-aging",
      "/app/finance/house-accounts",
      "/app/inventory/stock",
      "/app/hr/payroll",
      "/app/purchasing/invoices",
      "/app/reports/fbr",
      "/app/kitchen/expo",
      "/app/profile",
    ]) {
      expect(hrefs, `${href} should be reachable from the palette`).toContain(href);
    }
  });

  it("resolves the acronyms a finance user actually types", () => {
    const find = (query: string) =>
      PAGE_COMMANDS.filter((command) => matchScore(commandSearchFields(command), query) > 0).map(
        (command) => command.label,
      );
    expect(find("gl")).toContain("General Ledger");
    expect(find("coa")).toContain("Accounts");
    expect(find("kds")).toContain("Kitchen Display");
  });

  it("names the three quick actions UI-SPEC §10 requires, each permission-gated", () => {
    const byLabel = new Map(ACTION_COMMANDS.map((command) => [command.label, command]));
    expect(byLabel.get("New order")?.permission).toBe("pos.order.create");
    expect(byLabel.get("Open till")?.permission).toBe("pos.till.open");
    expect(byLabel.get("New purchase order")?.permission).toBe("vendor.po.create");
  });

  it("agrees with FINANCE_TABS — the module's own source of truth", async () => {
    const { FINANCE_TABS } = await import("@/app/(tenant)/app/finance/layout");
    const registryFinance = new Map(
      PAGE_COMMANDS.filter((command) => command.href.startsWith("/app/finance/")).map((command) => [
        command.href,
        command,
      ]),
    );

    expect(registryFinance.size).toBe(FINANCE_TABS.length);
    for (const tab of FINANCE_TABS) {
      const command = registryFinance.get(tab.href);
      expect(command, `${tab.href} missing from the palette registry`).toBeDefined();
      const required = Array.isArray(command!.permission)
        ? command!.permission
        : [command!.permission!];
      expect(new Set(required)).toEqual(new Set(tab.require));
    }
  });
});

// ── Layer discipline ───────────────────────────────────────────────────────────────────────────

describe("layers — the palette does not fetch (task 3)", () => {
  it("imports nothing from Layer 1 or Layer 2", () => {
    const source = readFileSync(
      resolve(__dirname, "../../components/ui/command-palette.tsx"),
      "utf8",
    );
    const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]!);
    for (const specifier of imports) {
      expect(specifier).not.toMatch(/^@\/lib\/(api-client|repositories)/);
      expect(specifier).not.toBe("axios");
    }
    // …and it does consume Layer 3, which is what "does not fetch" is traded for.
    expect(imports).toContain("@/lib/hooks/ui/use-command-palette");
  });
});

// ── Rendered behaviour ─────────────────────────────────────────────────────────────────────────

describe("the palette, rendered", () => {
  it("is a modal dialog — aria-modal is true, not null", async () => {
    seedFeatures();
    seedSession({ roles: ["OWNER"], permissions: OWNER_PERMISSIONS });
    renderPalette();

    const dialog = await screen.findByTestId("command-palette");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("role", "dialog");
  });

  it("groups results under labelled, keyboard-navigable categories", async () => {
    seedFeatures();
    seedSession({ roles: ["OWNER"], permissions: OWNER_PERMISSIONS });
    renderPalette();

    const list = await screen.findByTestId("command-palette-list");
    expect(list).toHaveAttribute("role", "listbox");
    const headings = () =>
      Array.from(list.querySelectorAll("[cmdk-group-heading]")).map((node) => node.textContent);
    await waitFor(() => expect(headings()).toContain("Quick actions"));
    expect(headings()).toContain("Pages");
    expect(headings()).toContain("Settings");
  });

  it("`ord` never offers Dashboard, and does offer the order screens", async () => {
    seedFeatures();
    seedOrderSearch();
    seedSession({ roles: ["OWNER"], permissions: OWNER_PERMISSIONS });
    await openWithQuery("ord");

    // The list starts unfiltered (the query is debounced), so wait for the FILTER to land —
    // asserting the presence of a matching row would be satisfied by the unfiltered list.
    await waitFor(() =>
      expect(screen.queryByTestId("command-palette-item-page.dashboard")).toBeNull(),
    );
    expect(
      screen.getByTestId("command-palette-item-page.purchasing.purchase-orders"),
    ).toBeInTheDocument();
  });

  it("finds a real order by its number, under an Orders heading", async () => {
    seedFeatures();
    seedOrderSearch();
    seedSession({ roles: ["OWNER"], permissions: OWNER_PERMISSIONS });
    const { user } = await openWithQuery("ord");

    const row = await screen.findByTestId(`command-palette-order-${ORDER_ID}`);
    expect(row).toHaveTextContent(ORDER_NO);
    expect(screen.getByText("Orders")).toBeInTheDocument();

    await user.click(row);
    expect(push).toHaveBeenCalledWith(`/app/pos/orders/${ORDER_ID}/receipt`);
  });

  it("finds a vendor by name and opens its own page", async () => {
    seedFeatures();
    seedOrderSearch();
    seedSession({ roles: ["OWNER"], permissions: OWNER_PERMISSIONS });
    const { user } = await openWithQuery("fresh");

    const row = await screen.findByText("Fresh Foods Ltd");
    await user.click(row);
    expect(push).toHaveBeenCalledWith(expect.stringMatching(/^\/app\/purchasing\/vendors\//));
  });

  it("a cashier's palette does not offer a finance route", async () => {
    seedFeatures();
    seedSession({ roles: ["CASHIER"], permissions: CASHIER_PERMISSIONS });
    renderPalette();

    await waitFor(() =>
      expect(screen.getByTestId("command-palette-item-page.pos")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("command-palette-item-page.finance.gl")).toBeNull();
    expect(screen.queryByTestId("command-palette-item-page.finance.accounts")).toBeNull();
    expect(screen.queryByTestId("command-palette-item-settings.users")).toBeNull();
    // …and is not offered a quick action whose endpoint would refuse them.
    expect(screen.queryByTestId("command-palette-item-action.new-purchase-order")).toBeNull();
    expect(screen.getByTestId("command-palette-item-action.open-till")).toBeInTheDocument();
  });

  it("a cashier's empty state names only the categories their palette actually searched", async () => {
    seedFeatures();
    seedSession({ roles: ["CASHIER"], permissions: CASHIER_PERMISSIONS });
    await openWithQuery("zzzzqq");

    const message = await screen.findByText('Nothing matches "zzzzqq".');
    expect(message).toBeInTheDocument();

    const scope = await screen.findByText(/^Searched /);
    expect(scope).toHaveTextContent("Orders");
    expect(scope).toHaveTextContent("Pages");
    // No vendor.view, so the palette must not claim it looked there.
    expect(scope).not.toHaveTextContent("Vendors");
  });

  it("moves with the arrows, opens with Enter and closes with Escape", async () => {
    seedFeatures();
    seedSession({ roles: ["OWNER"], permissions: OWNER_PERMISSIONS });
    const { user, onOpenChange } = await openWithQuery("general ledger");

    await waitFor(() =>
      expect(screen.queryByTestId("command-palette-item-page.dashboard")).toBeNull(),
    );
    const row = await screen.findByTestId("command-palette-item-page.finance.gl");
    await waitFor(() => expect(row).toHaveAttribute("aria-selected", "true"));

    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/app/finance/gl");

    onOpenChange.mockClear();
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("arrow-down advances the selection to the next row", async () => {
    seedFeatures();
    seedSession({ roles: ["OWNER"], permissions: OWNER_PERMISSIONS });
    const { user } = await openWithQuery("finance");

    await waitFor(() =>
      expect(screen.queryByTestId("command-palette-item-page.dashboard")).toBeNull(),
    );
    const rows = await screen.findAllByRole("option", { hidden: true });
    await waitFor(() => expect(rows[0]).toHaveAttribute("aria-selected", "true"));
    await user.keyboard("{ArrowDown}");
    await waitFor(() => expect(rows[1]).toHaveAttribute("aria-selected", "true"));
  });

  it("toggles the theme through the shared cycle and passes origin center explicitly", async () => {
    seedFeatures();
    seedSession({ roles: ["OWNER"], permissions: OWNER_PERMISSIONS });
    const { user } = await openWithQuery("theme");

    await user.click(await screen.findByTestId("command-palette-item-action.toggle-theme"));

    expect(setTheme).toHaveBeenCalledTimes(1);
    const [next, options] = setTheme.mock.calls[0]!;
    // light → dark, the same cycle `ThemeToggle` walks (GA-092).
    expect(next).toBe("dark");
    expect(options).toMatchObject({ transition: { type: "circular", origin: "center" } });
    expect(push).not.toHaveBeenCalled();
  });
});

// ── Recents ────────────────────────────────────────────────────────────────────────────────────

describe("recents — last five, per user", () => {
  it("shows previously chosen commands first, and only ones still permitted", async () => {
    window.localStorage.setItem(
      "restaurantos.command-palette.recents.user-1",
      JSON.stringify([
        "page.finance.gl",
        "settings.users",
        "page.does.not.exist",
        "page.dashboard",
      ]),
    );
    resetRecentsCache();
    seedFeatures();
    seedSession({ sub: "user-1", roles: ["OWNER"], permissions: OWNER_PERMISSIONS });
    renderPalette();

    const heading = await screen.findByText(/^Recent/);
    const group = heading.parentElement!;
    const labels = within(group)
      .getAllByRole("option", { hidden: true })
      .map((row) => row.getAttribute("data-testid"));

    expect(labels).toEqual([
      "command-palette-item-page.finance.gl",
      "command-palette-item-settings.users",
      "command-palette-item-page.dashboard",
    ]);
  });

  it("records a selection, most recent first, capped at five", async () => {
    seedFeatures();
    seedSession({ sub: "user-7", roles: ["OWNER"], permissions: OWNER_PERMISSIONS });
    const { user } = await openWithQuery("general ledger");

    await user.click(await screen.findByTestId("command-palette-item-page.finance.gl"));

    const stored = JSON.parse(
      window.localStorage.getItem("restaurantos.command-palette.recents.user-7") ?? "[]",
    );
    expect(stored[0]).toBe("page.finance.gl");
    expect(stored.length).toBeLessThanOrEqual(RECENTS_LIMIT);
  });

  it("keys the list on the user, so the next person to sign in sees their own", async () => {
    window.localStorage.setItem(
      "restaurantos.command-palette.recents.user-1",
      JSON.stringify(["page.finance.gl"]),
    );
    resetRecentsCache();
    seedFeatures();
    seedSession({ sub: "user-2", roles: ["OWNER"], permissions: OWNER_PERMISSIONS });
    renderPalette();

    await waitFor(() =>
      expect(screen.getByTestId("command-palette-item-page.dashboard")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/^Recent/)).toBeNull();
  });
});
