import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { KdsTicketCard } from "@/components/kds/kds-ticket-card";
import { KdsBoard } from "@/components/kds/kds-board";
import type { KdsTicket } from "@/lib/models/kds.model";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTicket(overrides: Partial<KdsTicket> = {}): KdsTicket {
  return {
    id: "t0000001-0000-4000-8000-000000000001",
    orderId: "o0000001-0000-4000-8000-000000000001",
    orderNo: "ORD-001",
    stationCode: "GRILL",
    status: "PENDING",
    priority: false,
    receivedAt: new Date(Date.now() - 5 * 60_000), // 5 minutes ago by default
    startedAt: null,
    readyAt: null,
    items: [
      {
        id: "i0000001-0000-4000-8000-000000000001",
        orderItemId: "oi000001-0000-4000-8000-000000000001",
        name: "Chicken Karahi",
        qty: 2,
        modifiers: ["Extra Spicy"],
        notes: null,
        status: "PENDING",
      },
    ],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("KdsTicketCard — aging colors", () => {
  afterEach(() => {
    clearSession();
    vi.restoreAllMocks();
  });

  it("shows border-emerald for ticket <10 minutes old", () => {
    seedSession({ permissions: ["pos.kds.view", "pos.kds.update"] });
    const ticket = makeTicket({ receivedAt: new Date(Date.now() - 5 * 60_000) });

    const { container } = render(
      <KdsTicketCard ticket={ticket} branchId="branch-1" canUpdate={true} />,
      { wrapper: createQueryWrapper() },
    );

    const card = container.querySelector("[data-testid='kds-ticket-card']");
    expect(card?.className).toContain("border-emerald-500");
    expect(card?.className).toContain("bg-gray-900");
  });

  it("shows border-amber + animate-pulse for ticket 10-15 minutes old", () => {
    seedSession({ permissions: ["pos.kds.view", "pos.kds.update"] });
    const ticket = makeTicket({ receivedAt: new Date(Date.now() - 12 * 60_000) });

    const { container } = render(
      <KdsTicketCard ticket={ticket} branchId="branch-1" canUpdate={true} />,
      { wrapper: createQueryWrapper() },
    );

    const card = container.querySelector("[data-testid='kds-ticket-card']");
    expect(card?.className).toContain("border-amber-400");
    expect(card?.className).toContain("animate-pulse");
  });

  it("shows border-red + bg-red-950 for ticket >15 minutes old", () => {
    seedSession({ permissions: ["pos.kds.view", "pos.kds.update"] });
    const ticket = makeTicket({ receivedAt: new Date(Date.now() - 20 * 60_000) });

    const { container } = render(
      <KdsTicketCard ticket={ticket} branchId="branch-1" canUpdate={true} />,
      { wrapper: createQueryWrapper() },
    );

    const card = container.querySelector("[data-testid='kds-ticket-card']");
    expect(card?.className).toContain("border-red-500");
    expect(card?.className).toContain("bg-red-950");
  });

  it("shows bump button when user has pos.kds.update", () => {
    seedSession({ permissions: ["pos.kds.view", "pos.kds.update"] });
    const ticket = makeTicket();

    render(
      <KdsTicketCard ticket={ticket} branchId="branch-1" canUpdate={true} />,
      { wrapper: createQueryWrapper() },
    );

    expect(screen.getByText("START")).toBeInTheDocument();
  });

  it("hides bump button when user lacks pos.kds.update", () => {
    seedSession({ permissions: ["pos.kds.view"] });
    const ticket = makeTicket();

    render(
      <KdsTicketCard ticket={ticket} branchId="branch-1" canUpdate={false} />,
      { wrapper: createQueryWrapper() },
    );

    expect(screen.queryByText("START")).toBeNull();
    expect(screen.queryByText("DONE")).toBeNull();
  });
});

describe("KdsBoard — always-dark assertion", () => {
  beforeEach(() => {
    seedSession({
      permissions: ["pos.kds.view", "pos.kds.update"],
      branchId: "branch-1",
    });
  });

  afterEach(() => {
    clearSession();
  });

  it("renders with dark class regardless of theme", () => {
    // KdsBoard doesn't await data in this test — it renders the loading state
    // which still uses the dark container
    const { container } = render(
      <KdsBoard branchId="branch-1" />,
      { wrapper: createQueryWrapper() },
    );

    // The outermost rendered element should carry dark/bg-gray-950
    const darkEl = container.querySelector(".dark.bg-gray-950");
    expect(darkEl).not.toBeNull();
  });
});
