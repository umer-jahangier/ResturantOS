import { describe, it, expect, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { KdsTicketCard } from "@/components/kds/kds-ticket-card";
import type { KdsTicket, KdsTicketItem } from "@/lib/models/kds.model";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<KdsTicketItem> = {}): KdsTicketItem {
  return {
    id: "d0000001-0000-4000-8000-000000000001",
    orderItemId: "d0000002-0000-4000-8000-000000000002",
    name: "Chicken Karahi",
    qty: 2,
    modifiers: ["Extra Spicy"],
    notes: null,
    status: "PENDING",
    revisionNo: 1,
    firedAt: null,
    ...overrides,
  };
}

function makeTicket(overrides: Partial<KdsTicket> = {}): KdsTicket {
  return {
    id: "d0000003-0000-4000-8000-000000000003",
    orderId: "d0000004-0000-4000-8000-000000000004",
    orderNo: "ORD-001",
    stationCode: "GRILL",
    status: "PENDING",
    priority: false,
    receivedAt: new Date(Date.now() - 5 * 60_000),
    startedAt: null,
    readyAt: null,
    orderNotes: null,
    tableNumber: null,
    items: [makeItem()],
    ...overrides,
  };
}

function renderCard(ticket: KdsTicket, canUpdate = true) {
  seedSession({ permissions: canUpdate ? ["pos.kds.view", "pos.kds.update"] : ["pos.kds.view"] });
  return render(
    <KdsTicketCard ticket={ticket} branchId="branch-1" canUpdate={canUpdate} />,
    { wrapper: createQueryWrapper() },
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("KdsTicketCard — revision pill placement", () => {
  afterEach(() => clearSession());

  it('shows the "REV 2" pill on a Rev 2+ item', () => {
    const ticket = makeTicket({
      items: [makeItem({ name: "Rev 2 Item", revisionNo: 2 })],
    });

    renderCard(ticket);

    expect(screen.getByText("REV 2")).toBeInTheDocument();
  });

  it("renders no revision pill for a Rev 1 item", () => {
    const ticket = makeTicket({
      items: [makeItem({ name: "Rev 1 Item", revisionNo: 1 })],
    });

    renderCard(ticket);

    expect(screen.queryByText(/^REV \d+$/)).not.toBeInTheDocument();
  });

  it("shows the pill only on the Rev 2+ item, not on a Rev 1 sibling item", () => {
    const ticket = makeTicket({
      items: [
        makeItem({
          id: "d0000005-0000-4000-8000-000000000005",
          name: "Rev 1 Item",
          revisionNo: 1,
        }),
        makeItem({
          id: "d0000006-0000-4000-8000-000000000006",
          name: "Rev 3 Item",
          revisionNo: 3,
        }),
      ],
    });

    renderCard(ticket);

    expect(screen.getAllByText(/^REV \d+$/)).toHaveLength(1);
    expect(screen.getByText("REV 3")).toBeInTheDocument();
  });

  it("renders a per-item status badge (icon+label) for each item", () => {
    const ticket = makeTicket({
      items: [makeItem({ name: "Preparing Item", status: "PREPARING" })],
    });

    renderCard(ticket);

    expect(screen.getByLabelText("Preparing")).toBeInTheDocument();
  });
});

describe("KdsTicketCard — tap-to-open ticket detail (KDS-03)", () => {
  afterEach(() => clearSession());

  it("opens a detail view with grouped revisions, per-item status, and the Kitchen Notes callout", async () => {
    const ticketId = "d1000001-0000-4000-8000-000000000001";

    server.use(
      http.get(`*/api/v1/kitchen/kds/tickets/${ticketId}`, () =>
        HttpResponse.json({
          data: {
            id: ticketId,
            orderId: "d1000002-0000-4000-8000-000000000002",
            orderNo: "ORD-001",
            stationCode: "GRILL",
            status: "COOKING",
            priority: false,
            receivedAt: "2026-07-11T10:00:00Z",
            startedAt: "2026-07-11T10:01:00Z",
            readyAt: null,
            orderNotes: "Birthday — bring cake last",
            items: [
              {
                id: "d1000003-0000-4000-8000-000000000003",
                orderItemId: "d1000004-0000-4000-8000-000000000004",
                name: "Chicken Karahi",
                qty: 2,
                modifiers: ["Extra Spicy"],
                notes: null,
                status: "COOKING",
                revisionNo: 1,
                firedAt: "2026-07-11T10:00:30Z",
              },
              {
                id: "d1000005-0000-4000-8000-000000000005",
                orderItemId: "d1000006-0000-4000-8000-000000000006",
                name: "Garlic Naan",
                qty: 3,
                modifiers: [],
                notes: "no onions",
                status: "PENDING",
                revisionNo: 2,
                firedAt: "2026-07-11T10:15:00Z",
              },
            ],
          },
          meta: null,
          warnings: [],
        }),
      ),
    );

    const ticket = makeTicket({
      id: ticketId,
      items: [
        makeItem({ id: "d1000003-0000-4000-8000-000000000003", revisionNo: 1 }),
        makeItem({ id: "d1000005-0000-4000-8000-000000000005", revisionNo: 2 }),
      ],
    });

    renderCard(ticket);
    const user = userEvent.setup();

    const trigger = screen.getByLabelText(`Open ticket detail for ${ticket.orderNo}`);
    await user.click(trigger);

    await waitFor(
      () => {
        expect(screen.getByTestId("kds-ticket-detail")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // Order-level Kitchen Notes callout
    expect(screen.getByText("Kitchen Notes")).toBeInTheDocument();
    expect(screen.getByText("Birthday — bring cake last")).toBeInTheDocument();

    // Revisions grouped by "Rev {n} · {time}"
    expect(screen.getByText(/Rev 1 ·/)).toBeInTheDocument();
    expect(screen.getByText(/Rev 2 ·/)).toBeInTheDocument();

    // Per-item status + notes
    expect(screen.getByText("Garlic Naan")).toBeInTheDocument();
    expect(screen.getByText("no onions")).toBeInTheDocument();
  });

  it("does not render the Kitchen Notes callout when orderNotes is absent", async () => {
    const ticketId = "d2000001-0000-4000-8000-000000000001";

    server.use(
      http.get(`*/api/v1/kitchen/kds/tickets/${ticketId}`, () =>
        HttpResponse.json({
          data: {
            id: ticketId,
            orderId: "d2000002-0000-4000-8000-000000000002",
            orderNo: "ORD-002",
            stationCode: "GRILL",
            status: "PENDING",
            priority: false,
            receivedAt: "2026-07-11T10:00:00Z",
            startedAt: null,
            readyAt: null,
            orderNotes: null,
            items: [
              {
                id: "d2000003-0000-4000-8000-000000000003",
                orderItemId: "d2000004-0000-4000-8000-000000000004",
                name: "Plain Rice",
                qty: 1,
                modifiers: [],
                notes: null,
                status: "PENDING",
                revisionNo: 1,
                firedAt: null,
              },
            ],
          },
          meta: null,
          warnings: [],
        }),
      ),
    );

    const ticket = makeTicket({ id: ticketId, orderNo: "ORD-002" });

    renderCard(ticket);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText(`Open ticket detail for ${ticket.orderNo}`));

    await waitFor(
      () => {
        expect(screen.getByTestId("kds-ticket-detail")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    expect(screen.queryByText("Kitchen Notes")).not.toBeInTheDocument();
  });
});
