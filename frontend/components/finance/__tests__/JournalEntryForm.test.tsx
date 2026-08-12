import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JournalEntryForm } from "@/components/finance/JournalEntryForm";
import { server } from "@/mocks/server";
import { clearSession, seedSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";

/**
 * F9 — /app/finance/journal-entries/new, the one screen where an accountant types money by hand.
 *
 * These assert what the ACCOUNTANT sees and what leaves the screen, not what the component holds.
 * Against the pre-fix component every test in the first two blocks fails:
 *
 *   - the columns read "Debit (paisa)" / "Credit (paisa)";
 *   - typing 1250.50 into a `type="number"` box handled by `parseInt` posted 1250 paisa
 *     (Rs 12.50) for a Rs 1,250.50 line, and printed the running total as "125,050";
 *   - and the date fell back to `openPeriods[0].startDate` — 1 Aug 2025 — with no sentence
 *     anywhere on the page saying why.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

const API = "http://localhost:8080";
const BRANCH_ID = "b0000001-0000-4000-8000-000000000001";

/**
 * The live tenant's open periods on the day of the walkthrough: fiscal 2026, Aug 2025 → Jun 2026,
 * with the clock reading 12 Aug 2026. Nothing here is invented — it is
 * `GET /api/v1/finance/periods/open` as captured in .planning/audits/floor/F9.
 */
const OPEN_PERIODS = [
  ["2025-08-01", "2025-08-31"],
  ["2025-09-01", "2025-09-30"],
  ["2025-10-01", "2025-10-31"],
  ["2025-11-01", "2025-11-30"],
  ["2025-12-01", "2025-12-31"],
  ["2026-01-01", "2026-01-31"],
  ["2026-02-01", "2026-02-28"],
  ["2026-03-01", "2026-03-31"],
  ["2026-04-01", "2026-04-30"],
  ["2026-05-01", "2026-05-31"],
  ["2026-06-01", "2026-06-30"],
].map(([startDate, endDate], i) => ({
  id: `e0000001-0000-4000-8000-${String(i + 2).padStart(12, "0")}`,
  fiscalYear: 2026,
  periodNo: i + 2,
  startDate,
  endDate,
  status: "OPEN",
  lockedBy: null,
  lockedAt: null,
}));

/**
 * And the FY2027 half the live API actually serves alongside it. `GET /finance/periods/open`
 * returns all 22 in this order; today, 12 Aug 2026, is inside the TWELFTH. The pre-fix form only
 * ever examined `openPeriods[0]`.
 */
const OPEN_PERIODS_FY2027 = [
  ["2026-08-01", "2026-08-31"],
  ["2026-09-01", "2026-09-30"],
  ["2026-10-01", "2026-10-31"],
  ["2026-11-01", "2026-11-30"],
  ["2026-12-01", "2026-12-31"],
  ["2027-01-01", "2027-01-31"],
  ["2027-02-01", "2027-02-28"],
  ["2027-03-01", "2027-03-31"],
  ["2027-04-01", "2027-04-30"],
  ["2027-05-01", "2027-05-31"],
  ["2027-06-01", "2027-06-30"],
].map(([startDate, endDate], i) => ({
  id: `e0000002-0000-4000-8000-${String(i + 2).padStart(12, "0")}`,
  fiscalYear: 2027,
  periodNo: i + 2,
  startDate,
  endDate,
  status: "OPEN",
  lockedBy: null,
  lockedAt: null,
}));

const ACCOUNTS = [
  {
    id: "f0000001-0000-4000-8000-000000000001",
    code: "1000",
    name: "Cash on Hand",
    accountType: "ASSET",
    parentCode: null,
    system: true,
    systemTag: "CASH",
    active: true,
  },
  {
    id: "f0000001-0000-4000-8000-000000000002",
    code: "4000",
    name: "Sales Revenue",
    accountType: "REVENUE",
    parentCode: null,
    system: true,
    systemTag: "REVENUE",
    active: true,
  },
];

/** Every POST body the screen sent, so the assertion is on the wire, not on a prop. */
let posted: Array<Record<string, unknown>>;

function installHandlers() {
  posted = [];
  server.use(
    http.get(`${API}/api/v1/finance/periods/open`, () =>
      HttpResponse.json({ data: OPEN_PERIODS, meta: null, warnings: [] }),
    ),
    http.get(`${API}/api/v1/finance/accounts/search`, ({ request }) => {
      const q = (new URL(request.url).searchParams.get("q") ?? "").toLowerCase();
      const data = ACCOUNTS.filter(
        (a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
      );
      return HttpResponse.json({ data, meta: { page: 0, size: 20, total: data.length }, warnings: [] });
    }),
    http.post(`${API}/api/v1/finance/journal-entries`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      posted.push(body);
      const lines = (body.lines as Array<Record<string, number | string>>) ?? [];
      return HttpResponse.json({
        data: {
          id: "a0000009-0000-4000-8000-000000000001",
          entryNo: null,
          entryDate: body.entryDate,
          description: body.description,
          status: "DRAFT",
          totalDebitPaisa: lines.reduce((s, l) => s + Number(l.debitPaisa), 0),
          totalCreditPaisa: lines.reduce((s, l) => s + Number(l.creditPaisa), 0),
          lines: lines.map((l, i) => ({
            id: `a0000009-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
            accountCode: String(l.accountCode),
            description: String(l.description ?? ""),
            debitPaisa: Number(l.debitPaisa),
            creditPaisa: Number(l.creditPaisa),
          })),
        },
        meta: null,
        warnings: [],
      });
    }),
  );
}

beforeEach(() => {
  // `shouldAdvanceTime` keeps the 300 ms account-search debounce and RTL's waitFor alive while
  // pinning the wall clock to the walkthrough's day.
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 7, 12, 10, 0, 0) });
  push.mockClear();
  seedSession({ branchId: BRANCH_ID, permissions: ["finance.journal.post", "finance.journal.view"] });
  installHandlers();
});

afterEach(() => {
  vi.useRealTimers();
  clearSession();
});

function renderForm() {
  const Wrapper = createQueryWrapper();
  return render(<JournalEntryForm />, { wrapper: Wrapper });
}

/** Drive the account combobox the way a person does: type, wait, click the row. */
async function chooseAccount(user: ReturnType<typeof userEvent.setup>, lineIndex: number, code: string) {
  const boxes = screen.getAllByPlaceholderText("Search account code or name");
  await user.click(boxes[lineIndex]!);
  await user.type(boxes[lineIndex]!, code);
  const option = await screen.findByText(
    (_content, node) => node?.textContent?.trim() === code && node.tagName === "SPAN",
    {},
    { timeout: 4000 },
  );
  await user.click(option);
}

/**
 * The money boxes, found WITHOUT relying on their labels — the pre-fix screen labelled them
 * "Debit (paisa)" and rendered `type="number"`, so a label-based locator would fail there for the
 * wrong reason and hide whether the arithmetic is right. This matches both shapes, so the only
 * thing that can fail the test below is the number that reaches the wire.
 */
function moneyBoxes(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>("form input")).filter(
    (el) => el.type === "number" || el.inputMode === "decimal",
  );
}

describe("New Journal Entry — the accountant types RUPEES", () => {
  it("labels the money columns in rupees, not paisa", async () => {
    renderForm();
    expect(await screen.findByLabelText("Line 1 debit (Rs)")).toBeInTheDocument();
    expect(screen.getByLabelText("Line 1 credit (Rs)")).toBeInTheDocument();
    expect(screen.queryByText(/paisa/i)).not.toBeInTheDocument();
  });

  it("posts 1,250.50 typed as rupees as 125050 paisa on both sides, and shows Rs 1,250.50", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderForm();

    await screen.findByLabelText("Line 1 debit (Rs)");
    await user.type(
      screen.getByPlaceholderText("Journal entry description"),
      "Owner cash injection",
    );

    await chooseAccount(user, 0, "1000");
    await chooseAccount(user, 1, "4000");

    await user.type(screen.getByLabelText("Line 1 debit (Rs)"), "1250.50");
    await user.type(screen.getByLabelText("Line 2 credit (Rs)"), "1250.50");

    // What the accountant reads back before committing: the running totals, in money.
    await waitFor(() => {
      expect(screen.getAllByText("Rs 1,250.50")).toHaveLength(2);
    });
    expect(screen.getByText("Balanced ✓")).toBeInTheDocument();

    const save = screen.getByRole("button", { name: "Save as Draft" });
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() => expect(posted).toHaveLength(1));
    // The wire is still integer paisa — the unit the SCREEN asks for is what changed.
    expect(posted[0]!.lines).toEqual([
      { accountCode: "1000", description: "", debitPaisa: 125050, creditPaisa: 0 },
      { accountCode: "4000", description: "", debitPaisa: 0, creditPaisa: 125050 },
    ]);
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/app/finance/journal-entries/a0000009-0000-4000-8000-000000000001",
      ),
    );
  });

  /**
   * The 100× test, written so the OLD screen reaches the wire too.
   *
   * "1250.50" is not the right probe for that: `type="number"` with no `step` rejects a fractional
   * value outright (`stepMismatch`), so the old form never submitted at all — the accountant got a
   * native tooltip and a dead button, which is a different failure and one they would at least
   * notice. The silent one is a whole-rupee figure. "1250" clears every constraint the old form
   * had, and `parseInt("1250")` posted 1250 paisa: Rs 12.50 into the general ledger for a
   * Rs 1,250.00 line, balanced, with nothing anywhere to catch it.
   */
  it("a whole-rupee figure typed as 1250 reaches the ledger as Rs 1,250.00, not Rs 12.50", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderForm();

    await screen.findAllByPlaceholderText("Search account code or name");
    await user.type(
      screen.getByPlaceholderText("Journal entry description"),
      "Owner cash injection",
    );
    await chooseAccount(user, 0, "1000");
    await chooseAccount(user, 1, "4000");

    // Positions, not labels: [line1 DR, line1 CR, line2 DR, line2 CR].
    const boxes = moneyBoxes();
    expect(boxes).toHaveLength(4);
    await user.clear(boxes[0]!);
    await user.type(boxes[0]!, "1250");
    await user.clear(boxes[3]!);
    await user.type(boxes[3]!, "1250");

    await user.click(screen.getByRole("button", { name: "Save as Draft" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    const lines = posted[0]!.lines as Array<Record<string, number>>;
    expect(lines[0]!.debitPaisa).toBe(125000);
    expect(lines[1]!.creditPaisa).toBe(125000);
  });

  /**
   * And the decimal case the old form could not accept at all: a fractional `type="number"` is a
   * `stepMismatch`, so the browser refused the submit and the accountant was left with a button
   * that did nothing.
   */
  it("accepts a figure with paisa — the old number input refused 1250.50 outright", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderForm();

    await screen.findAllByPlaceholderText("Search account code or name");
    await user.type(screen.getByPlaceholderText("Journal entry description"), "Bank charges");
    await chooseAccount(user, 0, "1000");
    await chooseAccount(user, 1, "4000");

    const boxes = moneyBoxes();
    await user.clear(boxes[0]!);
    await user.type(boxes[0]!, "1250.50");
    await user.clear(boxes[3]!);
    await user.type(boxes[3]!, "1250.50");
    expect(boxes[0]!.value).toBe("1250.50");

    await user.click(screen.getByRole("button", { name: "Save as Draft" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    const lines = posted[0]!.lines as Array<Record<string, number>>;
    expect(lines[0]!.debitPaisa).toBe(125050);
    expect(lines[1]!.creditPaisa).toBe(125050);
  });

  it("names the field and the real problem when an amount is not a rupee figure", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderForm();

    await user.type(await screen.findByLabelText("Line 2 debit (Rs)"), "12,5o0");
    const alert = await screen.findByTestId("je-line-error-1");
    expect(alert).toHaveTextContent("Line 2 debit: enter the amount in rupees, like 1250.50.");
    expect(screen.getByLabelText("Line 2 debit (Rs)")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Save as Draft" })).toBeDisabled();
  });

  it("refuses a line carrying both a debit and a credit, and says which line", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderForm();

    await user.type(await screen.findByLabelText("Line 1 debit (Rs)"), "100");
    await user.type(screen.getByLabelText("Line 1 credit (Rs)"), "100");

    expect(await screen.findByTestId("je-line-error-0")).toHaveTextContent(
      "Line 1 has both a debit and a credit. Put the amount on one side only.",
    );
    expect(screen.getByRole("button", { name: "Save as Draft" })).toBeDisabled();
  });

  it("says why Save is disabled instead of just greying it out", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderForm();

    await user.type(await screen.findByLabelText("Line 1 debit (Rs)"), "500");
    await waitFor(() =>
      expect(screen.getByTestId("submit-blocked-reason")).toHaveTextContent(
        "Choose an account on every line.",
      ),
    );

    await chooseAccount(user, 0, "1000");
    await chooseAccount(user, 1, "4000");
    await user.type(screen.getByLabelText("Line 2 credit (Rs)"), "400");

    await waitFor(() =>
      expect(screen.getByTestId("submit-blocked-reason")).toHaveTextContent(
        "Debits and credits must be equal before this entry can be saved.",
      ),
    );
    expect(screen.getByRole("button", { name: "Save as Draft" })).toBeDisabled();
  });
});

describe("New Journal Entry — the date it picks, and why", () => {
  it("explains in a sentence that today is outside every open period, before the calendar", async () => {
    renderForm();
    const notice = await screen.findByTestId("entry-date-notice");
    expect(notice).toHaveTextContent("Today, 12 Aug 2026, is past every open accounting period");
    expect(notice).toHaveTextContent("Open periods run 1 Aug 2025 to 30 Jun 2026");
    expect(notice).toHaveTextContent("This entry is dated 30 Jun 2026");
    expect(within(notice).getByRole("link", { name: "Open Periods" })).toHaveAttribute(
      "href",
      "/app/finance/periods",
    );
  });

  it("opens the calendar ON the month it selected, not on the current month", async () => {
    renderForm();
    // The pre-fix picker seeded its month from `value` on the first render — the render where
    // `value` is still "" — and never moved again: heading "August 2026", selection 2025-08-01,
    // nothing highlighted anywhere on screen.
    expect(await screen.findByText("June 2026")).toBeInTheDocument();
    expect(screen.queryByText("August 2026")).not.toBeInTheDocument();
    expect(screen.getByText("Selected:").parentElement).toHaveTextContent("30 Jun 2026");
    expect(screen.getByRole("button", { name: "30 Jun 2026" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("says nothing at all on a day that IS inside an open period", async () => {
    vi.setSystemTime(new Date(2026, 2, 17, 10, 0, 0));
    renderForm();
    await screen.findByText("March 2026");
    expect(screen.queryByTestId("entry-date-notice")).not.toBeInTheDocument();
  });

  /**
   * THE defect, at the screen. This is the live open-periods response verbatim — FY2026 then
   * FY2027 — on the walkthrough's own date. Today is postable and the form must simply say so.
   * The pre-fix form checked only `openPeriods[0]`, concluded today was unpostable and selected
   * 1 Aug 2025 under a calendar headed August 2026.
   */
  it("selects TODAY when a later open period covers it, even though the first one does not", async () => {
    server.use(
      http.get(`${API}/api/v1/finance/periods/open`, () =>
        HttpResponse.json({
          data: [...OPEN_PERIODS, ...OPEN_PERIODS_FY2027],
          meta: null,
          warnings: [],
        }),
      ),
    );
    renderForm();

    // Assert the selection first, and by its rendered text, so this test fails on the pre-fix
    // component for the RIGHT reason: it reads "Selected: 2025-08-01" there.
    const selected = await screen.findByText("Selected:");
    expect(selected.parentElement).toHaveTextContent(/12 Aug 2026|2026-08-12/);
    expect(document.body.textContent).not.toContain("2025-08-01");

    expect(screen.getByText("August 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "12 Aug 2026" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByTestId("entry-date-notice")).not.toBeInTheDocument();
  });

  it("shows a failed open-periods read as a failure, never as 'no periods'", async () => {
    server.use(
      http.get(`${API}/api/v1/finance/periods/open`, () =>
        HttpResponse.json(
          { error: { code: "SERVICE_UNAVAILABLE", message: "boom", details: [], traceId: "t" } },
          { status: 503 },
        ),
      ),
    );
    renderForm();
    // GA-001: this file used to print "No open accounting periods. Seed COA and periods first."
    // for an outage — advice that would be wrong to follow.
    expect(await screen.findByRole("alert", {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText(/Seed COA/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No accounting period is open/i)).not.toBeInTheDocument();
  });
});
