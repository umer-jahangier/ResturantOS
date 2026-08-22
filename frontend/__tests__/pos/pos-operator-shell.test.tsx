import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/app/pos",
}));

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { OperatorStrip, isOperatorRoute } from "@/components/pos/operator-strip";
import { PosTerminal } from "@/components/pos/pos-terminal";

/**
 * 38-04 tasks 1 and 5 — the operator shell, and the 390px order sheet.
 *
 * <p>UI-SPEC §4.1 calls collapsing the back-office chrome on the POS route "the single biggest
 * structural change" in the phase; before this it had never been built, and the terminal rendered
 * inside a 255px sidebar, an `App › POS` breadcrumb and a global search box. The route predicate
 * is asserted directly because it is the whole switch: get it wrong and either a cashier keeps the
 * sidebar or the back office loses its navigation.
 */

const BRANCH_ID = "b1000001-0000-4000-8000-000000000001";
const CATEGORY_ID = "c1000001-0000-4000-8000-000000000001";

function seedPosApi(opts: { tillOpen?: boolean; tillFails?: boolean } = {}) {
  server.use(
    http.get("*/api/v1/branches/mine", () =>
      HttpResponse.json({
        data: [{ id: BRANCH_ID, name: "Terrace — Gulberg", hq: false, roleCode: "CASHIER" }],
        meta: null,
        warnings: [],
      }),
    ),
    http.get("*/api/v1/pos/tills", () => {
      if (opts.tillFails) return new HttpResponse(null, { status: 503 });
      return HttpResponse.json({
        data: opts.tillOpen
          ? [
              {
                id: "d1000001-0000-4000-8000-000000000001",
                branchId: BRANCH_ID,
                cashierId: "e1000001-0000-4000-8000-000000000001",
                status: "OPEN",
                openingFloatPaisa: 500000,
                openedAt: "2026-08-21T09:00:00Z",
                reviewStatus: "PENDING_REVIEW",
              },
            ]
          : [],
        meta: null,
        warnings: [],
      });
    }),
    http.get("*/api/v1/pos/menu/categories", () =>
      HttpResponse.json({
        data: [{ id: CATEGORY_ID, name: "Mains", description: null, sortOrder: 1, active: true }],
        meta: null,
        warnings: [],
      }),
    ),
    http.get("*/api/v1/pos/menu/items", () =>
      HttpResponse.json({
        data: [
          {
            id: "a1000001-0000-4000-8000-000000000001",
            categoryId: CATEGORY_ID,
            name: "Mutton Karahi",
            description: null,
            basePricePaisa: 120000,
            taxRatePct: "5",
            kdsStation: "GRILL",
            active: true,
          },
        ],
        meta: null,
        warnings: [],
      }),
    ),
  );
}

describe("isOperatorRoute — which routes lose the back-office shell", () => {
  it("claims the whole POS family and nothing that merely starts with the same letters", () => {
    expect(isOperatorRoute("/app/pos")).toBe(true);
    expect(isOperatorRoute("/app/pos/tills")).toBe(true);
    expect(isOperatorRoute("/app/pos/orders/abc/charge")).toBe(true);
    expect(isOperatorRoute("/app/pos/orders/abc/receipt")).toBe(true);

    // The boundary is the reason this is not a bare startsWith. A future /app/postmortem or
    // /app/positions must keep its navigation, and finding that out from a user is expensive.
    expect(isOperatorRoute("/app/postmortem")).toBe(false);
    expect(isOperatorRoute("/app/dashboard")).toBe(false);
    expect(isOperatorRoute(null)).toBe(false);
  });
});

describe("OperatorStrip", () => {
  afterEach(() => clearSession());

  it("carries the four things a cashier needs and none of the back office", async () => {
    seedSession({ branchId: BRANCH_ID, permissions: ["pos.order.update"] });
    seedPosApi({ tillOpen: true });
    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <OperatorStrip />
      </Wrapper>,
    );

    // Branch — read-only. A branch SWITCHER mid-till is how takings land against the wrong shop.
    await waitFor(() =>
      expect(screen.getByTestId("pos-operator-branch")).toHaveTextContent("Terrace — Gulberg"),
    );
    expect(screen.getByTestId("pos-operator-branch").querySelector("button")).toBeNull();

    // Till state, and the way out.
    await waitFor(() =>
      expect(screen.getByTestId("pos-operator-till")).toHaveAttribute("data-till-state", "open"),
    );
    expect(screen.getByTestId("pos-operator-till")).toHaveTextContent(/Till open|open/i);
    expect(screen.getByTestId("pos-operator-exit")).toHaveAttribute("href", "/app/dashboard");

    // Nothing that belongs to the back office.
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument();
  });

  it("distinguishes a till that is CLOSED from a till service that did not answer", async () => {
    seedSession({ branchId: BRANCH_ID, permissions: ["pos.order.update"] });
    seedPosApi({ tillFails: true });
    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <OperatorStrip />
      </Wrapper>,
    );

    /*
     * S1-09, restated on new chrome. A failed read and a resolved "no open till" both leave
     * `data` undefined, so a chip that read `data` alone would tell a cashier their drawer was
     * closed while the service was merely unreachable — and send them to press Open Till, which
     * can only fail too.
     */
    await waitFor(
      () =>
        expect(screen.getByTestId("pos-operator-till")).toHaveAttribute(
          "data-till-state",
          "unavailable",
        ),
      { timeout: 5000 },
    );
    expect(screen.getByTestId("pos-operator-till")).toHaveTextContent(/unavailable/i);
  });
});

describe("PosTerminal — the 390px order sheet", () => {
  afterEach(() => clearSession());

  it("keeps a running total on the glass and raises the order on demand", async () => {
    seedSession({ branchId: BRANCH_ID, permissions: ["pos.order.update"] });
    seedPosApi({ tillOpen: true });
    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <PosTerminal />
      </Wrapper>,
    );

    /*
     * Asserted on the SHEET'S OWN CLASS rather than on whether its children exist, because in
     * jsdom they always exist — the panel is one mounted instance whose container is `hidden`
     * below `lg` until raised, precisely so there is never a second cart implementation for
     * phone widths to disagree with the first. `getAllByTestId("order-panel")` proving there is
     * exactly one is the assertion that keeps that true.
     */
    const bar = await screen.findByTestId("pos-order-summary-bar");
    expect(bar).toHaveTextContent("No items yet");
    expect(screen.getByTestId("pos-order-sheet")).toHaveAttribute("data-sheet-open", "false");
    expect(screen.getAllByTestId("order-panel")).toHaveLength(1);

    const user = userEvent.setup();
    await user.click(screen.getByTestId("pos-order-sheet-open"));

    expect(screen.getByTestId("pos-order-sheet")).toHaveAttribute("data-sheet-open", "true");
    // The persistent bar yields to the sheet — one total on screen, never two.
    expect(screen.queryByTestId("pos-order-summary-bar")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("pos-order-sheet-close"));
    expect(await screen.findByTestId("pos-order-summary-bar")).toBeInTheDocument();
    expect(screen.getByTestId("pos-order-sheet")).toHaveAttribute("data-sheet-open", "false");
  });

  it("quotes the cart's total on the bar, from the same composition the panel uses", async () => {
    seedSession({ branchId: BRANCH_ID, permissions: ["pos.order.update"] });
    seedPosApi({ tillOpen: true });
    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <PosTerminal />
      </Wrapper>,
    );

    const user = userEvent.setup();
    await user.click(await screen.findByTestId("menu-item-first"));

    // Rs 1,200.00 + 5% tax = Rs 1,260.00. The assertion that matters is not the arithmetic — it
    // is that the bar and the panel print the same string, because they compose it once
    // (`cartEstimatedTotalPaisa`). D-3's 5% shortfall was two surfaces composing it twice.
    const bar = await screen.findByTestId("pos-order-summary-bar");
    await waitFor(() => expect(bar).toHaveTextContent("1 item"));
    const barTotal = bar.textContent ?? "";
    expect(barTotal).toMatch(/Rs\s*1,260\.00/);
  });
});
