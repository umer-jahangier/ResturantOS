import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { TableFloorView } from "@/components/pos/table-floor-view";
import { TABLE_STATUS, TABLE_STATUS_ORDER } from "@/components/pos/table-status-chip";

/**
 * The floor view's state vocabulary and its count line (38-06 task 4 / plan task 6).
 *
 * <h3>The two things being protected</h3>
 *
 * 1. **Every state carries three channels** — icon SHAPE, literal text, hue (UI-SPEC §4.2,
 *    D-38-13). The floor view had this; `/app/tables` did not, and both now read one shared
 *    `TABLE_STATUS` map, so a future state added to either surface cannot be colour-only on one
 *    of them.
 * 2. **The states we cannot show are named, with the reason.** Brief §17 asks for eight; this
 *    branch records three. The alternative — an eight-slot legend where five never light up —
 *    reads as "the restaurant never uses those" rather than "this product cannot see them"
 *    (D-38-16, the Menu Margin Ranking lesson).
 *
 * <h3>Negative controls, observed</h3>
 *
 * 1. **Colour alone.** `TABLE_STATUS.NEEDS_BUSSING.label` was blanked, leaving the tint and the
 *    border as the only signal → RED on the text-content channel. Restored.
 * 2. **A summary that does not reconcile.** The per-status count was swapped for `summary.total`
 *    → RED, with the received line printed in full:
 *    *"3 tables·3 available·3 occupied·3 needs bussing·4 seats free"* against an expectation of
 *    `1 occupied`. Note that the TOTAL stayed right — which is exactly how a subtitle drifts
 *    from its table without anyone noticing. Restored.
 * 3. **Silent unavailability.** `FloorPlanScopeNote` was switched off → RED:
 *    *"Unable to find an element by: [data-testid=\"floor-scope-note\"]"*. An absent limitation
 *    is indistinguishable from an absent feature, which is the whole point. Restored.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

const BRANCH_ID = "b0000001-0000-4000-8000-000000000001";
const T_FREE = "11111111-1111-4111-8111-111111111111";
const T_BUSY = "22222222-2222-4222-8222-222222222222";
const T_BUS = "33333333-3333-4333-8333-333333333333";

function rawTables() {
  return [
    {
      id: T_FREE,
      branchId: BRANCH_ID,
      tableName: "R1",
      capacity: 4,
      section: "Rooftop",
      active: true,
      status: "AVAILABLE",
      floorPlanX: null,
      floorPlanY: null,
      floorPlanShape: null,
    },
    {
      id: T_BUSY,
      branchId: BRANCH_ID,
      tableName: "R2",
      capacity: 2,
      section: "Rooftop",
      active: true,
      status: "OCCUPIED",
      floorPlanX: null,
      floorPlanY: null,
      floorPlanShape: null,
    },
    {
      id: T_BUS,
      branchId: BRANCH_ID,
      tableName: "G1",
      capacity: 6,
      section: null,
      active: true,
      status: "NEEDS_BUSSING",
      floorPlanX: null,
      floorPlanY: null,
      floorPlanShape: null,
    },
  ];
}

function renderFloor() {
  server.use(
    http.get("*/api/v1/pos/tables", () =>
      HttpResponse.json({ data: rawTables(), meta: null, warnings: [] }),
    ),
    http.get(`*/api/v1/pos/tables/${T_BUSY}/active-order`, () =>
      HttpResponse.json({
        data: {
          id: T_BUSY,
          branchId: BRANCH_ID,
          tableName: "R2",
          capacity: 2,
          status: "OCCUPIED",
          floorPlanX: null,
          floorPlanY: null,
          floorPlanShape: null,
          activeOrder: {
            id: "d1000001-0000-4000-8000-000000000001",
            branchId: BRANCH_ID,
            orderNo: "ORD-1",
            type: "DINE_IN",
            status: "OPEN",
            derivedStatus: "IN_PROGRESS",
            tableId: T_BUSY,
            coverCount: 2,
            cashierId: "c0000001-0000-4000-8000-000000000001",
            customerId: null,
            subtotalPaisa: 60000,
            taxPaisa: 3000,
            discountPaisa: 0,
            serviceChargePaisa: 0,
            serviceChargePct: 0,
            serviceChargeLabel: null,
            totalPaisa: 63000,
            notes: null,
            // Twelve and a half minutes ago: inside the urgency window, so the tile shows a
            // running `mm:ss` timer. The half-minute keeps the assertion off a boundary that a
            // slow test machine would tip to `11:59`.
            openedAt: new Date(Date.now() - (12 * 60 + 30) * 1000).toISOString(),
            sentToKdsAt: null,
            clientOrderId: "c9000001-0000-4000-8000-000000000001",
            version: 1,
            items: [],
          },
          derivedStatus: "IN_PROGRESS",
          cashierId: null,
          subtotalPaisa: 60000,
          discountPaisa: 0,
          taxPaisa: 3000,
          totalPaisa: 63000,
        },
        meta: null,
        warnings: [],
      }),
    ),
  );
  seedSession({ branchId: BRANCH_ID, permissions: ["pos.order.close"] });
  const Wrapper = createQueryWrapper();
  render(
    <Wrapper>
      <TableFloorView />
    </Wrapper>,
  );
}

describe("TableFloorView — states, counts and stated unavailability (38-06)", () => {
  afterEach(() => clearSession());

  it("every state carries an icon, a word and a hue — never hue alone", async () => {
    renderFloor();
    await waitFor(() => expect(screen.getByTestId("table-r1")).toBeInTheDocument());

    for (const [testId, status] of [
      ["table-r1", "AVAILABLE"],
      ["table-r2", "OCCUPIED"],
      ["table-g1", "NEEDS_BUSSING"],
    ] as const) {
      const tile = screen.getByTestId(testId);
      const descriptor = TABLE_STATUS[status];
      // Channel 1 — the literal word.
      expect(tile).toHaveTextContent(descriptor.label);
      // Channel 2 — a distinct icon shape. lucide stamps the icon name onto the class list, so
      // this asserts the SHAPE is different per state rather than that "an svg exists".
      expect(tile.querySelector("svg")?.getAttribute("class")).toContain("lucide-");
      // Channel 3 — the hue, and it is a semantic token, never a raw palette literal.
      expect(tile.className).toContain(descriptor.border);
      expect(tile.className).toContain(descriptor.tint);
      expect(tile.className).not.toMatch(/\b(?:green|amber|orange|blue|teal|emerald)-\d{2,3}\b/);
    }

    // The three icons are three DIFFERENT shapes. A shared icon would satisfy every assertion
    // above and carry no information.
    const icons = TABLE_STATUS_ORDER.map((s) => TABLE_STATUS[s].icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("keeps the 80px touch tile — the demo's 38px chip strip is not adopted", async () => {
    renderFloor();
    await waitFor(() => expect(screen.getByTestId("table-r1")).toBeInTheDocument());
    // WCAG 2.2 SC 2.5.5. jsdom computes no layout, so the contract is asserted on the class that
    // sets it — which is also the thing a "tidy-up" would delete.
    expect(screen.getByTestId("table-r1").className).toContain("min-h-[80px]");
  });

  it("the count line reconciles with the tiles beneath it", async () => {
    renderFloor();
    await waitFor(() => expect(screen.getByTestId("table-r1")).toBeInTheDocument());

    const line = screen.getByTestId("floor-stat-line");
    expect(line).toHaveTextContent("3 tables");
    expect(line).toHaveTextContent("1 available");
    expect(line).toHaveTextContent("1 occupied");
    expect(line).toHaveTextContent("1 needs bussing");
    // Seats free is the capacity of exactly the tiles reading "Available" — R1 seats 4.
    expect(line).toHaveTextContent("4 seats free");
  });

  it("groups by section, with unsectioned tables last", async () => {
    renderFloor();
    const rooftop = await screen.findByRole("region", { name: "Rooftop section" });
    expect(within(rooftop).getByTestId("table-r1")).toBeInTheDocument();
    expect(within(rooftop).getByTestId("table-r2")).toBeInTheDocument();
    expect(within(rooftop).queryByTestId("table-g1")).toBeNull();

    const other = screen.getByRole("region", { name: "Other tables section" });
    expect(within(other).getByTestId("table-g1")).toBeInTheDocument();
  });

  it("an occupied tile shows the age of the CHECK and its running bill, both from real data", async () => {
    renderFloor();
    const tile = await screen.findByTestId("table-r2");

    // The bill, through the one money path in the product.
    await waitFor(() => expect(tile).toHaveTextContent("Rs 630.00"));
    // The elapsed timer, bounded by `lib/format/elapsed.ts` — 12 minutes reads `mm:ss`.
    expect(tile.textContent).toMatch(/12:\d{2}/);
    // …and it is announced in words, never as the compact form, which a screen reader would
    // read as a clock time.
    expect(within(tile).getByText(/12 minutes/)).toBeInTheDocument();
  });

  it("names the states it cannot show, and why — never a blank badge or a zero", async () => {
    renderFloor();
    const note = await screen.findByTestId("floor-scope-note");

    expect(note).toHaveTextContent(/Reserved and Out of service are not shown/i);
    expect(note).toHaveTextContent(/pos-service stores neither/i);
    // The distinction that would otherwise be a silent lie: this is the CHECK's age, and this
    // product does not know when the party sat down.
    expect(note).toHaveTextContent(/not how long the party has been seated/i);
    expect(note).toHaveTextContent(/seat time and server assignment are not recorded/i);
  });
});
