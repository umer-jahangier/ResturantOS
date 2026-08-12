import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { TillSessionBar } from "@/components/pos/till-session-bar";
import type { TillSession } from "@/lib/models/pos.model";

/**
 * F1 — "the cashier counts the drawer blind".
 *
 * Walkthrough §3 #1: the close-till panel showed only *"Opening float: Rs 5,000.00"* against a
 * "Declared Cash Count (PKR)" box — no expected figure and no variance preview — while the green
 * strip ONE LINE ABOVE read `Cash: Rs 6,682.60`. The panel read `activeTill.expectedClosingPaisa`,
 * which `TillServiceImpl.closeTill` only writes DURING the close, so it is structurally NULL at
 * the one moment the cashier needs it. The same component already had the right number in scope
 * (`recon.liveExpectedCashPaisa`, documented on TillReconciliationDto as always computed).
 *
 * These assert what the CASHIER SEES — the rendered text of the panel and its variance line —
 * not which prop the component happens to read. Colour is asserted in Chromium against computed
 * style (jsdom resolves no Tailwind), so here the tone is carried by the accessible wording
 * "short" / "over", which is itself the non-colour signal a colour-blind cashier relies on.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

const TILL_ID = "f1000001-0000-4000-8000-000000000001";
const BRANCH_ID = "b0000001-0000-4000-8000-000000000001";
const CASHIER_ID = "c0000001-0000-4000-8000-000000000001";

/** Exactly the walkthrough's drawer: Rs 5,000.00 float + Rs 1,682.60 cash taken = Rs 6,682.60. */
const OPENING_FLOAT_PAISA = 500_000;
const LIVE_EXPECTED_PAISA = 668_260;

const openTill: TillSession = {
  id: TILL_ID,
  branchId: BRANCH_ID,
  cashierId: CASHIER_ID,
  openingFloatPaisa: OPENING_FLOAT_PAISA,
  // The whole point: the server leaves this NULL until the till is actually closed.
  expectedClosingPaisa: null,
  declaredClosingPaisa: null,
  variancePaisa: null,
  openedAt: "2026-08-12T04:00:00Z",
  closedAt: null,
  status: "OPEN",
  note: null,
  reviewStatus: "PENDING_REVIEW",
};

function reconciliationBody(liveExpectedCashPaisa = LIVE_EXPECTED_PAISA) {
  return {
    data: {
      session: {
        id: TILL_ID,
        branchId: BRANCH_ID,
        cashierId: CASHIER_ID,
        openingFloatPaisa: OPENING_FLOAT_PAISA,
        expectedClosingPaisa: null,
        declaredClosingPaisa: null,
        variancePaisa: null,
        openedAt: "2026-08-12T04:00:00Z",
        closedAt: null,
        status: "OPEN",
        note: null,
        reviewStatus: "PENDING_REVIEW",
      },
      orderCount: 6,
      cashCollectedPaisa: liveExpectedCashPaisa - OPENING_FLOAT_PAISA,
      nonCashCollectedPaisa: 0,
      liveExpectedCashPaisa,
      orders: [],
    },
  };
}

function renderBar(till: TillSession = openTill) {
  seedSession({ sub: CASHIER_ID, branchId: BRANCH_ID, roles: ["CASHIER"] });
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <TillSessionBar activeTill={till} />
    </Wrapper>,
  );
}

async function openClosePanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByTestId("close-till-button"));
  return screen.findByTestId("close-till-panel");
}

afterEach(() => {
  clearSession();
});

describe("close-till panel — the cashier must not count the drawer blind", () => {
  it("names the expected cash on the panel, matching the live strip above it to the paisa", async () => {
    server.use(
      http.get(`*/api/v1/pos/tills/${TILL_ID}/reconciliation`, () =>
        HttpResponse.json(reconciliationBody()),
      ),
    );
    const user = userEvent.setup();
    renderBar();

    // The green strip is the figure the cashier can already see.
    const strip = await screen.findByTestId("till-live-cash");
    expect(strip).toHaveTextContent("Rs 6,682.60");

    const panel = await openClosePanel(user);

    await waitFor(() => {
      expect(within(panel).getByText(/Expected cash/i)).toBeInTheDocument();
    });
    // To the paisa, and the same rendered string as the strip.
    expect(within(panel).getByTestId("close-till-expected")).toHaveTextContent("Rs 6,682.60");
    expect(within(panel).getByText(/Opening float/i)).toBeInTheDocument();
  });

  it("previews a Rs 200 shortage as the cashier types, before anything is submitted", async () => {
    server.use(
      http.get(`*/api/v1/pos/tills/${TILL_ID}/reconciliation`, () =>
        HttpResponse.json(reconciliationBody()),
      ),
    );
    const user = userEvent.setup();
    renderBar();
    const panel = await openClosePanel(user);
    await screen.findByTestId("close-till-expected");

    // Rs 6,682.60 expected, Rs 6,482.60 counted → Rs 200.00 short.
    await user.type(within(panel).getByLabelText(/Declared Cash Count/i), "6482.60");

    const variance = await within(panel).findByTestId("close-till-variance");
    expect(variance).toHaveTextContent("Rs 200.00");
    expect(variance).toHaveTextContent(/short/i);
    expect(variance).not.toHaveTextContent(/over/i);
  });

  it("calls an overage over, and a matched drawer balanced", async () => {
    server.use(
      http.get(`*/api/v1/pos/tills/${TILL_ID}/reconciliation`, () =>
        HttpResponse.json(reconciliationBody()),
      ),
    );
    const user = userEvent.setup();
    renderBar();
    const panel = await openClosePanel(user);
    await screen.findByTestId("close-till-expected");

    const input = within(panel).getByLabelText(/Declared Cash Count/i);
    await user.type(input, "6782.60");
    let variance = await within(panel).findByTestId("close-till-variance");
    expect(variance).toHaveTextContent("Rs 100.00");
    expect(variance).toHaveTextContent(/over/i);

    await user.clear(input);
    await user.type(input, "6682.60");
    variance = await within(panel).findByTestId("close-till-variance");
    expect(variance).toHaveTextContent(/balanced/i);
  });

  it("says the expected figure is unavailable rather than hiding the row when the read fails", async () => {
    server.use(
      http.get(`*/api/v1/pos/tills/${TILL_ID}/reconciliation`, () =>
        HttpResponse.json({ title: "SERVICE_UNAVAILABLE" }, { status: 503 }),
      ),
    );
    const user = userEvent.setup();
    renderBar();
    const panel = await openClosePanel(user);

    const row = await within(panel).findByTestId("close-till-expected");
    expect(row).toHaveTextContent(/unavailable/i);

    // And the variance preview must say why it cannot be shown, not silently vanish.
    await user.type(within(panel).getByLabelText(/Declared Cash Count/i), "6482.60");
    const variance = await within(panel).findByTestId("close-till-variance");
    expect(variance).toHaveTextContent(/can't be checked|cannot be checked/i);
  });

  it("refuses to submit an uncounted drawer instead of silently declaring Rs 0.00", async () => {
    server.use(
      http.get(`*/api/v1/pos/tills/${TILL_ID}/reconciliation`, () =>
        HttpResponse.json(reconciliationBody()),
      ),
    );
    const user = userEvent.setup();
    renderBar();
    const panel = await openClosePanel(user);
    await screen.findByTestId("close-till-expected");

    expect(within(panel).getByTestId("close-till-confirm-button")).toBeDisabled();
    await user.type(within(panel).getByLabelText(/Declared Cash Count/i), "6482.60");
    expect(within(panel).getByTestId("close-till-confirm-button")).toBeEnabled();
  });
});
