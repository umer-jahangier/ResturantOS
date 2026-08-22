import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { StationBoard } from "@/components/kds/station-board";

/**
 * F17 — "nothing ages a ticket off a KDS board; a five-day-old ticket sits at the head of a board
 * paginated 1 / 12."
 *
 * <p>Measured live as {@code kitchen@terrace.local} on branch F-7, 2026-08-12, and cross-read over
 * HTTP on the cook's own bearer: station DEFAULT carried <b>75 active tickets on a board paginated
 * 1/7, ten of them received on 2026-08-07</b> — 123 hours before the read — in the PENDING and
 * READY columns. There was no bulk clear, no expiry and no route back to a clean board.
 *
 * <h3>These tests render the REAL board, and assert what a cook reads</h3>
 *
 * <p>Not the dialog component in isolation, and never a prop. The register's signature failure is a
 * feature that is structurally present and behaviourally absent — {@code useApplyDiscount()} with
 * zero callers, a {@code serviceModel} field read by nothing — so a test that mounts the control
 * directly would prove exactly the thing that keeps being false: that it is reachable from the
 * screen. Every assertion below starts by rendering {@code StationBoard} and finding the control by
 * the words on its face.
 *
 * <p>The five cases are the five states, and the last two are the ones that get skipped: a clear
 * that FAILS must say nothing was cleared and leave the board alone, and a stale CHECK that fails
 * must not render as "your board is clean" — an error wearing an empty state's clothes is the trap
 * both audit reports name most often.
 */

const BRANCH = "b1000001-0000-4000-8000-000000000001";

/**
 * THE CLOCK IS INJECTED. Everything below is measured against this instant and nothing reads the
 * wall.
 *
 * <p>This file used to render the walkthrough's real 2026-08-07 ticket against whatever day the
 * suite happened to run on and assert {@code /5d/} — true on the day it was written, false from
 * 2026-08-13 onward, and by 2026-08-21 the dialog was rendering {@code 14d 17h} against a fixture
 * that had not changed a character. That is not a flake: it is an assertion about a CONSTANT that
 * was written against a VARIABLE, and it fails louder every day it is left.
 *
 * <p>2026-08-12 10:00 Asia/Karachi — inside the trading day that {@link DAY_START} opened, after
 * {@link THIS_MORNING}'s service, and five days and change after {@link FIVE_DAYS_AGO}. The one
 * `now` the dialog, the board and every ticket card underneath it all age against.
 * `lib/format/elapsed.ts` takes it explicitly for exactly this reason.
 */
const NOW = Date.parse("2026-08-12T05:00:00.000Z");

vi.mock("@/lib/hooks/kds/use-kds-clock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks/kds/use-kds-clock")>();
  return { ...actual, useKdsClock: () => NOW };
});

vi.mock("@/lib/hooks/kds/use-kds-socket", () => ({
  useKdsSocket: () => ({ isConnected: true }),
}));

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

const DEFAULT_STATION = {
  id: "51000001-0000-4000-8000-000000000001",
  branchId: BRANCH,
  code: "DEFAULT",
  name: "Main line",
  active: true,
  escalationThresholdSeconds: 900,
};

/** 2026-08-12 04:00 Asia/Karachi — the instant that branch's trading day opened. */
const DAY_START = "2026-08-11T23:00:00.000Z";
/** 2026-08-07 01:39Z — the real oldest ticket the walkthrough found on DEFAULT. */
const FIVE_DAYS_AGO = "2026-08-07T01:39:26.962Z";
/** 07:15 Karachi on 2026-08-12 — this morning's service, INSIDE the UTC-vs-local trap window. */
const THIS_MORNING = "2026-08-12T02:15:00.000Z";

function pad(n: number) {
  return String(n).padStart(12, "0");
}

function rawTicket(n: number, receivedAt: string, orderNo: string) {
  return {
    id: `51000001-0000-4000-8000-${pad(n)}`,
    orderId: `52000001-0000-4000-8000-${pad(n)}`,
    orderNo,
    stationCode: "DEFAULT",
    status: "PENDING",
    priority: false,
    receivedAt,
    startedAt: null,
    readyAt: null,
    clearedAt: null,
    orderNotes: null,
    tableNumber: "H1",
    orderType: "DINE_IN",
    items: [
      {
        id: `53000001-0000-4000-8000-${pad(n)}`,
        orderItemId: `54000001-0000-4000-8000-${pad(n)}`,
        name: "Audit Item 52235",
        qty: 1,
        modifiers: [],
        notes: null,
        status: "PENDING",
        revisionNo: 1,
        firedAt: null,
      },
    ],
  };
}

const OLD_TICKET = rawTicket(1, FIVE_DAYS_AGO, "ORD-20260807-0001");
const TODAYS_TICKET = rawTicket(2, THIS_MORNING, "ORD-20260812-0246");

function staleSummary(overrides: Record<string, unknown> = {}) {
  return {
    branchId: BRANCH,
    stationCode: "DEFAULT",
    branchTimezone: "Asia/Karachi",
    businessDayOffsetHours: 4,
    currentBusinessDate: "2026-08-12",
    currentBusinessDayStartedAt: DAY_START,
    ticketCount: 1,
    itemCount: 1,
    finishedTicketCount: 0,
    oldestReceivedAt: FIVE_DAYS_AGO,
    days: [{ businessDate: "2026-08-07", ticketCount: 1 }],
    tickets: [
      {
        id: OLD_TICKET.id,
        orderNo: OLD_TICKET.orderNo,
        stationCode: "DEFAULT",
        tableNumber: "H1",
        orderType: "DINE_IN",
        status: "PENDING",
        receivedAt: FIVE_DAYS_AGO,
        businessDate: "2026-08-07",
        itemCount: 1,
      },
    ],
    ...overrides,
  };
}

/**
 * The board, the stations and the stale summary. `tickets` is a callback so a test can change the
 * board's answer AFTER the clear — which is the only way to assert "the board came back to today's
 * work" rather than "the request was sent".
 */
function serve(options: {
  tickets: () => ReturnType<typeof rawTicket>[];
  stale?: () => unknown;
  staleStatus?: number;
  onClear?: () => Response;
}) {
  server.use(
    http.get("*/api/v1/kitchen/kds/stations", () => HttpResponse.json([DEFAULT_STATION])),
    http.get("*/api/v1/kitchen/kds/tickets/stale", () => {
      if (options.staleStatus && options.staleStatus >= 400) {
        return new HttpResponse(null, { status: options.staleStatus });
      }
      return HttpResponse.json({ data: options.stale ? options.stale() : staleSummary() });
    }),
    http.get("*/api/v1/kitchen/kds/tickets", () => {
      const content = options.tickets();
      return HttpResponse.json({
        content,
        totalElements: content.length,
        totalPages: 1,
        number: 0,
        size: 500,
      });
    }),
    http.post("*/api/v1/kitchen/kds/tickets/clear-stale", () =>
      options.onClear
        ? options.onClear()
        : HttpResponse.json({
            data: {
              branchId: BRANCH,
              stationCode: "DEFAULT",
              branchTimezone: "Asia/Karachi",
              currentBusinessDate: "2026-08-12",
              currentBusinessDayStartedAt: DAY_START,
              clearedTicketCount: 1,
              clearedItemCount: 1,
              oldestClearedReceivedAt: FIVE_DAYS_AGO,
              clearedAt: new Date().toISOString(),
              clearedTicketIds: [OLD_TICKET.id],
            },
          }),
    ),
  );
}

function renderBoard() {
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <StationBoard branchId={BRANCH} stationCode="DEFAULT" />
    </Wrapper>,
  );
}

beforeEach(() => {
  seedSession({
    branchId: BRANCH,
    roles: ["KITCHEN_STAFF"],
    permissions: ["pos.kds.view", "pos.kds.update"],
  });
});

afterEach(() => {
  clearSession();
  vi.clearAllMocks();
});

describe("F17 — a cook can get back to a clean board", () => {
  it("offers no clear control on a board with nothing older than today's service", async () => {
    serve({
      tickets: () => [TODAYS_TICKET],
      stale: () =>
        staleSummary({
          ticketCount: 0,
          itemCount: 0,
          oldestReceivedAt: null,
          days: [],
          tickets: [],
        }),
    });
    renderBoard();

    await screen.findByText("ORD-20260812-0246");
    await waitFor(() => {
      expect(screen.queryByTestId("kds-clear-stale-loading")).not.toBeInTheDocument();
    });
    // A control that does nothing on a wall display is noise, and pressing it once teaches a cook
    // it is meaningless. Its PRESENCE is the notification.
    expect(screen.queryByTestId("kds-clear-stale-trigger")).not.toBeInTheDocument();
  });

  it("names how many are old, and the confirmation states how old and which boundary it applies", async () => {
    serve({ tickets: () => [OLD_TICKET, TODAYS_TICKET] });
    const user = userEvent.setup();
    renderBoard();

    const trigger = await screen.findByRole("button", { name: /Clear 1 old/i });
    await user.click(trigger);

    const dialog = await screen.findByTestId("kds-clear-stale-dialog");

    // HOW MANY, and on which board.
    expect(within(dialog).getByText(/Clear 1 ticket from Main line\?/i)).toBeInTheDocument();
    // HOW OLD — in prose a cook can act on, plus the order number, not a bare "123:35:12".
    // `5d` deliberately: the ticket face's mm:ss timer is unreadable in a sentence, which is why
    // `formatElapsedLong` exists beside `formatElapsedCompact` rather than instead of it. Both
    // now come from `lib/format/elapsed.ts` — the board's own `formatAgeLong` said `5d 3h` here
    // while the station picker said `5d`, which is the disagreement that module exists to end.
    expect(dialog).toHaveTextContent(/5d/);
    expect(dialog).toHaveTextContent(/ORD-20260807-0001/);
    // WHICH BOUNDARY, and on WHOSE clock. 04:00 Karachi, not 09:00 — this product has already
    // shipped a trading day cut in UTC while the settings screen promised the branch's own zone,
    // and the failure was invisible because no screen said which boundary it had used.
    const boundary = within(dialog).getByTestId("kds-clear-stale-boundary");
    expect(boundary).toHaveTextContent("04:00");
    expect(boundary).toHaveTextContent("Asia/Karachi");
    expect(boundary).toHaveTextContent(/Nothing fired since then is touched/i);
    // AND that this is not a delete, and not a void.
    expect(within(dialog).getByText(/kept, not deleted/i)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/does not void, close or settle the orders/i),
    ).toBeInTheDocument();
    // The tickets themselves are named, not just counted.
    expect(
      within(screen.getByTestId("kds-clear-stale-list")).getByText(/ORD-20260807-0001/),
    ).toBeInTheDocument();
  });

  it("clears them, says so, and the board comes back to today's work", async () => {
    let cleared = false;
    serve({
      tickets: () => (cleared ? [TODAYS_TICKET] : [OLD_TICKET, TODAYS_TICKET]),
      stale: () =>
        cleared
          ? staleSummary({
              ticketCount: 0,
              itemCount: 0,
              oldestReceivedAt: null,
              days: [],
              tickets: [],
            })
          : staleSummary(),
      onClear: () => {
        cleared = true;
        return HttpResponse.json({
          data: {
            branchId: BRANCH,
            stationCode: "DEFAULT",
            branchTimezone: "Asia/Karachi",
            currentBusinessDate: "2026-08-12",
            currentBusinessDayStartedAt: DAY_START,
            clearedTicketCount: 1,
            clearedItemCount: 1,
            oldestClearedReceivedAt: FIVE_DAYS_AGO,
            clearedAt: new Date().toISOString(),
            clearedTicketIds: [OLD_TICKET.id],
          },
        });
      },
    });
    const user = userEvent.setup();
    renderBoard();

    await screen.findByText("ORD-20260807-0001");
    await user.click(await screen.findByRole("button", { name: /Clear 1 old/i }));
    await user.click(await screen.findByTestId("kds-clear-stale-confirm"));

    // What the cook is told — heard as well as seen. The dialog's heading changing is silent to a
    // screen reader, so the same sentence is announced.
    const dialog = await screen.findByTestId("kds-clear-stale-dialog");
    await waitFor(() => expect(dialog).toHaveTextContent(/1 ticket cleared/i));
    expect(within(dialog).getByRole("heading", { name: /1 ticket cleared/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("status")).toHaveTextContent(/1 ticket cleared/i);
    expect(screen.getByText(/taken off the board, not deleted/i)).toBeInTheDocument();
    // And where the record is.
    expect(screen.getByTestId("kds-clear-stale-view-cleared")).toHaveAttribute(
      "href",
      "/app/kitchen/DEFAULT/cleared",
    );

    await user.click(screen.getByTestId("kds-clear-stale-done"));

    // The BOARD, not the request: the five-day-old check is gone and this morning's is not.
    await waitFor(() => {
      expect(screen.queryByText("ORD-20260807-0001")).not.toBeInTheDocument();
    });
    expect(screen.getByText("ORD-20260812-0246")).toBeInTheDocument();
    // And the control retires itself, because there is nothing left to clear.
    await waitFor(() => {
      expect(screen.queryByTestId("kds-clear-stale-trigger")).not.toBeInTheDocument();
    });
  });

  it("a refused clear says nothing was cleared, and the tickets stay on the board", async () => {
    serve({
      tickets: () => [OLD_TICKET, TODAYS_TICKET],
      onClear: () =>
        HttpResponse.json(
          {
            title: "BRANCH_TIMEZONE_UNKNOWN",
            detail:
              "This branch's time zone could not be read, so the start of today's trading day is not known. Nothing was cleared.",
            status: 503,
          },
          { status: 503 },
        ),
    });
    const user = userEvent.setup();
    renderBoard();

    await user.click(await screen.findByRole("button", { name: /Clear 1 old/i }));
    await user.click(await screen.findByTestId("kds-clear-stale-confirm"));

    const failure = await screen.findByTestId("kds-clear-stale-failed");
    expect(failure).toHaveAttribute("role", "alert");
    expect(failure).toHaveTextContent(/Nothing was cleared/i);
    // Never a raw status line.
    expect(failure).not.toHaveTextContent(/500|Internal Server Error/);
    // The board is untouched, and the dialog has not pretended to succeed.
    expect(screen.queryByText(/1 ticket cleared/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("kds-clear-stale-confirm")).toBeInTheDocument();
  });

  it("a failed check for old tickets is not rendered as a clean board", async () => {
    serve({ tickets: () => [OLD_TICKET], staleStatus: 500 });
    renderBoard();

    // GA-001, on the screen where it costs most: silence here reads as "your board is clean",
    // which is exactly the sentence this product must never say when it does not know.
    const notice = await screen.findByTestId("kds-clear-stale-error");
    expect(notice).toHaveAttribute("role", "alert");
    expect(notice).toHaveTextContent(/Couldn't check for old tickets/i);
    expect(screen.getByTestId("kds-clear-stale-retry")).toBeInTheDocument();
  });

  it("a cook without pos.kds.update is not offered the control at all", async () => {
    clearSession();
    seedSession({ branchId: BRANCH, roles: ["KITCHEN_STAFF"], permissions: ["pos.kds.view"] });
    serve({ tickets: () => [OLD_TICKET] });
    renderBoard();

    await screen.findByText("ORD-20260807-0001");
    expect(screen.queryByTestId("kds-clear-stale-trigger")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kds-clear-stale-loading")).not.toBeInTheDocument();
  });
});
