import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { StationBoard } from "@/components/kds/station-board";

/**
 * S1 #18 — a typo'd station code rendered a perfectly healthy board.
 *
 * <p>`/app/kitchen/NOPE123` produced `<h1>NOPE123</h1>`, "0 tickets" and a green LIVE badge,
 * because the route handed the raw URL segment to the ticket query — which answers an empty page
 * for ANY code — and the WebSocket subscribes to any code too. A cook could not tell a typo from a
 * station that simply had no work, on the one screen whose entire job is to answer that question.
 *
 * <p>The three tests below are a set, and the second and third are the ones that matter: the
 * membership check must never fire while the station list is still loading, and must never fire
 * when the list request FAILED. Getting that ordering wrong would trade "a typo looks healthy" for
 * "a kitchen-service outage says the station does not exist", which is strictly worse.
 */

const BRANCH = "b1000001-0000-4000-8000-000000000001";

// The board opens a WebSocket for live pushes; jsdom has no server to talk to and the socket is
// not what is under test here.
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

function stationsRespond(body: Record<string, unknown>[]) {
  server.use(http.get("*/api/v1/kitchen/kds/stations", () => HttpResponse.json(body)));
}

function stationsFail(status: number) {
  server.use(
    http.get("*/api/v1/kitchen/kds/stations", () => new HttpResponse(null, { status })),
  );
}

function ticketsRespondEmpty() {
  server.use(
    http.get("*/api/v1/kitchen/kds/tickets", () =>
      HttpResponse.json({ content: [], totalElements: 0, totalPages: 0, number: 0, size: 500 }),
    ),
  );
}

function renderBoard(stationCode: string) {
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <StationBoard branchId={BRANCH} stationCode={stationCode} />
    </Wrapper>,
  );
}

afterEach(() => {
  clearSession();
  pushMock.mockReset();
});

describe("StationBoard — a station code that is not in the branch's registry", () => {
  it("shows a not-found state instead of a healthy empty board with a LIVE badge", async () => {
    seedSession({ branchId: BRANCH, permissions: ["pos.kds.view", "pos.kds.update"] });
    stationsRespond([GRILL]);
    ticketsRespondEmpty();

    renderBoard("NOPE123");

    await waitFor(() => {
      expect(screen.getByTestId("kds-station-unknown")).toBeInTheDocument();
    });
    expect(screen.getByText("No such station")).toBeInTheDocument();
    // The three things the old screen showed, and must not: the code as a heading, a ticket
    // count, and a connection badge reading LIVE.
    expect(screen.queryByRole("heading", { name: "NOPE123" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("kds-ticket-count")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kds-connection")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kds-board")).not.toBeInTheDocument();
  });

  it("never flashes the code as a heading while the station list is still loading", async () => {
    seedSession({ branchId: BRANCH, permissions: ["pos.kds.view", "pos.kds.update"] });
    // Deliberately NOT resolved: this asserts the FIRST paint, before any response lands.
    server.use(http.get("*/api/v1/kitchen/kds/stations", () => new Promise(() => {})));
    ticketsRespondEmpty();

    renderBoard("NOPE123");

    expect(screen.getByTestId("kds-station-resolving")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "NOPE123" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("kds-connection")).not.toBeInTheDocument();
  });

  it("renders the real board for a code that IS in the registry", async () => {
    seedSession({ branchId: BRANCH, permissions: ["pos.kds.view", "pos.kds.update"] });
    stationsRespond([GRILL]);
    ticketsRespondEmpty();

    renderBoard("GRILL");

    // The station's NAME, from the registry — not the raw URL segment.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Hot line" })).toBeInTheDocument();
    });
    expect(screen.getByTestId("kds-board")).toBeInTheDocument();
    expect(screen.queryByTestId("kds-station-unknown")).not.toBeInTheDocument();
  });

  it("shows the FAILURE, not 'no such station', when the station list request fails", async () => {
    seedSession({ branchId: BRANCH, permissions: ["pos.kds.view", "pos.kds.update"] });
    stationsFail(503);
    ticketsRespondEmpty();

    renderBoard("GRILL");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("kds-station-unknown"))
      .toBeNull();
  });
});
