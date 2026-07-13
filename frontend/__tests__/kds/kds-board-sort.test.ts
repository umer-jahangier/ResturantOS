import { describe, it, expect } from "vitest";

import { sortKdsTickets } from "@/components/kds/station-board";
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
    receivedAt: new Date("2026-07-11T10:00:00Z"),
    startedAt: null,
    readyAt: null,
    orderNotes: null,
    tableNumber: null,
    orderType: null,
    items: [],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("sortKdsTickets — deterministic stable board sort (KDS-03)", () => {
  it("sorts by receivedAt descending (newest first)", () => {
    const t1 = makeTicket({ id: "a", receivedAt: new Date("2026-07-11T10:05:00Z") });
    const t2 = makeTicket({ id: "b", receivedAt: new Date("2026-07-11T10:00:00Z") });
    const t3 = makeTicket({ id: "c", receivedAt: new Date("2026-07-11T10:10:00Z") });

    const sorted = sortKdsTickets([t1, t2, t3]);

    expect(sorted.map((t) => t.id)).toEqual(["c", "a", "b"]);
  });

  it("breaks receivedAt ties by ticket.id ascending", () => {
    const sameTime = new Date("2026-07-11T10:00:00Z");
    const t1 = makeTicket({ id: "zzz", receivedAt: sameTime });
    const t2 = makeTicket({ id: "aaa", receivedAt: sameTime });

    const sorted = sortKdsTickets([t1, t2]);

    expect(sorted.map((t) => t.id)).toEqual(["aaa", "zzz"]);
  });

  it("does not mutate the input array (returns a new array)", () => {
    const t1 = makeTicket({ id: "b", receivedAt: new Date("2026-07-11T10:05:00Z") });
    const t2 = makeTicket({ id: "a", receivedAt: new Date("2026-07-11T10:00:00Z") });
    const input = [t1, t2];

    const sorted = sortKdsTickets(input);

    expect(input.map((t) => t.id)).toEqual(["b", "a"]); // input untouched
    expect(sorted.map((t) => t.id)).toEqual(["b", "a"]); // b (10:05) is newer than a (10:00)
  });

  it("keeps card ordering stable when a batch arrives out of receivedAt order", () => {
    const t1 = makeTicket({ id: "a", receivedAt: new Date("2026-07-11T10:00:00Z") });
    const t2 = makeTicket({ id: "b", receivedAt: new Date("2026-07-11T10:05:00Z") });

    // Server/socket delivers them out of order — sort must still produce the
    // receivedAt-descending (newest-first) order every time, regardless of input order.
    expect(sortKdsTickets([t2, t1]).map((t) => t.id)).toEqual(["b", "a"]);
    expect(sortKdsTickets([t1, t2]).map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("does NOT reorder a card when only its items' statuses change within an already-rendered ticket", () => {
    const itemA = {
      id: "i1",
      orderItemId: "oi1",
      name: "Chicken Karahi",
      qty: 1,
      modifiers: [],
      notes: null,
      status: "PENDING" as const,
      revisionNo: 1,
      firedAt: null,
    };
    const itemB = {
      id: "i2",
      orderItemId: "oi2",
      name: "Naan",
      qty: 1,
      modifiers: [],
      notes: null,
      status: "PENDING" as const,
      revisionNo: 1,
      firedAt: null,
    };

    const ticketA = makeTicket({
      id: "a",
      receivedAt: new Date("2026-07-11T10:00:00Z"),
      items: [itemA],
    });
    const ticketB = makeTicket({
      id: "b",
      receivedAt: new Date("2026-07-11T10:05:00Z"),
      items: [itemB],
    });

    const firstBatch = sortKdsTickets([ticketB, ticketA]);
    expect(firstBatch.map((t) => t.id)).toEqual(["b", "a"]); // newest (b, 10:05) first

    // Simulate a subsequent batch where ticket "a"'s item status changed
    // (PENDING -> COOKING) but its id/receivedAt (immutable) are unchanged.
    const ticketAUpdated: KdsTicket = {
      ...ticketA,
      items: [{ ...itemA, status: "COOKING" }],
    };
    const secondBatch = sortKdsTickets([ticketB, ticketAUpdated]);

    expect(secondBatch.map((t) => t.id)).toEqual(["b", "a"]); // order unchanged — no bounce
  });
});
