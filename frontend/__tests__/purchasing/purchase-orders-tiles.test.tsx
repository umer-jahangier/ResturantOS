import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { server } from "@/mocks/server";
import { clearSession, seedSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import PurchaseOrdersPage from "@/app/(tenant)/app/purchasing/purchase-orders/page";

/**
 * The purchase-order tile row, asserted against the ONE question it exists to answer:
 * **is anything waiting for me to approve it?**
 *
 * <h3>The defect these are aimed at</h3>
 *
 * The status filter is applied by the SERVER — `usePurchaseOrders(branchId, [status])` puts
 * `?status=` on the request — and the tiles were counted out of the array that came back. So
 * "Awaiting approval" was not merely wrong under a filter, it was **structurally always 0**: the
 * only rows in scope were the ones matching the chosen status, and the moment a buyer narrowed to
 * DRAFT the screen told them nothing was awaiting approval while three orders were. Same for the
 * subtitle's exception clause, which was written `awaitingCount > 0 ? … : null` and therefore
 * disappeared in exactly the case an owner needed it.
 *
 * <p>`lib/format/stat-line.ts:20-25` already states the rule the screen was breaking — "a subtitle
 * must reconcile with the grid beneath it… where a filter has narrowed that array they say so" —
 * and `inventory/stock/page.tsx` already spells the compliant version with `filteredCountLine`.
 * This page had `countLine`, so a narrowed list read as a smaller business.
 *
 * <h3>Why these assert the REQUEST as well as the DOM</h3>
 *
 * A tile can be made to read 3 by fetching a second, unfiltered list beside the first — which
 * doubles the reads and reintroduces the drift the file's own comment at `:52-53` was trying to
 * prevent (two arrays, two sources of truth, no guarantee they agree). The fix taken is the one
 * `stock/page.tsx` uses: ONE unfiltered read, narrowed in the browser, so the denominator on the
 * tiles and the numerator in the grid are literally the same array. Asserting that no `status`
 * parameter ever leaves the page is what keeps a later "optimisation" from quietly restoring a
 * server-side filter and, with it, the always-zero tile.
 */

/** The gateway's success envelope — the same `{ data, meta, warnings }` shape `mocks/` uses. */
function ok<T>(data: T) {
  return HttpResponse.json({ data, meta: null, warnings: [] });
}

const BRANCH = "b1000001-0000-4000-8000-000000000001";
const VENDOR = "d1000001-0000-4000-8000-000000000001";

function po(id: string, status: string, totalPaisa: number) {
  return {
    id,
    vendorId: VENDOR,
    branchId: BRANCH,
    status,
    expectedDeliveryDate: null,
    totalPaisa,
    notes: null,
    requesterId: null,
    submittedAt: null,
    requiredTiers: null,
    tiersApproved: null,
    closedAt: null,
    closeReason: null,
    lines: [],
  };
}

/** Two drafts, three awaiting approval, one sent — six orders, three distinct statuses. */
const PURCHASE_ORDERS = [
  po("a0000001-0000-4000-8000-000000000001", "DRAFT", 100_00),
  po("a0000001-0000-4000-8000-000000000002", "DRAFT", 200_00),
  po("a0000001-0000-4000-8000-000000000003", "PENDING_APPROVAL", 300_00),
  po("a0000001-0000-4000-8000-000000000004", "PENDING_APPROVAL", 400_00),
  po("a0000001-0000-4000-8000-000000000005", "PENDING_APPROVAL", 500_00),
  po("a0000001-0000-4000-8000-000000000006", "SENT", 600_00),
];

/** The raw query string of every PO-list request this page made during one test. */
let listQueries: string[] = [];

beforeEach(() => {
  listQueries = [];
  seedSession({ branchId: BRANCH });
  server.use(
    http.get("*/api/v1/purchasing/purchase-orders", ({ request }) => {
      const url = new URL(request.url);
      listQueries.push(url.search);
      // Deliberately a REAL server-side filter, and deliberately tolerant of BOTH spellings:
      // axios serialises an array param as `status[]=DRAFT`, while the controller declares
      // `@RequestParam(required = false) List<PoStatus> status` and therefore only ever reads
      // `status=DRAFT`. If the page goes back to asking the server to narrow the list, this
      // handler narrows it, and the tiles go back to counting a subset of the business.
      const statuses = [
        ...url.searchParams.getAll("status"),
        ...url.searchParams.getAll("status[]"),
      ];
      return ok(
        statuses.length > 0
          ? PURCHASE_ORDERS.filter((p) => statuses.includes(p.status))
          : PURCHASE_ORDERS,
      );
    }),
    http.get("*/api/v1/purchasing/vendors", () =>
      ok([{ id: VENDOR, name: "Metro Cash & Carry", branchId: BRANCH }]),
    ),
  );
});

afterEach(() => {
  clearSession();
});

/** The rendered figure of the tile whose label starts with `labelPrefix`. */
function tileValue(labelPrefix: string): string {
  const tiles = Array.from(document.querySelectorAll<HTMLElement>('[data-slot="stat-tile"]'));
  const match = tiles.find((t) => (t.getAttribute("aria-label") ?? "").startsWith(labelPrefix));
  if (!match) {
    throw new Error(
      `no stat tile labelled "${labelPrefix}…" — saw: ${tiles
        .map((t) => t.getAttribute("aria-label"))
        .join(", ")}`,
    );
  }
  return (match.querySelector('[data-slot="stat-tile-value"]')?.textContent ?? "").trim();
}

/** Body rows in the grid, re-queried every call — a status change remounts the table. */
function gridRowCount(): number {
  const grid = screen.getByRole("table", { name: "Purchase orders" });
  return within(grid).getAllByRole("row").length - 1;
}

function subtitle(): string {
  return document.querySelector('[data-slot="page-header"]')?.textContent ?? "";
}

async function renderPage() {
  render(<PurchaseOrdersPage />, { wrapper: createQueryWrapper() });
  await waitFor(() => expect(tileValue("Purchase orders")).toBe("6"));
}

describe("Purchase orders — the tiles under a status filter", () => {
  it("counts every status out of the whole branch before any filter is applied", async () => {
    await renderPage();

    expect(tileValue("Draft")).toBe("2");
    expect(tileValue("Awaiting approval")).toBe("3");
    expect(subtitle()).toContain("6 purchase orders");
    expect(subtitle()).toContain("3 awaiting approval");
  });

  it("keeps 'Awaiting approval' truthful when the list is narrowed to DRAFT", async () => {
    // The defect, stated as a user would hit it: a buyer filters to their own drafts and the
    // screen reports that nothing needs approving. Three orders do.
    await renderPage();

    await userEvent.selectOptions(screen.getByLabelText("Status"), "DRAFT");

    await waitFor(() => expect(tileValue("Orders shown")).toBe("2"));
    expect(tileValue("Awaiting approval")).toBe("3");
    expect(tileValue("Draft")).toBe("2");
  });

  it("says which basis each tile is counting once a filter is on", async () => {
    await renderPage();

    await userEvent.selectOptions(screen.getByLabelText("Status"), "SENT");

    await waitFor(() => expect(tileValue("Orders shown")).toBe("1"));
    // A branch-wide figure sitting beside a filtered one must say so, or the reader has no way
    // to tell which tiles moved with the filter and which did not.
    expect(screen.getByRole("article", { name: "Draft (all orders)" })).toBeInTheDocument();
    expect(
      screen.getByRole("article", { name: "Awaiting approval (all orders)" }),
    ).toBeInTheDocument();
    expect(tileValue("Awaiting approval")).toBe("3");
  });

  it("states both numbers in the subtitle, and never drops the exception clause", async () => {
    await renderPage();

    await userEvent.selectOptions(screen.getByLabelText("Status"), "SENT");

    await waitFor(() => expect(subtitle()).toContain("1 of 6 purchase orders"));
    // `awaitingCount > 0 ? … : null` used to evaluate against the FILTERED array, so filtering to
    // anything other than PENDING_APPROVAL deleted the one line an owner is reading for.
    expect(subtitle()).toContain("3 awaiting approval");
    expect(subtitle()).toContain("Filtered to sent");
  });

  it("never puts ?status= on the wire — the filter is applied to the array the grid renders", async () => {
    await renderPage();

    await userEvent.selectOptions(screen.getByLabelText("Status"), "DRAFT");
    await waitFor(() => expect(tileValue("Orders shown")).toBe("2"));

    expect(listQueries.length).toBeGreaterThan(0);
    expect(listQueries.every((query) => !query.includes("status"))).toBe(true);
  });

  it("still narrows the grid itself to the chosen status", async () => {
    await renderPage();
    expect(gridRowCount()).toBe(6);

    await userEvent.selectOptions(screen.getByLabelText("Status"), "DRAFT");

    await waitFor(() => expect(gridRowCount()).toBe(2));
  });
});
