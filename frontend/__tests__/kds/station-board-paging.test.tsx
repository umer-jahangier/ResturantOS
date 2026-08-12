import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { StationBoard, KDS_JUMP_KEYS } from "@/components/kds/station-board";
import { KDS_COLUMN_ORDER, type KdsColumnKey } from "@/components/kds/kds-item-column";

/**
 * S1 #11 — "the kitchen board pages a board-wide flat list, so started work vanishes off
 * the cook's page."
 *
 * <p>The board used to build ONE flat list by concatenating whole columns in
 * New→Started→Preparing→Ready order and then slice it into pages of sixteen. With sixteen or
 * more NEW fragments open, page 1 was therefore all-NEW by construction and the three progress
 * columns in front of the cook were structurally empty — a cook bumped a ticket and it left the
 * screen. Measured live on 2026-08-12 before the fix:
 * `p1 NEW 16 / STARTED 0 / PREPARING 0 / READY 0`, `p2` identical, `p3 NEW 2 / STARTED 5 /
 * PREPARING 1 / READY 1`.
 *
 * <p>The second failure is the same root cause: positions were handed out only to the first ten
 * fragments of a sixteen-fragment page, so six visible cards on every page carried no number and
 * no jump key. Twelve such cards were counted live.
 *
 * <p>These tests assert the two INVARIANTS that make both impossible, not the particular
 * arithmetic that produces them:
 *   1. every non-empty column contributes to page 1 (no column can be starved by another);
 *   2. every card rendered on a page carries a position number a jump key can reach.
 */

const BRANCH = "b1000001-0000-4000-8000-000000000001";

vi.mock("@/lib/hooks/kds/use-kds-socket", () => ({
  useKdsSocket: () => ({ isConnected: true }),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

const GRILL = {
  id: "51000001-0000-4000-8000-000000000001",
  branchId: BRANCH,
  code: "GRILL",
  name: "Hot line",
  active: true,
  escalationThresholdSeconds: 900,
};

/** Item status that lands an item in each board column. */
const STATUS_FOR: Record<KdsColumnKey, string> = {
  NEW: "PENDING",
  STARTED: "ACCEPTED",
  PREPARING: "PREPARING",
  READY: "READY",
};

function pad(n: number) {
  return String(n).padStart(12, "0");
}

/** A wire-shape ticket whose single item sits in `column`. */
function rawTicket(n: number, column: KdsColumnKey) {
  return {
    id: `51000001-0000-4000-8000-${pad(n)}`,
    orderId: `52000001-0000-4000-8000-${pad(n)}`,
    orderNo: `ORD-${String(n).padStart(3, "0")}`,
    stationCode: "GRILL",
    status: "PENDING",
    priority: false,
    // Distinct receivedAt per ticket so the board sort is total and the page walk deterministic.
    receivedAt: new Date(Date.UTC(2026, 6, 11, 10, 0, 0) + n * 1000).toISOString(),
    startedAt: null,
    readyAt: null,
    orderNotes: null,
    tableNumber: "12",
    items: [
      {
        id: `53000001-0000-4000-8000-${pad(n)}`,
        orderItemId: `54000001-0000-4000-8000-${pad(n)}`,
        name: `Item ${n}`,
        qty: 1,
        modifiers: [],
        notes: null,
        status: STATUS_FOR[column],
        revisionNo: 1,
        firedAt: null,
      },
    ],
  };
}

/** `counts` = how many tickets sit in each column. */
function boardWith(counts: Partial<Record<KdsColumnKey, number>>) {
  const content: ReturnType<typeof rawTicket>[] = [];
  let n = 1;
  for (const column of KDS_COLUMN_ORDER) {
    for (let i = 0; i < (counts[column] ?? 0); i += 1) content.push(rawTicket(n++, column));
  }
  server.use(
    http.get("*/api/v1/kitchen/kds/stations", () => HttpResponse.json([GRILL])),
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
  return content;
}

function renderBoard() {
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <StationBoard branchId={BRANCH} stationCode="GRILL" />
    </Wrapper>,
  );
}

interface RenderedCard {
  key: string;
  /** The number PRINTED on the card face — what a cook reads at 2 m. */
  pos: string;
  /** The same number on the wrapper. Asserted equal, so neither can drift alone. */
  attr: string;
}

/** What is physically rendered in each column right now, with each card's position badge. */
function readColumns(): Record<KdsColumnKey, RenderedCard[]> {
  const out = {} as Record<KdsColumnKey, RenderedCard[]>;
  for (const column of KDS_COLUMN_ORDER) {
    const list = screen.getByTestId(`kds-column-list-${column}`);
    out[column] = Array.from(list.querySelectorAll("[data-fragment-key]")).map((el) => ({
      key: el.getAttribute("data-fragment-key") ?? "",
      pos:
        within(el as HTMLElement)
          .queryByTestId("kds-ticket-position")
          ?.textContent?.trim() ?? "",
      attr: el.getAttribute("data-position") ?? "",
    }));
  }
  return out;
}

function allCards(): RenderedCard[] {
  const cols = readColumns();
  return KDS_COLUMN_ORDER.flatMap((c) => cols[c]);
}

function pageIndicator() {
  return screen.queryByTestId("kds-page-indicator")?.textContent?.trim() ?? "1 / 1";
}

/** `"2 / 3"` → `[2, 3]`. */
function pageNumbers(): [number, number] {
  const [cur, of] = pageIndicator().split("/");
  return [Number((cur ?? "1").trim()), Number((of ?? "1").trim())];
}

afterEach(() => {
  clearSession();
  pushMock.mockReset();
});

describe("StationBoard paging — a column is never starved by another column", () => {
  it("puts every non-empty column on page 1, even with sixteen-plus tickets waiting in New", async () => {
    seedSession({ branchId: BRANCH, permissions: ["pos.kds.view", "pos.kds.update"] });
    boardWith({ NEW: 20, STARTED: 2, PREPARING: 1, READY: 1 });

    renderBoard();
    await waitFor(() => expect(screen.getByTestId("kds-board")).toBeInTheDocument());
    await waitFor(() => expect(readColumns().NEW.length).toBeGreaterThan(0));

    const cols = readColumns();
    // The register's exact observation was NEW 16 / STARTED 0 / PREPARING 0 / READY 0.
    for (const column of KDS_COLUMN_ORDER) {
      expect(
        cols[column].length,
        `column ${column} is empty on page 1 while it has open work`,
      ).toBeGreaterThan(0);
    }
    // …and the header still tells the cook how deep each queue really is.
    expect(screen.getByTestId("kds-column-count-NEW").textContent?.trim()).toBe("20");
    expect(screen.getByTestId("kds-column-count-STARTED").textContent?.trim()).toBe("2");
  });

  it("gives every card the cook can see a position number, on every page", async () => {
    seedSession({ branchId: BRANCH, permissions: ["pos.kds.view", "pos.kds.update"] });
    boardWith({ NEW: 20, STARTED: 2, PREPARING: 1, READY: 1 });

    renderBoard();
    await waitFor(() => expect(screen.getByTestId("kds-board")).toBeInTheDocument());
    await waitFor(() => expect(readColumns().NEW.length).toBeGreaterThan(0));

    const user = userEvent.setup();
    const seen: string[][] = [];
    for (let guard = 0; guard < 12; guard += 1) {
      const cards = allCards();
      expect(
        cards.filter((c) => !c.pos).map((c) => c.key),
        `page ${pageIndicator()} renders cards with no position number`,
      ).toEqual([]);
      // The printed number and the machine-readable one must be the same number.
      expect(cards.filter((c) => c.pos !== c.attr)).toEqual([]);
      // A position number is only usable if it is unique on the page the cook is looking at,
      // AND if it is a key the board actually listens for. Asserting the page's numbers are
      // the leading run of KDS_JUMP_KEYS pins both at once — and pins the invariant that
      // makes it true, that a page can never hold more fragments than there are keys.
      const positions = cards.map((c) => c.pos);
      expect(
        positions,
        `page ${pageIndicator()} numbers its cards with something other than the jump keys`,
      ).toEqual(KDS_JUMP_KEYS.slice(0, positions.length));
      seen.push(positions);

      const [cur, of] = pageNumbers();
      if (cur >= of) break;
      await user.keyboard("{PageDown}");
      await waitFor(() => expect(pageNumbers()[0]).toBe(cur + 1));
    }
    expect(seen.length).toBeGreaterThan(1); // the walk really did cross a boundary
  });

  it(
    "keeps a mouse-bumped ticket on the same page, in its new column",
    { timeout: 20000 },
    async () => {
      seedSession({ branchId: BRANCH, permissions: ["pos.kds.view", "pos.kds.update"] });
      const content = boardWith({ NEW: 20 });

      renderBoard();
      await waitFor(() => expect(screen.getByTestId("kds-board")).toBeInTheDocument());
      await waitFor(() => expect(readColumns().NEW.length).toBeGreaterThan(0));

      // The card the cook actually presses: the first one in the New column.
      const firstKey = readColumns().NEW[0]!.key;
      const ticketId = firstKey.split(":")[1]!;
      const ticket = content.find((t) => t.id === ticketId)!;
      const item = ticket.items[0]!;

      // The server answers as kitchen-service does: that item is now ACCEPTED (= Started).
      server.use(
        http.post(`*/api/v1/kitchen/kds/tickets/${ticketId}/items/${item.id}/status`, () =>
          HttpResponse.json({ ...ticket, items: [{ ...item, status: "ACCEPTED" }] }),
        ),
        http.get("*/api/v1/kitchen/kds/tickets", () =>
          HttpResponse.json({
            content: content.map((t) =>
              t.id === ticketId ? { ...t, items: [{ ...item, status: "ACCEPTED" }] } : t,
            ),
            totalElements: content.length,
            totalPages: 1,
            number: 0,
            size: 500,
          }),
        ),
      );

      const user = userEvent.setup();
      await user.click(screen.getByTestId(`column-move-${item.id}`));

      // It must be on the screen the cook is looking at — in the Started column.
      await waitFor(
        () =>
          expect(
            readColumns().STARTED.map((c) => c.key),
            "the bumped ticket left the cook's page instead of appearing in Started",
          ).toContain(`STARTED:${ticketId}`),
        { timeout: 5000 },
      );
    },
  );

  it(
    "follows a bumped ticket to another page when its new column is deeper than one page",
    { timeout: 20000 },
    async () => {
      seedSession({ branchId: BRANCH, permissions: ["pos.kds.view", "pos.kds.update"] });
      // Started is twenty deep and — because `boardWith` numbers the Started tickets last and
      // the board sorts newest-first — every one of them sorts AHEAD of every New ticket. So a
      // bumped New ticket lands at the very bottom of Started, pages away. Fair paging alone
      // cannot save this case; only following the focus can. Measured live: two of four
      // consecutive mouse bumps disappeared exactly like this before the board followed focus.
      const content = boardWith({ NEW: 20, STARTED: 20 });

      renderBoard();
      await waitFor(() => expect(screen.getByTestId("kds-board")).toBeInTheDocument());
      await waitFor(() => expect(readColumns().NEW.length).toBeGreaterThan(0));
      expect(pageNumbers()[0]).toBe(1);

      const ticketId = readColumns().NEW[0]!.key.split(":")[1]!;
      const ticket = content.find((t) => t.id === ticketId)!;
      const item = ticket.items[0]!;
      server.use(
        http.post(`*/api/v1/kitchen/kds/tickets/${ticketId}/items/${item.id}/status`, () =>
          HttpResponse.json({ ...ticket, items: [{ ...item, status: "ACCEPTED" }] }),
        ),
        http.get("*/api/v1/kitchen/kds/tickets", () =>
          HttpResponse.json({
            content: content.map((t) =>
              t.id === ticketId ? { ...t, items: [{ ...item, status: "ACCEPTED" }] } : t,
            ),
            totalElements: content.length,
            totalPages: 1,
            number: 0,
            size: 500,
          }),
        ),
      );

      const user = userEvent.setup();
      await user.click(screen.getByTestId(`column-move-${item.id}`));

      await waitFor(
        () =>
          expect(
            readColumns().STARTED.map((c) => c.key),
            "the board did not follow the bumped ticket to the page it landed on",
          ).toContain(`STARTED:${ticketId}`),
        { timeout: 5000 },
      );
      // …and it is the FOCUSED card, so F bumps it again without the cook hunting for it.
      const card = screen.getByTestId(`kds-fragment-STARTED-${ticketId}`);
      expect(within(card).getByTestId("kds-ticket-card").getAttribute("data-focused")).toBe("true");
      // The board really did turn a page to get there — this is not page 1 by luck.
      expect(pageNumbers()[0]).toBeGreaterThan(1);
    },
  );

  it(
    "the number printed on a Preparing card jumps to it, and F advances it to Ready",
    { timeout: 20000 },
    async () => {
      seedSession({ branchId: BRANCH, permissions: ["pos.kds.view", "pos.kds.update"] });
      // The exact shape the register describes: New is deep enough to have owned the whole
      // page, and one lone ticket is mid-cook in Preparing.
      const content = boardWith({ NEW: 20, PREPARING: 1 });

      renderBoard();
      await waitFor(() => expect(screen.getByTestId("kds-board")).toBeInTheDocument());
      await waitFor(() => expect(readColumns().NEW.length).toBeGreaterThan(0));

      const preparing = readColumns().PREPARING;
      expect(preparing.length, "the Preparing card is not on the cook's page").toBe(1);
      const { key, pos } = preparing[0]!;
      expect(pos, "the Preparing card carries no jump key").not.toBe("");

      const ticketId = key.split(":")[1]!;
      const itemId = content.find((t) => t.id === ticketId)!.items[0]!.id;
      let posted: { status?: string } | null = null;
      server.use(
        http.post(
          `*/api/v1/kitchen/kds/tickets/${ticketId}/items/${itemId}/status`,
          async ({ request }) => {
            posted = (await request.json()) as { status?: string };
            return HttpResponse.json(content.find((t) => t.id === ticketId));
          },
        ),
      );

      const user = userEvent.setup();
      await user.keyboard(pos); // the number the cook reads off the card
      await waitFor(() => {
        const card = screen.getByTestId(`kds-fragment-PREPARING-${ticketId}`);
        expect(
          within(card).getByTestId("kds-ticket-card").getAttribute("data-focused"),
          "the number key did not move focus to the card showing that number",
        ).toBe("true");
      });

      await user.keyboard("f");
      await waitFor(() => expect(posted).not.toBeNull());
      expect(posted!.status, "F did not advance the Preparing item to Ready").toBe("READY");
    },
  );
});
