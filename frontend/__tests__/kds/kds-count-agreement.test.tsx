import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { StationBoard } from "@/components/kds/station-board";
import { StationPicker } from "@/components/kds/station-picker";
import { KDS_COLUMN_ORDER, type KdsColumnKey } from "@/components/kds/kds-item-column";

/**
 * F3 — "the KDS station picker and the board report different numbers under the same word
 * `tickets` — 21 apart on the busiest board."
 *
 * <p>Measured live as `kitchen@terrace.local` on branch F-7, 2026-08-12, and cross-read over
 * HTTP on the cook's own bearer:
 *
 * <pre>
 *   station    picker tile   board header   truth (tickets ON the board / live items)
 *   DEFAULT    120           111            108 / 134
 *   PANTRY1     18            12             12 /  12
 *   GRILL        6             5              5 /   5
 * </pre>
 *
 * <p>Two independent defects, pulling in opposite directions:
 *
 * <ol>
 *   <li>the picker counted every ticket whose STATUS was not SERVED/CANCELLED, including
 *   twelve on DEFAULT whose every LINE had already been served on the POS — those map to no
 *   board column and the board draws nothing for them;</li>
 *   <li>the board counted ticket×column FRAGMENTS (cards) and printed the word "tickets"
 *   after them, so a check split across two columns counted twice, and bumping one item of a
 *   two-item check MOVED the total.</li>
 * </ol>
 *
 * <p>These tests render BOTH REAL SURFACES against ONE ticket payload and compare the strings
 * a cook reads. That is the point: asserting `computeKdsCounts` alone would have passed against
 * the broken build too, because each old arithmetic was self-consistent — it was the two
 * SCREENS that disagreed.
 *
 * <p><b>Falsification.</b> Every numeric assertion below is written against a selector that
 * EXISTED before the fix (`station-queue-*`, `station-*-col-*`, `kds-ticket-count`,
 * `kds-column-count-*`), and is asserted BEFORE any assertion on a newly-added element, so a
 * pre-fix run fails on the number rather than on a missing `data-testid`. Run against the
 * components at HEAD~1 these fail with picker 9 / board 8 against a truth of 6, picker
 * `NEW 5` against board `NEW 4`, and "2 tickets" after bumping one line of a single check.
 */

const BRANCH = "b1000001-0000-4000-8000-000000000001";

vi.mock("@/lib/hooks/kds/use-kds-socket", () => ({
  useKdsSocket: () => ({ isConnected: true }),
}));

const pushMock = vi.fn();
const replaceMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: replaceMock }),
}));

const HOTLINE = {
  id: "51000001-0000-4000-8000-000000000001",
  branchId: BRANCH,
  code: "HOTLINE",
  name: "Hot line",
  active: true,
  escalationThresholdSeconds: 900,
};
// A second station so the picker renders its grid instead of auto-navigating (KDS-04:
// a branch with exactly one station redirects straight to that board).
const PASS = { ...HOTLINE, id: "51000001-0000-4000-8000-000000000002", code: "PASS", name: "Pass" };

function pad(n: number) {
  return String(n).padStart(12, "0");
}

/** A wire-shape HOTLINE ticket carrying one item per requested status. */
function rawTicket(n: number, itemStatuses: string[], ticketStatus = "PENDING") {
  return {
    id: `51000001-0000-4000-8000-${pad(n)}`,
    orderId: `52000001-0000-4000-8000-${pad(n)}`,
    orderNo: `ORD-${String(n).padStart(3, "0")}`,
    stationCode: "HOTLINE",
    status: ticketStatus,
    priority: false,
    receivedAt: new Date(Date.UTC(2026, 7, 12, 10, 0, 0) + n * 1000).toISOString(),
    startedAt: null,
    readyAt: null,
    orderNotes: null,
    tableNumber: "12",
    orderType: "DINE_IN",
    items: itemStatuses.map((status, i) => ({
      id: `53000001-0000-4000-8000-${pad(n * 100 + i)}`,
      orderItemId: `54000001-0000-4000-8000-${pad(n * 100 + i)}`,
      name: `Item ${n}.${i}`,
      qty: 1,
      modifiers: [],
      notes: null,
      status,
      revisionNo: 1,
      firedAt: null,
    })),
  };
}

function serve(content: ReturnType<typeof rawTicket>[]) {
  server.use(
    http.get("*/api/v1/kitchen/kds/stations", () => HttpResponse.json([HOTLINE, PASS])),
    http.get("*/api/v1/kitchen/kds/tickets", () =>
      HttpResponse.json({
        content,
        totalElements: content.length,
        totalPages: 1,
        number: 0,
        size: 500,
      }),
    ),
  );
}

/**
 * The DEFAULT board of 2026-08-12, in miniature — every shape that made the two surfaces
 * disagree, and nothing else:
 *
 * <pre>
 *   3 plain checks, one per stage                 3 tickets   3 items   N1 S1 P1
 *   2 split checks (started starter + new main)   2 tickets   4 items   N+2 S+2
 *   1 check with two lines both waiting           1 ticket    2 items   N+1
 *   3 ghost checks, every line served on the POS  0 tickets   0 items   (no card at all)
 *   ─────────────────────────────────────────────────────────────────────────────────
 *   TRUTH                                         6 tickets   9 items   N4 S3 P1 R0
 * </pre>
 *
 * Pre-fix the picker read <b>9</b> (it counted the three ghosts) and `NEW 5` (it counted
 * items); the board read <b>8</b> (it counted the eight cards) and `NEW 4`. Three different
 * answers to "how much work is at Hot line", on two screens one tap apart.
 */
function realisticBoard() {
  return [
    rawTicket(1, ["PENDING"]),
    rawTicket(2, ["ACCEPTED"]),
    rawTicket(3, ["PREPARING"]),
    rawTicket(4, ["ACCEPTED", "PENDING"]),
    rawTicket(5, ["ACCEPTED", "PENDING"]),
    rawTicket(6, ["PENDING", "PENDING"]),
    rawTicket(7, ["SERVED"], "READY"),
    rawTicket(8, ["SERVED", "SERVED"], "READY"),
    rawTicket(9, ["SERVED"], "READY"),
  ];
}

const TRUTH = {
  tickets: 6,
  items: 9,
  cardsPerColumn: { NEW: "4", STARTED: "3", PREPARING: "1", READY: "0" } as Record<
    KdsColumnKey,
    string
  >,
};

function renderPicker() {
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <StationPicker branchId={BRANCH} />
    </Wrapper>,
  );
}

function renderBoard() {
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <StationBoard branchId={BRANCH} stationCode="HOTLINE" />
    </Wrapper>,
  );
}

/** The pill on the tile — the glance number, and a selector that predates this fix. */
async function pickerPill(): Promise<string> {
  await waitFor(() => expect(screen.getByTestId("station-tile-HOTLINE")).toBeInTheDocument());
  await waitFor(() =>
    expect(screen.getByTestId("station-queue-HOTLINE").textContent?.trim()).toMatch(/^\d+$/),
  );
  return screen.getByTestId("station-queue-HOTLINE").textContent?.trim() ?? "";
}

/** The tile's per-stage cell: [number, stage name]. `textContent` runs them together. */
function pickerColumn(column: KdsColumnKey): string {
  return (
    screen.getByTestId(`station-HOTLINE-col-${column}`).firstElementChild?.textContent?.trim() ?? ""
  );
}

async function boardHeader(): Promise<string> {
  await waitFor(() => expect(screen.getByTestId("kds-board")).toBeInTheDocument());
  await waitFor(() => expect(screen.getByTestId("kds-ticket-count").textContent).toMatch(/\d/));
  return screen.getByTestId("kds-ticket-count").textContent?.trim() ?? "";
}

function boardColumn(column: KdsColumnKey): string {
  return screen.getByTestId(`kds-column-count-${column}`).textContent?.trim() ?? "";
}

afterEach(() => {
  clearSession();
  pushMock.mockReset();
  replaceMock.mockReset();
  document.body.innerHTML = "";
});

describe("KDS counts — the picker tile and the board header say the same thing", () => {
  it("puts the same headline number on the tile and on the board it opens", async () => {
    seedSession({ branchId: BRANCH, permissions: ["pos.kds.view", "pos.kds.update"] });
    serve(realisticBoard());

    renderPicker();
    const pill = await pickerPill();
    document.body.innerHTML = "";

    renderBoard();
    const header = await boardHeader();

    // Pre-fix: pill "9" (three served-off checks counted), header "8 tickets" (eight cards).
    expect(pill, "station tile queue depth").toBe(String(TRUTH.tickets));
    expect(header, "board header").toBe(`${TRUTH.tickets} tickets`);
    expect(header.startsWith(pill), `tile said ${pill}, board said ${header}`).toBe(true);
  });

  it("puts the same per-stage split on both, stage by stage", async () => {
    seedSession({ branchId: BRANCH, permissions: ["pos.kds.view", "pos.kds.update"] });
    serve(realisticBoard());

    renderPicker();
    await pickerPill();
    const tileSplit = {} as Record<KdsColumnKey, string>;
    for (const column of KDS_COLUMN_ORDER) tileSplit[column] = pickerColumn(column);
    document.body.innerHTML = "";

    renderBoard();
    await boardHeader();

    for (const column of KDS_COLUMN_ORDER) {
      // Pre-fix the tile counted ITEMS here (NEW 5) and the board counted CARDS (NEW 4).
      expect(boardColumn(column), `board ${column}`).toBe(TRUTH.cardsPerColumn[column]);
      expect(tileSplit[column], `picker ${column} disagrees with the board`).toBe(
        TRUTH.cardsPerColumn[column],
      );
    }
  });

  it("does not move either total when a cook bumps one line of a two-line check", async () => {
    seedSession({ branchId: BRANCH, permissions: ["pos.kds.view", "pos.kds.update"] });

    // Before: one check, both lines waiting. After: the same check, one line started.
    serve([rawTicket(4, ["PENDING", "PENDING"])]);
    renderBoard();
    expect(await boardHeader()).toBe("1 ticket");
    document.body.innerHTML = "";

    serve([rawTicket(4, ["ACCEPTED", "PENDING"])]);
    renderBoard();
    const after = await boardHeader();
    // The line moved New→Started, so the board now draws TWO cards for this ONE check…
    await waitFor(() => expect(boardColumn("STARTED")).toBe("1"));
    expect(boardColumn("NEW")).toBe("1");
    // …and nothing arrived and nothing left, so the total must not have moved. Pre-fix it
    // read "2 tickets": the header counted the second card.
    expect(after, "bumping one line invented a ticket").toBe("1 ticket");
  });

  it("counts no check the board draws nothing for", async () => {
    seedSession({ branchId: BRANCH, permissions: ["pos.kds.view"] });
    // Every line served on the POS while the ticket sits at READY — the five-day-old debris
    // that inflated DEFAULT's tile to 120 on a board carrying 108. Plus a fully-cancelled one.
    serve([rawTicket(7, ["SERVED"], "READY"), rawTicket(8, ["CANCELLED"], "PENDING")]);

    renderPicker();
    // Pre-fix: "2".
    expect(await pickerPill(), "tile counted checks the board cannot draw").toBe("0");
    document.body.innerHTML = "";

    renderBoard();
    expect(await boardHeader()).toBe("0 tickets");
    // And the board really does draw nothing, so "0" is the honest answer, not a hidden one.
    expect(document.querySelectorAll("[data-fragment-key]").length).toBe(0);
  });

  it("names the unit on both surfaces, so 'tickets' can never be read as 'dishes'", async () => {
    seedSession({ branchId: BRANCH, permissions: ["pos.kds.view", "pos.kds.update"] });
    serve(realisticBoard());

    renderPicker();
    await pickerPill();
    expect(screen.getByTestId("station-tickets-HOTLINE").textContent?.trim()).toBe(
      `${TRUTH.tickets} tickets`,
    );
    expect(screen.getByTestId("station-items-HOTLINE").textContent?.trim()).toBe(
      `${TRUTH.items} items`,
    );
    // Four bare numbers under four stage names invite exactly the inference that was wrong.
    expect(screen.getByTestId("station-breakdown-caption-HOTLINE").textContent?.trim()).toBe(
      "Tickets by stage",
    );
    // The glance pill announces its unit too.
    expect(screen.getByTestId("station-queue-HOTLINE")).toHaveAttribute(
      "aria-label",
      `${TRUTH.tickets} tickets at Hot line`,
    );
    document.body.innerHTML = "";

    renderBoard();
    await boardHeader();
    expect(screen.getByTestId("kds-ticket-count").textContent?.trim()).toBe(
      `${TRUTH.tickets} tickets`,
    );
    expect(screen.getByTestId("kds-item-count").textContent?.trim()).toBe(`${TRUTH.items} items`);
    // A column header reading "New 4" announces "4 tickets", not "4".
    expect(screen.getByTestId("kds-column-count-NEW")).toHaveAttribute("aria-label", "4 tickets");
  });
});
