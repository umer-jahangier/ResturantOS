import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { KdsTicketCard } from "@/components/kds/kds-ticket-card";
import type { KdsTicket, KdsTicketItem } from "@/lib/models/kds.model";

// kds-ticket-card.test.tsx — 07.3-10 rewrite. The pre-07.3-10 card (revision pill,
// per-item StatusBadge, bump buttons, tap-to-open Dialog detail) is superseded by
// the slim collapsed card below (KDS-04/D-12): the move action moved into
// kds-item-column.tsx, and the detail moved into a dedicated routed page
// (kds-station-detail.tsx) — no Dialog anywhere in this component.

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
    tableNumber: "12",
    items: [makeItem()],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("KdsTicketCard — slim collapsed card (KDS-04/D-12)", () => {
  it("shows order number, table, age, and item names — and nothing else", () => {
    const ticket = makeTicket({ orderNo: "ORD-042", tableNumber: "9" });

    render(<KdsTicketCard ticket={ticket} />);

    const card = screen.getByTestId("kds-ticket-card");
    expect(within(card).getByText("ORD-042")).toBeInTheDocument();
    expect(within(card).getByText(/Table 9/)).toBeInTheDocument();
    expect(within(card).getByText(/Chicken Karahi/)).toBeInTheDocument();
    expect(within(card).getByTestId("kds-ticket-age")).toBeInTheDocument();
  });

  it('shows "No table" when tableNumber is null (takeaway/pickup)', () => {
    const ticket = makeTicket({ tableNumber: null });

    render(<KdsTicketCard ticket={ticket} />);

    expect(within(screen.getByTestId("kds-ticket-card")).getByText("No table")).toBeInTheDocument();
  });

  it("renders no per-item StatusBadge (no aria-label like Pending/Preparing)", () => {
    const ticket = makeTicket({ items: [makeItem({ status: "PREPARING" })] });

    render(<KdsTicketCard ticket={ticket} />);

    const card = screen.getByTestId("kds-ticket-card");
    expect(within(card).queryByLabelText("Pending")).not.toBeInTheDocument();
    expect(within(card).queryByLabelText("Preparing")).not.toBeInTheDocument();
  });

  it("renders no bump button (no bump-btn-* testid, no START/DONE text)", () => {
    const ticket = makeTicket();

    render(<KdsTicketCard ticket={ticket} />);

    const card = screen.getByTestId("kds-ticket-card");
    expect(within(card).queryByTestId(/^bump-btn-/)).not.toBeInTheDocument();
    expect(within(card).queryByText("START")).not.toBeInTheDocument();
    expect(within(card).queryByText("DONE")).not.toBeInTheDocument();
  });

  it("renders no [role=dialog] anywhere — selecting a card is the caller's responsibility (routes to a dedicated page)", () => {
    const ticket = makeTicket();

    render(<KdsTicketCard ticket={ticket} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("respects an `items` override — a column fragment shows only that subset of item names", () => {
    const burger = makeItem({ id: "i1", name: "Burger", status: "PREPARING" });
    const fries = makeItem({ id: "i2", name: "Fries", status: "ACCEPTED" });
    const ticket = makeTicket({ items: [burger, fries] });

    render(<KdsTicketCard ticket={ticket} items={[fries]} />);

    const card = screen.getByTestId("kds-ticket-card");
    expect(within(card).getByText(/Fries/)).toBeInTheDocument();
    expect(within(card).queryByText(/Burger/)).not.toBeInTheDocument();
  });

  it("shows a PRIORITY badge when the ticket is flagged priority", () => {
    const ticket = makeTicket({ priority: true });

    render(<KdsTicketCard ticket={ticket} />);

    expect(within(screen.getByTestId("kds-ticket-card")).getByText("PRIORITY")).toBeInTheDocument();
  });
});

describe("KdsTicketCard — subtle escalation-threshold aging treatment (KDS-05/D-13)", () => {
  it("stays at the neutral/emerald border below 0.66x the station's escalation threshold", () => {
    // 5 min old, 900s (15 min) threshold -> ~33% of threshold, well under amber.
    const ticket = makeTicket({ receivedAt: new Date(Date.now() - 5 * 60_000) });

    render(<KdsTicketCard ticket={ticket} escalationThresholdSeconds={900} />);

    const card = screen.getByTestId("kds-ticket-card");
    expect(card.className).toContain("border-l-emerald-500/60");
  });

  it("turns the border + timer chip amber at >=0.66x the station's escalation threshold", () => {
    // 7 min old vs a 600s (10 min) threshold -> 70% of threshold.
    const ticket = makeTicket({ receivedAt: new Date(Date.now() - 7 * 60_000) });

    render(<KdsTicketCard ticket={ticket} escalationThresholdSeconds={600} />);

    const card = screen.getByTestId("kds-ticket-card");
    const chip = within(card).getByTestId("kds-ticket-age");
    expect(card.className).toContain("border-l-amber-500");
    expect(chip.className).toContain("amber");
  });

  it("turns the border + timer chip red at/above the station's escalation threshold — never full-red background or bounce", () => {
    // 12 min old vs a 600s (10 min) threshold -> 120% of threshold.
    const ticket = makeTicket({ receivedAt: new Date(Date.now() - 12 * 60_000) });

    render(<KdsTicketCard ticket={ticket} escalationThresholdSeconds={600} />);

    const card = screen.getByTestId("kds-ticket-card");
    const chip = within(card).getByTestId("kds-ticket-age");
    expect(card.className).toContain("border-l-red-500");
    expect(chip.className).toContain("red");
    expect(card.className).not.toContain("animate-bounce");
    expect(card.className).not.toContain("bg-red-950");
  });

  it("falls back to a 15-minute default threshold when escalationThresholdSeconds is not provided (station not yet loaded)", () => {
    const ticket = makeTicket({ receivedAt: new Date(Date.now() - 20 * 60_000) });

    render(<KdsTicketCard ticket={ticket} />);

    expect(screen.getByTestId("kds-ticket-card").className).toContain("border-l-red-500");
  });
});
