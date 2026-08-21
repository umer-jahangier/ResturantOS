import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { JournalEntryTable } from "@/components/finance/JournalEntryTable";

/**
 * F10 — can an owner FIND the journal entry for one order?
 *
 * <h3>What was measured, in Chromium, before any of this was changed</h3>
 *
 * Driven 2026-08-12 as `owner@terrace.local` (`.planning/audits/floor/F10/`):
 *   - 48 of 48 rows on `/app/finance/journal-entries` read `Order revenue <uuid>`; zero carried an
 *     order number, although the order number rides on ORDER_CLOSED as `orderNo`,
 *   - the branch had 254 entries inside the list's default one-month window, the page showed 50
 *     with no ORDER BY and no pagination, and the newest entry was `JE-2027-000256` while page 1
 *     ended at `JE-2027-000065` — so the entry a freshly settled check had just posted was not on
 *     the screen at all, and there was no control to reach it.
 *
 * <h3>How these assertions are written</h3>
 *
 * They read the rendered text and drive the search box by its accessible name, and they assert the
 * REQUEST the component makes — because "search" that filters only the rows already loaded would
 * satisfy any assertion about the DOM while telling an accountant "no such entry" about an entry
 * that is one page away.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

const BRANCH_ID = "branch-1";

/** The two entries the walkthrough's checks produced, in the shape the API returns them. */
const ORDER_0164 = {
  id: "0a000001-0000-4000-8000-000000000001",
  entryNo: "JE-2027-000255",
  periodId: "0b000001-0000-4000-8000-000000000001",
  entryDate: "2026-08-12",
  description: "Order revenue ORD-20260812-0164",
  sourceType: "ORDER_REVENUE",
  sourceId: "b64e3cdd-6e00-4d45-88d6-7e8afdaff0fb",
  status: "POSTED",
  postedBy: null,
  reversal: false,
  reversalOfJe: null,
  reversedByJe: null,
  totalDebitPaisa: 158980,
  totalCreditPaisa: 158980,
  lines: [],
  sourceReference: null,
};

const ORDER_0165 = {
  ...ORDER_0164,
  id: "0a000002-0000-4000-8000-000000000002",
  entryNo: "JE-2027-000256",
  description: "Order revenue ORD-20260812-0165",
  sourceId: "7689d9c7-7152-42d4-826e-be025ded14c6",
  totalDebitPaisa: 197200,
  totalCreditPaisa: 197200,
};

/** Requests the component actually made, so "did it ask the server?" is answerable. */
const requestedQ: (string | null)[] = [];

function pagedResponse(rows: unknown[], totalCount: number) {
  return HttpResponse.json({
    data: rows,
    meta: { page: { cursor: "0", nextCursor: null, limit: 50 }, totalCount },
    warnings: [],
  });
}

function mockLedger() {
  server.use(
    http.get("*/api/v1/finance/journal-entries", ({ request }) => {
      const q = new URL(request.url).searchParams.get("q");
      requestedQ.push(q);
      if (q) {
        // The SERVER decides what matches — exactly as it does in production, where the match runs
        // over the branch's whole ledger and not over the rows this page happens to hold.
        const hits = [ORDER_0164, ORDER_0165].filter((e) =>
          e.description.toLowerCase().includes(q.toLowerCase()),
        );
        return pagedResponse(hits, hits.length);
      }
      return pagedResponse([ORDER_0165, ORDER_0164], 254);
    }),
  );
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

function renderLedger() {
  requestedQ.length = 0;
  mockLedger();
  seedSession({ branchId: BRANCH_ID, permissions: ["finance.journal.view"] });
  const Wrapper = createWrapper();
  return render(
    <Wrapper>
      <JournalEntryTable />
    </Wrapper>,
  );
}

/**
 * `DataGrid` renders BOTH branches — the desktop table and the below-`md` card list — and lets CSS
 * pick one, because choosing in JS from a media query hydrates a different tree than it rendered
 * (`data-grid.tsx`, "Both branches are in the DOM"). So every row's text is in the document twice
 * and a bare `screen.getByText` is ambiguous. These helpers scope to the table, which is where
 * the assertions below mean what they say; the card branch is covered by the grid's own suite.
 */
function grid(): HTMLElement {
  return screen.getByRole("table", { name: "Journal entries" });
}

function inGrid(text: string | RegExp) {
  return within(grid()).getByText(text);
}

function rowFor(text: string): HTMLElement {
  const label = inGrid(text);
  const tr = label.closest("tr");
  if (!tr) throw new Error(`no table row carries ${text}`);
  return tr as HTMLElement;
}

const searchBox = () =>
  screen.getByRole("textbox", {
    name: "Search journal entries by entry number or description",
  });

describe("F10 — the ledger names the order, and the order can be found", () => {
  afterEach(() => clearSession());

  it("a revenue row names the order number, not a UUID", async () => {
    renderLedger();
    await waitFor(() => expect(inGrid("JE-2027-000255")).toBeInTheDocument());

    const row = rowFor("JE-2027-000255");
    expect(row).toHaveTextContent("Order revenue ORD-20260812-0164");
    expect(row).not.toHaveTextContent("b64e3cdd-6e00-4d45-88d6-7e8afdaff0fb");
  });

  it("typing an order number asks the SERVER for it, and shows only that row", async () => {
    const user = userEvent.setup();
    renderLedger();
    await waitFor(() => expect(inGrid("JE-2027-000255")).toBeInTheDocument());

    await user.type(searchBox(), "ORD-20260812-0164");

    await waitFor(() => expect(requestedQ).toContain("ORD-20260812-0164"));
    await waitFor(() =>
      expect(within(grid()).queryByText("JE-2027-000256")).not.toBeInTheDocument(),
    );
    expect(inGrid("Order revenue ORD-20260812-0164")).toBeInTheDocument();
  });

  it("says how many entries matched, and how many the unfiltered list is showing of", async () => {
    const user = userEvent.setup();
    renderLedger();

    // A ledger that shows 50 of 254 rows without saying so is a sample wearing the costume of a
    // ledger — the shape that had the KDS board silently showing 20 of 29 tickets.
    await waitFor(() =>
      expect(screen.getByTestId("je-result-count")).toHaveTextContent("Showing 2 of 254 entries"),
    );

    await user.type(searchBox(), "ORD-20260812-0164");
    await waitFor(() =>
      expect(screen.getByTestId("je-result-count")).toHaveTextContent("1 entry matches"),
    );
  });

  it("a term that matches nothing says so, and says the search covered the whole branch", async () => {
    const user = userEvent.setup();
    renderLedger();
    await waitFor(() => expect(inGrid("JE-2027-000255")).toBeInTheDocument());

    await user.type(searchBox(), "ORD-19990101-0001");

    await waitFor(() =>
      expect(screen.getByText(/No entry matches/)).toBeInTheDocument(),
    );
    // Not "no journal entries" — the books are not empty, this term simply has no match, and the
    // difference is the whole of GA-001.
    expect(screen.queryByText("No journal entries")).not.toBeInTheDocument();
    expect(screen.getByText(/every entry for this branch/)).toBeInTheDocument();
  });

  it("a failed read is never dressed up as an empty ledger", async () => {
    seedSession({ branchId: BRANCH_ID, permissions: ["finance.journal.view"] });
    server.use(
      http.get("*/api/v1/finance/journal-entries", () =>
        HttpResponse.json({ error: { code: "INTERNAL", message: "boom" } }, { status: 500 }),
      ),
    );
    const Wrapper = createWrapper();
    render(
      <Wrapper>
        <JournalEntryTable />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText("No journal entries")).not.toBeInTheDocument();
  });
});
