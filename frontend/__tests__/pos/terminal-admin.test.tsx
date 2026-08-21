import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import TerminalsPage from "@/app/(tenant)/app/terminals/page";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * The POS terminal catalogue UI (28-09).
 *
 * <p>`POST /api/v1/pos/terminals` has existed since 28-04 with nineteen integration tests and no
 * caller — "that terminal shows that menu" was proven only by `PosTerminalAdminIT`. This screen is
 * the first way an owner can create one.
 *
 * <p>The assertions that matter: an empty category set summarised as **offers the whole menu** in
 * words (an empty list and "offers nothing" are opposites and must never look alike), and the
 * failure state never rendering as "no terminals yet".
 */

const BRANCH = "b1000001-0000-4000-8000-000000000001";
const DRINKS = "c1000001-0000-4000-8000-000000000001";
const MAINS = "c1000001-0000-4000-8000-000000000002";
const BAR_STATION = "51000001-0000-4000-8000-000000000002";

const rawCategories = [
  { id: DRINKS, name: "Drinks", description: null, sortOrder: 1, active: true },
  { id: MAINS, name: "Mains", description: null, sortOrder: 2, active: true },
];

const rawStations = [
  {
    id: BAR_STATION,
    branchId: BRANCH,
    code: "BAR",
    name: "Main bar",
    active: true,
    stationType: "BAR",
    displayFamily: "BAR",
  },
];

const counterTerminal = {
  id: "71000001-0000-4000-8000-000000000001",
  branchId: BRANCH,
  code: "COUNTER1",
  name: "Front counter",
  serviceModel: "COUNTER",
  defaultOrderType: "DINE_IN",
  printerRef: null,
  active: true,
  categoryIds: [],
  stationIds: [],
  offersWholeMenu: true,
  firesToAllStations: true,
};

const barTerminal = {
  ...counterTerminal,
  id: "71000001-0000-4000-8000-000000000002",
  code: "BAR1",
  name: "Bar till",
  categoryIds: [DRINKS],
  stationIds: [BAR_STATION],
  offersWholeMenu: false,
  firesToAllStations: false,
};

const retiredTerminal = {
  ...counterTerminal,
  id: "71000001-0000-4000-8000-000000000003",
  code: "OLDWINDOW",
  name: "Old window",
  active: false,
};

function mockEndpoints(terminals: unknown[] = [counterTerminal, barTerminal, retiredTerminal]) {
  server.use(
    http.get("*/api/v1/pos/terminals", () =>
      HttpResponse.json({ data: terminals, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/menu/categories", () =>
      HttpResponse.json({ data: rawCategories, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/stations", () =>
      HttpResponse.json({ data: rawStations, meta: null, warnings: [] }),
    ),
  );
}

function renderPage(permissions: string[] = ["pos.terminals.admin", "pos.menu.view"]) {
  seedSession({ permissions, branchId: BRANCH });
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <TerminalsPage />
    </Wrapper>,
  );
}

describe("POS Terminals page", () => {
  afterEach(() => {
    clearSession();
    vi.clearAllMocks();
  });

  it("lists active terminals with their name, code and service model", async () => {
    mockEndpoints();
    renderPage();

    expect(await screen.findByText("Front counter")).toBeInTheDocument();
    expect(screen.getByText("COUNTER1")).toBeInTheDocument();
    expect(screen.getAllByText("Counter").length).toBeGreaterThan(0);
    expect(screen.getByText("Bar till")).toBeInTheDocument();
  });

  it("summarises a terminal with NO category scope as offering the whole menu, in words", async () => {
    mockEndpoints([counterTerminal]);
    renderPage();

    const summary = await screen.findByTestId("terminal-menu-summary");
    expect(summary).toHaveTextContent("Offers the whole menu");
    expect(summary).toHaveTextContent("fires to every station");
  });

  it("summarises a scoped terminal by NAMING its categories and stations", async () => {
    mockEndpoints([barTerminal]);
    renderPage();

    const summary = await screen.findByTestId("terminal-menu-summary");
    expect(summary).toHaveTextContent("Offers Drinks");
    expect(summary).toHaveTextContent("fires to Main bar");
  });

  it("states in the menu scope picker that ticking nothing offers the whole menu", async () => {
    mockEndpoints();
    renderPage();
    await screen.findByText("Front counter");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add terminal" }));

    expect(await screen.findByTestId("menu-scope-summary")).toHaveTextContent(
      "Tick nothing and this terminal offers the whole menu.",
    );
    expect(screen.getByTestId("station-set-summary")).toHaveTextContent(
      "Tick nothing and this terminal fires to every station in the branch.",
    );
  });

  it("lists the branch's categories and stations, and updates the sentence on selection", async () => {
    mockEndpoints();
    renderPage();
    await screen.findByText("Front counter");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add terminal" }));

    const menuPicker = await screen.findByTestId("menu-scope-picker");
    await user.click(within(menuPicker).getByLabelText("Drinks"));
    expect(within(menuPicker).getByTestId("menu-scope-summary")).toHaveTextContent(
      "This terminal shows Drinks only.",
    );

    const stationPicker = screen.getByTestId("station-set-picker");
    expect(within(stationPicker).getByLabelText(/Main bar/)).toBeInTheDocument();
    await user.click(within(stationPicker).getByLabelText(/Main bar/));
    expect(within(stationPicker).getByTestId("station-set-summary")).toHaveTextContent(
      "This terminal fires to Main bar only.",
    );
  });

  it("creates a bar terminal scoped to drinks, sending both scope arrays explicitly", async () => {
    mockEndpoints();
    let body: unknown = null;
    server.use(
      http.post("*/api/v1/pos/terminals", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: barTerminal, meta: null, warnings: [] }, { status: 201 });
      }),
    );
    renderPage();
    await screen.findByText("Front counter");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add terminal" }));
    await user.type(await screen.findByLabelText("Code"), "bar1");
    await user.type(screen.getByLabelText("Name"), "Bar till");
    await user.click(within(screen.getByTestId("menu-scope-picker")).getByLabelText("Drinks"));
    await user.click(within(screen.getByTestId("station-set-picker")).getByLabelText(/Main bar/));
    await user.click(screen.getByRole("button", { name: "Add terminal" }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body).toEqual({
      // Upper-cased: the code is the handle a till remembers itself by.
      code: "BAR1",
      name: "Bar till",
      serviceModel: "COUNTER",
      defaultOrderType: "DINE_IN",
      categoryIds: [DRINKS],
      stationIds: [BAR_STATION],
    });
  });

  it("surfaces the server's conflict message inline when a code is already taken", async () => {
    mockEndpoints();
    server.use(
      http.post("*/api/v1/pos/terminals", () =>
        HttpResponse.json(
          {
            error: {
              code: "STATE_INVALID",
              message: "Terminal code already exists for this branch: BAR1",
            },
          },
          { status: 409 },
        ),
      ),
    );
    renderPage();
    await screen.findByText("Front counter");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add terminal" }));
    await user.type(await screen.findByLabelText("Code"), "BAR1");
    await user.type(screen.getByLabelText("Name"), "Second bar till");
    await user.click(screen.getByRole("button", { name: "Add terminal" }));

    expect(await screen.findByTestId("terminal-form-error")).toHaveTextContent(
      /Terminal code already exists/,
    );
  });

  it("hides retired terminals until the toggle is checked, then marks them", async () => {
    mockEndpoints();
    renderPage();
    await screen.findByText("Front counter");

    expect(screen.queryByText("Old window")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Show retired"));

    expect(await screen.findByText("Old window")).toBeInTheDocument();
    expect(screen.getByText("Retired")).toBeInTheDocument();
  });

  it("asks for confirmation before retiring, and offers no delete anywhere", async () => {
    mockEndpoints();
    server.use(
      http.post("*/api/v1/pos/terminals/:id/deactivate", () =>
        HttpResponse.json({ data: { ...barTerminal, active: false }, warnings: [] }),
      ),
    );
    renderPage();
    await screen.findByText("Bar till");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Actions for Bar till" }));

    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Edit", "Retire"]);

    await user.click(screen.getByRole("menuitem", { name: "Retire" }));
    expect(await screen.findByText("Retire Bar till?")).toBeInTheDocument();
    // No delete CONTROL. The confirmation copy does say "nothing is deleted", which is the point —
    // so this asserts the absence of an actionable delete rather than of the word.
    expect(screen.queryByRole("button", { name: /delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /delete/i })).not.toBeInTheDocument();
  });

  it("shows no management actions to a user without pos.terminals.admin", async () => {
    mockEndpoints();
    renderPage(["pos.menu.view"]);

    expect(await screen.findByText("Front counter")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add terminal" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Actions for Front counter" }),
    ).not.toBeInTheDocument();
  });

  it("renders the FAILURE state with a retry, never the empty state, when the load fails", async () => {
    server.use(
      http.get("*/api/v1/pos/terminals", () => HttpResponse.json({ error: {} }, { status: 500 })),
      http.get("*/api/v1/pos/menu/categories", () =>
        HttpResponse.json({ data: rawCategories, meta: null, warnings: [] }),
      ),
      http.get("*/api/v1/pos/stations", () =>
        HttpResponse.json({ data: rawStations, meta: null, warnings: [] }),
      ),
    );
    renderPage();

    expect(await screen.findByTestId("query-error")).toBeInTheDocument();
    expect(screen.getByTestId("query-error-retry")).toBeInTheDocument();
    expect(screen.queryByText("No POS terminals yet")).not.toBeInTheDocument();
  });
});
