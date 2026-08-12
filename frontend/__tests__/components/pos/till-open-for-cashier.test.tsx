import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { TillReview } from "@/components/pos/till-review";

/**
 * F11 — "a manager cannot open a till for anyone but themselves".
 *
 * <p>Walkthrough §0: the manager counted a Rs 5,000.00 float and the cashier's terminal still read
 * "No active till", because `openTill` bound the session to whoever pressed the button. There was
 * no screen anywhere in the product that could name a different cashier.
 *
 * <p>Every assertion below is on what the MANAGER SEES and CLICKS — the button, the picker's
 * labels, the validation text, the sentence they sign off, the refusal — never on a component's
 * props. Without the fix there is no "Open a drawer" button to click at all, so the very first
 * test fails on `findByTestId`.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

const BRANCH_ID = "b0000001-0000-4000-8000-000000000001";
const MANAGER_ID = "11111111-0000-4000-8000-000000000001";
const CASHIER_ID = "22222222-0000-4000-8000-000000000002";
const BUSY_CASHIER_ID = "33333333-0000-4000-8000-000000000003";

const MANAGER_PERMISSIONS = [
  "pos.till.open",
  "pos.till.close",
  "pos.till.review",
  "pos.till.open.other",
];

/** A branch with nobody holding a drawer yet, plus one cashier who already has one. */
const ELIGIBLE = [
  {
    userId: CASHIER_ID,
    name: "Shift Cashier",
    email: "shift.cashier@terrace.local",
    roleCode: "CASHIER",
    hasOpenTill: false,
  },
  {
    userId: BUSY_CASHIER_ID,
    name: "Late Cashier",
    email: "late.cashier@terrace.local",
    roleCode: "CASHIER",
    hasOpenTill: true,
  },
];

function emptyTillPage() {
  return HttpResponse.json({
    data: [],
    meta: { page: { cursor: "0", nextCursor: null, size: 20 }, totalCount: 0 },
    warnings: [],
  });
}

function renderReview(permissions: string[] = MANAGER_PERMISSIONS) {
  seedSession({
    sub: MANAGER_ID,
    branchId: BRANCH_ID,
    roles: ["MANAGER"],
    permissions,
  });
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <TillReview />
    </Wrapper>,
  );
}

function stubBranchTills() {
  server.use(http.get("*/api/v1/pos/tills", () => emptyTillPage()));
}

function stubEligible(rows: typeof ELIGIBLE = ELIGIBLE) {
  server.use(
    http.get("*/api/v1/pos/tills/cashiers", () =>
      HttpResponse.json({ data: rows, meta: null, warnings: [] }),
    ),
  );
}

async function openThePanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId("open-drawer-for-cashier-button"));
  return screen.findByTestId("open-drawer-panel");
}

afterEach(() => {
  clearSession();
});

describe("Till Review — the duty manager hands a drawer over", () => {
  it("opens a Rs 5,000.00 float for a NAMED cashier and posts that cashier's id", async () => {
    stubBranchTills();
    stubEligible();
    let posted: Record<string, unknown> | null = null;
    server.use(
      http.post("*/api/v1/pos/tills", async ({ request }) => {
        posted = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          {
            data: {
              id: "77777777-0000-4000-8000-000000000007",
              branchId: BRANCH_ID,
              cashierId: CASHIER_ID,
              openingFloatPaisa: 500_000,
              expectedClosingPaisa: null,
              declaredClosingPaisa: null,
              variancePaisa: null,
              status: "OPEN",
              openedAt: "2026-08-12T04:00:00Z",
              closedAt: null,
              note: null,
              reviewStatus: "PENDING_REVIEW",
            },
            meta: null,
            warnings: [],
          },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    renderReview();
    const panel = await openThePanel(user);

    // The picker is REAL data — the person is chosen by name, not by pasting a uuid.
    const select = within(panel).getByTestId("open-drawer-cashier-select");
    await waitFor(() => {
      expect(within(select).getByRole("option", { name: /Shift Cashier/ })).toBeInTheDocument();
    });

    await user.selectOptions(select, CASHIER_ID);
    await user.type(within(panel).getByTestId("open-drawer-float-input"), "5000.00");

    // The sentence the manager signs off, before they press anything.
    const summary = await within(panel).findByTestId("open-drawer-summary");
    expect(summary).toHaveTextContent("Rs 5,000.00");
    expect(summary).toHaveTextContent("Shift Cashier");

    await user.click(within(panel).getByTestId("open-drawer-confirm-button"));

    await waitFor(() => expect(posted).not.toBeNull());
    // THE FINDING: the drawer is opened for the cashier, and the float is exact paisa.
    expect(posted).toMatchObject({
      branchId: BRANCH_ID,
      cashierId: CASHIER_ID,
      openingFloatPaisa: 500_000,
    });
    // …and NOT for the manager who pressed the button.
    expect((posted as unknown as { cashierId: string }).cashierId).not.toBe(MANAGER_ID);
  });

  it("says who already holds a drawer, and refuses to open a second one for them", async () => {
    stubBranchTills();
    stubEligible();
    const user = userEvent.setup();
    renderReview();
    const panel = await openThePanel(user);

    const select = within(panel).getByTestId("open-drawer-cashier-select");
    await waitFor(() => {
      expect(within(select).getByRole("option", { name: /Late Cashier/ })).toBeInTheDocument();
    });
    // The picker itself says so, before anything is typed.
    expect(within(select).getByRole("option", { name: /Late Cashier/ })).toHaveTextContent(
      /already has a drawer/i,
    );

    await user.selectOptions(select, BUSY_CASHIER_ID);
    await user.type(within(panel).getByTestId("open-drawer-float-input"), "5000.00");

    const error = await within(panel).findByTestId("open-drawer-cashier-error");
    expect(error).toHaveTextContent("Late Cashier already has an open till");
    expect(within(panel).getByTestId("open-drawer-confirm-button")).toBeDisabled();
  });

  it("names the field and the real problem when the float is not an amount", async () => {
    stubBranchTills();
    stubEligible();
    const user = userEvent.setup();
    renderReview();
    const panel = await openThePanel(user);

    await user.type(within(panel).getByTestId("open-drawer-float-input"), "-50");

    const error = await within(panel).findByTestId("open-drawer-float-error");
    expect(error).toHaveTextContent(/Opening float/i);
    expect(error).toHaveTextContent(/no negatives/i);
    expect(within(panel).getByTestId("open-drawer-confirm-button")).toBeDisabled();
  });

  it("shows the server's own refusal rather than a generic failure", async () => {
    stubBranchTills();
    stubEligible();
    server.use(
      http.post("*/api/v1/pos/tills", () =>
        HttpResponse.json(
          {
            title: "CASHIER_NOT_ELIGIBLE_FOR_TILL",
            detail:
              "Shift Cashier cannot be given a till at this branch: their role here does not allow running a cash drawer.",
            status: 422,
          },
          { status: 422, headers: { "Content-Type": "application/problem+json" } },
        ),
      ),
    );

    const user = userEvent.setup();
    renderReview();
    const panel = await openThePanel(user);

    await waitFor(() => {
      expect(
        within(panel)
          .getByTestId("open-drawer-cashier-select")
          .querySelector(`option[value="${CASHIER_ID}"]`),
      ).not.toBeNull();
    });
    await user.selectOptions(within(panel).getByTestId("open-drawer-cashier-select"), CASHIER_ID);
    await user.type(within(panel).getByTestId("open-drawer-float-input"), "5000.00");
    await user.click(within(panel).getByTestId("open-drawer-confirm-button"));

    const banner = await within(panel).findByTestId("open-drawer-error");
    expect(banner).toHaveTextContent(/does not allow running a cash drawer/i);
  });

  it("an empty roster reads as an empty roster, never as a broken screen", async () => {
    stubBranchTills();
    stubEligible([]);
    const user = userEvent.setup();
    renderReview();
    const panel = await openThePanel(user);

    const note = await within(panel).findByTestId("open-drawer-no-cashiers");
    expect(note).toHaveTextContent(/Nobody at this branch can run a cash drawer yet/i);
    expect(within(panel).queryByText(/Could not load the options/i)).not.toBeInTheDocument();
  });

  it("a failed roster read is an error with a retry, NOT an empty dropdown", async () => {
    stubBranchTills();
    server.use(
      http.get("*/api/v1/pos/tills/cashiers", () =>
        HttpResponse.json({ title: "SERVICE_UNAVAILABLE", status: 503 }, { status: 503 }),
      ),
    );
    const user = userEvent.setup();
    renderReview();
    const panel = await openThePanel(user);

    // An empty picker would say "there are no cashiers here", which is a different and much more
    // damaging statement than "this did not load".
    expect(await within(panel).findByText(/Could not load the options/i)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: /Try again/i })).toBeInTheDocument();
    expect(within(panel).queryByTestId("open-drawer-no-cashiers")).not.toBeInTheDocument();
  });

  it("a cashier is never shown the button at all", async () => {
    stubBranchTills();
    stubEligible();
    // The permission a CASHIER actually holds — pos.till.open, and not pos.till.open.other.
    renderReview(["pos.till.open", "pos.till.close", "pos.till.review"]);

    await screen.findByText(/Till Review/i);
    expect(screen.queryByTestId("open-drawer-for-cashier-button")).not.toBeInTheDocument();
  });
});
