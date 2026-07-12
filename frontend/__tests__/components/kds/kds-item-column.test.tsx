import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import {
  KdsItemColumn,
  groupTicketsByColumn,
  mapItemStatusToColumn,
  type KdsColumnKey,
} from "@/components/kds/kds-item-column";
import type { KdsTicket, KdsTicketItem } from "@/lib/models/kds.model";

// kds-item-column.test.tsx — TDD RED/GREEN proof for the New/Started/Preparing/Ready
// item-status column grouping + column move action (KDS-04/D-12, 07.3-10 Task 2).

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));

const BRANCH_ID = "b0000001-0000-4000-8000-000000000001";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<KdsTicketItem> = {}): KdsTicketItem {
  return {
    id: "53000001-0000-4000-8000-000000000001",
    orderItemId: "54000001-0000-4000-8000-000000000001",
    name: "Chicken Burger",
    qty: 1,
    modifiers: [],
    notes: null,
    status: "PENDING",
    revisionNo: 1,
    firedAt: null,
    ...overrides,
  };
}

function makeTicket(overrides: Partial<KdsTicket> = {}): KdsTicket {
  return {
    id: "51000001-0000-4000-8000-000000000001",
    orderId: "52000001-0000-4000-8000-000000000001",
    orderNo: "ORD-001",
    stationCode: "GRILL",
    status: "PENDING",
    priority: false,
    receivedAt: new Date(Date.now() - 5 * 60_000),
    startedAt: null,
    readyAt: null,
    orderNotes: null,
    tableNumber: "12",
    items: [makeItem()],
    ...overrides,
  };
}

/** Wire-shape (raw API) response body for a mocked POST .../status response. */
function rawTicket(ticket: KdsTicket) {
  return {
    id: ticket.id,
    orderId: ticket.orderId,
    orderNo: ticket.orderNo,
    stationCode: ticket.stationCode,
    status: ticket.status,
    priority: ticket.priority,
    receivedAt: ticket.receivedAt.toISOString(),
    startedAt: ticket.startedAt ? ticket.startedAt.toISOString() : null,
    readyAt: ticket.readyAt ? ticket.readyAt.toISOString() : null,
    orderNotes: ticket.orderNotes,
    tableNumber: ticket.tableNumber,
    items: ticket.items.map((item) => ({
      id: item.id,
      orderItemId: item.orderItemId,
      name: item.name,
      qty: item.qty,
      modifiers: item.modifiers,
      notes: item.notes,
      status: item.status,
      revisionNo: item.revisionNo,
      firedAt: item.firedAt,
    })),
  };
}

function renderColumn(column: KdsColumnKey, tickets: KdsTicket[], canUpdate = true) {
  seedSession({ permissions: canUpdate ? ["pos.kds.view", "pos.kds.update"] : ["pos.kds.view"] });
  return render(
    <KdsItemColumn column={column} tickets={tickets} branchId={BRANCH_ID} canUpdate={canUpdate} />,
    { wrapper: createQueryWrapper() },
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("mapItemStatusToColumn / groupTicketsByColumn — status->column mapping (KDS-04)", () => {
  it("maps PENDING->NEW, ACCEPTED->STARTED, PREPARING/COOKING->PREPARING, READY->READY", () => {
    expect(mapItemStatusToColumn("PENDING")).toBe("NEW");
    expect(mapItemStatusToColumn("ACCEPTED")).toBe("STARTED");
    expect(mapItemStatusToColumn("PREPARING")).toBe("PREPARING");
    expect(mapItemStatusToColumn("COOKING")).toBe("PREPARING");
    expect(mapItemStatusToColumn("READY")).toBe("READY");
  });

  it("groups a mixed-status order's items into their respective columns (item-centric board)", () => {
    // Burger PREPARING + Fries ACCEPTED + Coke READY on ONE order — must appear in
    // the Preparing, Started, and Ready columns respectively (never merged/lost).
    const ticket = makeTicket({
      items: [
        makeItem({ id: "burger-id-0000-4000-8000-000000000001", name: "Burger", status: "PREPARING" }),
        makeItem({ id: "fries-id-0000-4000-8000-000000000002", name: "Fries", status: "ACCEPTED" }),
        makeItem({ id: "coke-id-00000-4000-8000-000000000003", name: "Coke", status: "READY" }),
      ],
    });

    expect(groupTicketsByColumn([ticket], "PREPARING")[0]?.items.map((i) => i.name)).toEqual(["Burger"]);
    expect(groupTicketsByColumn([ticket], "STARTED")[0]?.items.map((i) => i.name)).toEqual(["Fries"]);
    expect(groupTicketsByColumn([ticket], "READY")[0]?.items.map((i) => i.name)).toEqual(["Coke"]);
    expect(groupTicketsByColumn([ticket], "NEW")).toEqual([]);
  });
});

describe("KdsItemColumn — column rendering + slim card content (KDS-04)", () => {
  afterEach(() => clearSession());

  it("renders only PENDING items in the New column, excluding a READY sibling item", () => {
    const ticket = makeTicket({
      items: [
        makeItem({ id: "55000001-0000-4000-8000-000000000001", name: "Naan", status: "PENDING" }),
        makeItem({ id: "56000001-0000-4000-8000-000000000001", name: "Karahi", status: "READY" }),
      ],
    });

    renderColumn("NEW", [ticket]);

    // Scope to the collapsed card — the column's own move-action button also
    // renders the item name as its label ("Naan → Started"), so an unscoped
    // getByText(/Naan/) would (correctly) match both.
    const card = screen.getByTestId("kds-ticket-card");
    expect(within(card).getByText(/Naan/)).toBeInTheDocument();
    expect(within(card).queryByText(/Karahi/)).not.toBeInTheDocument();
  });

  it("the card fragment shows order number, table, age, and item names only — no status badge or bump button", () => {
    const ticket = makeTicket({
      orderNo: "ORD-042",
      tableNumber: "7",
      items: [makeItem({ id: "57000001-0000-4000-8000-000000000001", name: "Naan", status: "PENDING" })],
    });

    renderColumn("NEW", [ticket]);

    const card = screen.getByTestId("kds-ticket-card");
    expect(within(card).getByText("ORD-042")).toBeInTheDocument();
    expect(within(card).getByText(/Table 7/)).toBeInTheDocument();
    expect(within(card).getByText(/Naan/)).toBeInTheDocument();
    // No collapsed-card StatusBadge (would render an aria-label like "Pending").
    expect(within(card).queryByLabelText("Pending")).not.toBeInTheDocument();
    // No collapsed-card bump button (old bump-btn-* testid from the pre-revamp card).
    expect(within(card).queryByTestId(/^bump-btn-/)).not.toBeInTheDocument();
  });
});

describe("KdsItemColumn — move action calls useUpdateItemStatus (KDS-04)", () => {
  afterEach(() => clearSession());

  it("moving a PENDING item in the New column posts status=ACCEPTED to the item-status endpoint", async () => {
    const itemId = "58000001-0000-4000-8000-000000000001";
    const item = makeItem({ id: itemId, name: "Naan", status: "PENDING" });
    const ticket = makeTicket({ items: [item] });

    let capturedBody: unknown = null;
    server.use(
      http.post(
        `*/api/v1/kitchen/kds/tickets/${ticket.id}/items/${itemId}/status`,
        async ({ request }) => {
          capturedBody = await request.json();
          const accepted = { ...ticket, items: [{ ...item, status: "ACCEPTED" as const }] };
          return HttpResponse.json(rawTicket(accepted));
        },
      ),
    );

    renderColumn("NEW", [ticket]);
    const user = userEvent.setup();
    await user.click(screen.getByTestId(`column-move-${itemId}`));

    await waitFor(() => {
      expect(capturedBody).toEqual({ status: "ACCEPTED" });
    });
  });

  it("hides the move action when the user lacks pos.kds.update", () => {
    const itemId = "59000001-0000-4000-8000-000000000001";
    const ticket = makeTicket({ items: [makeItem({ id: itemId, status: "PENDING" })] });

    renderColumn("NEW", [ticket], false);

    expect(screen.queryByTestId(`column-move-${itemId}`)).not.toBeInTheDocument();
  });
});
