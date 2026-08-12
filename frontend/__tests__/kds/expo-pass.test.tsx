import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { ExpoBoard } from "@/components/kds/expo-board";
import { StationPicker } from "@/components/kds/station-picker";

/**
 * F18 — "There is no expo / pass view, so nothing tells anyone a table is half-ready."
 *
 * <p>Full-shift walkthrough §3 #15, reproduced as a fixture: ONE check, rung once, split by
 * {@code TicketRoutingService} into one ticket per (order, station). GRILL finished both its
 * lines. DEFAULT never started the naan. Nothing in the product said the table was
 * half-ready, and the check was paid and closed before anyone noticed.
 *
 * <h3>What these tests assert</h3>
 *
 * The STRINGS a cook reads, on the real screen, driven with real clicks — never a component's
 * props and never the derivation in isolation. The pass is a screen, so an assertion that
 * passes while the screen says something else is worth nothing.
 *
 * <h3>Falsification</h3>
 *
 * The load-bearing line is the quantifier in {@code computeExpoChecks}: a check is ready when
 * EVERY station's lines are ready, never when ANY station's are. Flipping that one
 * {@code lines.every(...)} to {@code lines.some(...)} — the single most natural way to write
 * this wrong — makes "the split check does not read as ready while DEFAULT still owes the
 * naan" fail with:
 *
 * <pre>
 *   AssertionError: expected 'All ready — run it Waiting on DEFAULT…' not to contain 'All ready'
 *   - data-state on the card: "ready", expected "cooking"
 * </pre>
 *
 * which is exactly the walkthrough's defect wearing a green badge, and is worse than shipping
 * nothing because somebody would then trust it. Verified by making that edit and running this
 * file; recorded in the F18 report.
 */

const BRANCH = "b1000001-0000-4000-8000-000000000001";
const ORDER = "52000001-0000-4000-8000-000000000001";
const ORDER_NO = "ORD-20260812-0164";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

// jsdom has no WebSocket, and the live path is proven in Chromium, not here. The POLL is
// what these tests exercise, which is deliberate: it is the floor the pass must work on
// when a socket is down, and a test that only passed with a socket would not have covered it.
vi.mock("@/lib/hooks/kds/use-kds-expo-socket", () => ({
  useKdsExpoSocket: () => ({ isConnected: true, connectedCount: 2, stationCount: 2 }),
}));

const GRILL = {
  id: "51000001-0000-4000-8000-0000000000a1",
  branchId: BRANCH,
  code: "GRILL",
  name: "Hot line",
  active: true,
  escalationThresholdSeconds: 900,
};
const DEFAULT_STATION = {
  id: "51000001-0000-4000-8000-0000000000a2",
  branchId: BRANCH,
  code: "DEFAULT",
  name: "DEFAULT",
  active: true,
  escalationThresholdSeconds: 900,
};

function item(suffix: string, name: string, qty: number, status: string) {
  return {
    id: `53000001-0000-4000-8000-0000000000${suffix}`,
    orderItemId: `54000001-0000-4000-8000-0000000000${suffix}`,
    name,
    qty,
    modifiers: [],
    notes: null,
    status,
    revisionNo: 1,
    firedAt: null,
  };
}

/** The walkthrough's check: two stations, one ticket each, one order. */
function splitCheck(naanStatus: string) {
  return [
    {
      id: "55000001-0000-4000-8000-0000000000b1",
      orderId: ORDER,
      orderNo: ORDER_NO,
      stationCode: "GRILL",
      status: "READY",
      priority: false,
      receivedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
      startedAt: null,
      readyAt: null,
      orderNotes: null,
      tableNumber: "H1",
      orderType: "DINE_IN",
      items: [item("11", "Seekh Kebab", 2, "READY"), item("12", "Fresh Lime", 1, "READY")],
    },
    {
      id: "55000001-0000-4000-8000-0000000000b2",
      orderId: ORDER,
      orderNo: ORDER_NO,
      stationCode: "DEFAULT",
      status: naanStatus === "READY" ? "READY" : "PENDING",
      priority: false,
      receivedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
      startedAt: null,
      readyAt: null,
      orderNotes: null,
      tableNumber: "H1",
      orderType: "DINE_IN",
      items: [item("13", "Butter Naan", 1, naanStatus)],
    },
  ];
}

/** A second, unrelated check that is entirely at one station and entirely ready. */
function readyCheck() {
  return {
    id: "55000001-0000-4000-8000-0000000000c1",
    orderId: "52000001-0000-4000-8000-000000000002",
    orderNo: "ORD-20260812-0165",
    stationCode: "GRILL",
    status: "READY",
    priority: false,
    receivedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    startedAt: null,
    readyAt: null,
    orderNotes: null,
    tableNumber: "T2",
    orderType: "TAKEAWAY",
    items: [item("21", "Pinacolada", 1, "READY")],
  };
}

/** Serves the station registry plus a ticket list that the test can advance. */
function serve(getTickets: () => unknown[], onStatusPost?: () => void) {
  server.use(
    http.get("*/api/v1/kitchen/kds/stations", () => HttpResponse.json([GRILL, DEFAULT_STATION])),
    http.get("*/api/v1/kitchen/kds/tickets", () => {
      const content = getTickets();
      return HttpResponse.json({
        content,
        totalElements: content.length,
        totalPages: 1,
        number: 0,
        size: 500,
      });
    }),
    http.post("*/api/v1/kitchen/kds/tickets/:ticketId/items/:itemId/status", () => {
      onStatusPost?.();
      // The response body is irrelevant to the pass — the hook invalidates and refetches
      // the branch-wide list, which is what the screen actually reads.
      return HttpResponse.json(splitCheck("READY")[1]);
    }),
  );
}

function renderPass() {
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <ExpoBoard branchId={BRANCH} />
    </Wrapper>,
  );
}

beforeEach(() => {
  seedSession({
    branchId: BRANCH,
    permissions: ["pos.kds.view", "pos.kds.update"],
  });
});

afterEach(() => {
  clearSession();
  vi.clearAllMocks();
});

describe("the pass shows a split check as one whole check", () => {
  it("draws ONE card for a check split across two stations, naming both", async () => {
    serve(() => splitCheck("PENDING"));
    renderPass();

    await waitFor(() => expect(screen.getAllByTestId("expo-check")).toHaveLength(1));
    const card = screen.getByTestId("expo-check");

    // The check appears once, as a whole — not once per station, which is what every
    // other KDS surface in the product does.
    expect(card).toHaveAttribute("data-order-no", ORDER_NO);
    expect(card.textContent).toContain(ORDER_NO);
    expect(card.textContent).toContain("Table H1");

    // Both stations, on the one card, each with what it still owes.
    expect(screen.getByTestId("expo-station-GRILL")).toHaveAttribute("data-state", "ready");
    expect(screen.getByTestId("expo-station-DEFAULT")).toHaveAttribute("data-state", "waiting");
    expect(screen.getByTestId("expo-station-GRILL-state").textContent).toContain("2 of 2 ready");
    expect(screen.getByTestId("expo-station-DEFAULT-state").textContent).toContain("0 of 1 ready");
  });

  it("does NOT read as ready while one station still owes a dish", async () => {
    serve(() => splitCheck("PENDING"));
    renderPass();

    await waitFor(() => expect(screen.getAllByTestId("expo-check")).toHaveLength(1));
    const card = screen.getByTestId("expo-check");

    // ── the load-bearing assertion (see the falsification note above) ────────────
    expect(card).toHaveAttribute("data-state", "cooking");
    expect(card).toHaveAttribute("data-stations-owing", "1");
    expect(card.textContent).not.toContain("All ready");
    expect(screen.getByTestId("expo-check-headline").textContent).toContain("Waiting on DEFAULT");
    expect(screen.getByTestId("expo-check-progress").textContent).toContain(
      "1 of 2 stations ready",
    );
    expect(screen.getByTestId("expo-check-progress").textContent).toContain("2 of 3 items ready");
  });

  it("stays on the pass, as ready-to-run, once the last outstanding item is bumped", async () => {
    let naan = "PENDING";
    serve(
      () => splitCheck(naan),
      () => {
        naan = "READY";
      },
    );
    const user = userEvent.setup();
    renderPass();

    await waitFor(() =>
      expect(screen.getByTestId("expo-check-headline").textContent).toContain("Waiting on DEFAULT"),
    );

    // Bump the naan through to Ready FROM THE PASS — three presses, the same
    // New→Started→Preparing→Ready lifecycle the station boards drive.
    for (let press = 0; press < 3 && naan !== "READY"; press += 1) {
      const button = await screen.findByTestId("expo-advance-53000001-0000-4000-8000-000000000013");
      await user.click(button);
    }

    await waitFor(() =>
      expect(screen.getByTestId("expo-check-headline").textContent).toContain("All ready — run it"),
    );
    const card = screen.getByTestId("expo-check");
    expect(card).toHaveAttribute("data-state", "ready");
    expect(card).toHaveAttribute("data-stations-owing", "0");

    // And it has NOT cleared: running food is a job somebody still has to do.
    expect(screen.getAllByTestId("expo-check")).toHaveLength(1);
    expect(card.textContent).toContain(ORDER_NO);
    expect(screen.getByTestId("expo-ready-count").textContent).toContain("1 ready to run");
  });

  it("filters to what still needs cooking without hiding the counts", async () => {
    serve(() => [...splitCheck("PENDING"), readyCheck()]);
    const user = userEvent.setup();
    renderPass();

    await waitFor(() => expect(screen.getAllByTestId("expo-check")).toHaveLength(2));
    expect(screen.getByTestId("expo-check-count").textContent).toContain("2 checks");
    expect(screen.getByTestId("expo-ready-count").textContent).toContain("1 ready to run");

    await user.click(screen.getByTestId("expo-filter-ready"));
    await waitFor(() => expect(screen.getAllByTestId("expo-check")).toHaveLength(1));
    expect(screen.getByTestId("expo-check")).toHaveAttribute("data-order-no", "ORD-20260812-0165");

    await user.click(screen.getByTestId("expo-filter-outstanding"));
    await waitFor(() => expect(screen.getAllByTestId("expo-check")).toHaveLength(1));
    expect(screen.getByTestId("expo-check")).toHaveAttribute("data-order-no", ORDER_NO);
  });
});

describe("the pass is honest about what it cannot see", () => {
  it("shows the error state, not an empty pass, when the ticket read fails", async () => {
    server.use(
      http.get("*/api/v1/kitchen/kds/stations", () => HttpResponse.json([GRILL, DEFAULT_STATION])),
      http.get("*/api/v1/kitchen/kds/tickets", () => new HttpResponse(null, { status: 500 })),
    );
    renderPass();

    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(screen.queryByTestId("expo-empty")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Nothing on the pass");
  });

  it("warns a station-assigned caller that this pass is partial", async () => {
    clearSession();
    seedSession({
      branchId: BRANCH,
      permissions: ["pos.kds.view"],
      // kitchen-service narrows a branch-wide read to the caller's stations, so an
      // assigned caller's pass CANNOT see whether another station still owes a dish.
      attributes: { stations: ["GRILL"] },
    });
    serve(() => splitCheck("PENDING"));
    renderPass();

    const warning = await screen.findByTestId("expo-scope-warning");
    expect(warning.textContent).toContain("GRILL");
    expect(warning.textContent).toContain("still owes a dish");
  });

  it("says the pass is empty in its own words when nothing has been fired", async () => {
    serve(() => []);
    renderPass();

    const empty = await screen.findByTestId("expo-empty");
    expect(empty.textContent).toContain("Nothing on the pass");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("a cook can find the pass", () => {
  it("the kitchen's own home screen offers it, and it goes to /app/kitchen/expo", async () => {
    // A screen nobody can reach is the same as a screen that does not exist, and the
    // walkthrough's finding was exactly that nobody could find the whole check. The station
    // picker is where a cook lands from "Kitchen Display", so the pass is offered there —
    // beside the tiles that each show ONE station, which is the thing it is the opposite of.
    serve(() => splitCheck("PENDING"));
    const user = userEvent.setup();
    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <StationPicker branchId={BRANCH} />
      </Wrapper>,
    );

    const open = await screen.findByTestId("kds-open-pass");
    expect(open.textContent).toContain("The Pass");
    await user.click(open);
    expect(pushMock).toHaveBeenCalledWith("/app/kitchen/expo");
  });
});
