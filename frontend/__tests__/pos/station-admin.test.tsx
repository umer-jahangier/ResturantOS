import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { toast } from "sonner";
import StationsPage from "@/app/(tenant)/app/stations/page";
import { StationFormDialog } from "@/components/stations/station-form-dialog";
import { navGroups } from "@/components/shared/sidebar-nav-items";

// The app mounts <Toaster /> at the layout level, which these component-scoped tests do not — so
// a toast leaves no DOM to query. Spying is how the confirmation can still be asserted.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * The station catalogue UI (28-06).
 *
 * <p>Before this screen, `/api/v1/pos/stations` had complete CRUD, nine integration tests and
 * ZERO frontend callers — creating a station required curl, which is precisely what D-28-05
 * refuses. The assertion that matters most here is the error-before-empty one: a screen whose
 * whole job is to say which stations exist must never say "No stations yet" because pos-service
 * is down (GA-001, eleven list screens).
 */

const BRANCH = "b1000001-0000-4000-8000-000000000001";
const GRILL = "51000001-0000-4000-8000-000000000001";
const BAR = "51000001-0000-4000-8000-000000000002";
const OLD_PASS = "51000001-0000-4000-8000-000000000003";

const rawStations = [
  {
    id: GRILL,
    branchId: BRANCH,
    code: "GRILL",
    name: "Hot line",
    active: true,
    stationType: "KITCHEN",
    displayFamily: "KITCHEN",
  },
  {
    id: BAR,
    branchId: BRANCH,
    code: "BAR",
    name: "Main bar",
    active: true,
    stationType: "BAR",
    displayFamily: "BAR",
  },
  {
    id: OLD_PASS,
    branchId: BRANCH,
    code: "OLDPASS",
    name: "Old pass",
    active: false,
    stationType: "EXPO",
    displayFamily: "EXPO",
  },
];

function mockStationList(stations: unknown[] = rawStations) {
  server.use(
    http.get("*/api/v1/pos/stations", () =>
      HttpResponse.json({ data: stations, meta: null, warnings: [] }),
    ),
  );
}

function renderPage(permissions: string[] = ["pos.menu.view", "pos.menu.manage"]) {
  seedSession({ permissions, branchId: BRANCH });
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <StationsPage />
    </Wrapper>,
  );
}

describe("Stations page", () => {
  afterEach(() => {
    clearSession();
    vi.clearAllMocks();
  });

  it("lists the branch's active stations with their code, name and type", async () => {
    mockStationList();
    renderPage();

    const kitchen = await screen.findByRole("group", { name: "Kitchen screen stations" });
    expect(within(kitchen).getByText("GRILL")).toBeInTheDocument();
    expect(within(kitchen).getByText("Hot line")).toBeInTheDocument();
    expect(within(kitchen).getByText("Kitchen")).toBeInTheDocument();

    const bar = await screen.findByRole("group", { name: "Bar screen stations" });
    expect(within(bar).getByText("BAR")).toBeInTheDocument();
    expect(within(bar).getByText("Main bar")).toBeInTheDocument();
  });

  it("offers the type as a fixed set of options that cannot be typed into freely", async () => {
    mockStationList();
    renderPage();
    await screen.findByText("GRILL");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add station" }));

    const typeControl = await screen.findByTestId("station-type-select");
    // A <select> cannot receive arbitrary text. This is the assertion that a trailing space can
    // never get in — D-28-01 exists because "Bar", "bar" and "BAR " become three stations.
    expect(typeControl.tagName).toBe("SELECT");
    const options = within(typeControl as HTMLSelectElement).getAllByRole("option");
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual([
      "KITCHEN",
      "BAR",
      "PANTRY",
      "EXPO",
      "DESSERT",
    ]);
  });

  it("surfaces the server's own conflict message when a code is already taken", async () => {
    mockStationList();
    server.use(
      http.post("*/api/v1/pos/stations", () =>
        HttpResponse.json(
          {
            error: {
              code: "STATE_INVALID",
              message: "Station code already exists for this branch: BAR",
            },
          },
          { status: 409 },
        ),
      ),
    );
    renderPage();
    await screen.findByText("GRILL");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add station" }));
    await user.type(await screen.findByLabelText(/^Code/), "BAR");
    await user.type(screen.getByLabelText(/^Name/), "Second bar");
    await user.click(screen.getByRole("button", { name: "Add station", hidden: false }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("Station code already exists"),
      ),
    );
  });

  it("asks for confirmation before retiring, and the station leaves the default list", async () => {
    let listed = rawStations;
    server.use(
      http.get("*/api/v1/pos/stations", () =>
        HttpResponse.json({ data: listed, meta: null, warnings: [] }),
      ),
      http.delete("*/api/v1/pos/stations/:id", () => {
        listed = rawStations.map((s) => (s.id === BAR ? { ...s, active: false } : s));
        return HttpResponse.json({ data: { ...rawStations[1], active: false }, warnings: [] });
      }),
    );
    renderPage();
    await screen.findByText("Main bar");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Actions for Main bar" }));
    await user.click(await screen.findByRole("menuitem", { name: "Retire" }));

    // The confirmation is the point — retiring a station takes it off a screen someone may be
    // cooking from right now.
    expect(await screen.findByText("Retire Main bar?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retire station" }));

    await waitFor(() => expect(screen.queryByText("Main bar")).not.toBeInTheDocument());
  });

  it("hides retired stations until the toggle is checked, then marks them retired", async () => {
    mockStationList();
    renderPage();
    await screen.findByText("GRILL");

    expect(screen.queryByText("Old pass")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Show retired"));

    expect(await screen.findByText("Old pass")).toBeInTheDocument();
    expect(screen.getByText("Retired")).toBeInTheDocument();
  });

  it("offers no delete control anywhere on the screen", async () => {
    mockStationList();
    renderPage();
    await screen.findByText("Main bar");

    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Show retired"));
    await user.click(screen.getByRole("button", { name: "Actions for Main bar" }));

    const items = await screen.findAllByRole("menuitem");
    const labels = items.map((i) => i.textContent);
    expect(labels).toEqual(["Edit", "Retire"]);
    expect(screen.queryByText(/delete/i)).not.toBeInTheDocument();
  });

  it("shows the list but no management actions to a user without pos.menu.manage", async () => {
    mockStationList();
    renderPage(["pos.menu.view"]);

    expect(await screen.findByText("Main bar")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add station" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Actions for Main bar" })).not.toBeInTheDocument();
  });

  it("is still refused by the server when the hidden action is reached another way", async () => {
    // Hiding the button is a courtesy; the boundary is the server's @PreAuthorize. Mounting the
    // dialog directly is the closest a unit test comes to "reached another way".
    seedSession({ permissions: ["pos.menu.view"], branchId: BRANCH });
    server.use(
      http.post("*/api/v1/pos/stations", () =>
        HttpResponse.json(
          { error: { code: "PERMISSION_DENIED", message: "Access denied" } },
          { status: 403 },
        ),
      ),
    );
    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <StationFormDialog open onOpenChange={() => {}} />
      </Wrapper>,
    );

    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Code/), "BAR2");
    await user.type(screen.getByLabelText(/^Name/), "Back bar");
    await user.click(screen.getByRole("button", { name: "Add station" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it("renders the FAILURE state with a retry, and never the empty state, when the request fails", async () => {
    server.use(
      http.get("*/api/v1/pos/stations", () => HttpResponse.json({ error: {} }, { status: 500 })),
    );
    renderPage();

    expect(await screen.findByTestId("query-error")).toBeInTheDocument();
    expect(screen.getByTestId("query-error-retry")).toBeInTheDocument();
    // The whole point. A failed request must not be reported as "you have no stations".
    expect(screen.queryByText("No stations yet")).not.toBeInTheDocument();
  });

  it("registers a Stations entry and a POS Terminals entry in the navigation", () => {
    const hrefs = navGroups.flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/app/stations");
    expect(hrefs).toContain("/app/terminals");
  });
});
