import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { toast } from "sonner";
import MenuRoutingPage from "@/app/(tenant)/app/menu/routing/page";
import { navGroups } from "@/components/shared/sidebar-nav-items";

// The app mounts <Toaster /> at the layout level, which these component-scoped tests do not — so
// a toast leaves no DOM to query. Spying is how the confirmation can still be asserted.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * The station-routing SCREEN, asserted at the page (S1 #10, register §4.1).
 *
 * <h2>What was already covered, and what was not</h2>
 *
 * <p>`station-routing-board.test.tsx` proves the BOARD renders and calls its two callbacks.
 * `MenuStationRoutingIT` / `MenuRoutingReadIT` prove pos-service resolves and persists a route.
 * Nothing anywhere asserted the thing an owner actually does: pick a station on this page and get
 * a truthful confirmation that names what moved and where it now fires.
 *
 * <h2>The three failures these are aimed at, each of which this repo has actually shipped</h2>
 *
 * <ol>
 *   <li><b>A control with no wire.</b> The register's finding was not "routing is broken" — the
 *       two PUTs worked and were tested. It was that NOTHING IN THE PRODUCT CALLED THEM. A test
 *       that mocks the mutation hook cannot catch that class of defect, so these assert the HTTP
 *       request that leaves the page: its method, its path, and its body.</li>
 *   <li><b>One Save button over forty selects.</b> Two rows must produce two independent writes.
 *       Routing the Drinks category must not silently re-write a dish's own exception, and a dish
 *       must be settable without the category being touched — otherwise a partial failure leaves a
 *       screen whose state nobody can reconstruct.</li>
 *   <li><b>Error rendered as empty (GA-001).</b> On the ONE screen whose entire job is to answer
 *       "where is each dish made", showing "nothing is routed" because pos-service is down is the
 *       product lying about exactly the question it exists to answer — and it would send an owner
 *       to re-route a menu that is already routed.</li>
 * </ol>
 */

const BRANCH = "b1000001-0000-4000-8000-000000000001";
const BAR = "51000001-0000-4000-8000-000000000002";
const GRILL = "51000001-0000-4000-8000-000000000001";

const DRINKS = "c1000001-0000-4000-8000-000000000001";
const STARTERS = "c1000001-0000-4000-8000-000000000002";
const PINACOLADA = "a1000001-0000-4000-8000-000000000001";
const SEEKH = "a1000001-0000-4000-8000-000000000002";

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
];

/** Exactly the shape the live branch F-7 answers with, trimmed to two categories. */
const rawRouting = {
  branchId: BRANCH,
  categories: [
    {
      categoryId: STARTERS,
      categoryName: "Starters",
      sortOrder: 1,
      active: true,
      stationId: null,
      stationCode: null,
      stationName: null,
    },
    {
      categoryId: DRINKS,
      categoryName: "Drinks",
      sortOrder: 2,
      active: true,
      stationId: null,
      stationCode: null,
      stationName: null,
    },
  ],
  items: [
    {
      itemId: SEEKH,
      itemName: "Seekh Kebab",
      categoryId: STARTERS,
      categoryName: "Starters",
      active: true,
      stationId: null,
      effectiveStationId: null,
      effectiveStationCode: null,
      effectiveStationName: null,
      source: "NONE",
    },
    {
      itemId: PINACOLADA,
      itemName: "Pinacolada",
      categoryId: DRINKS,
      categoryName: "Drinks",
      active: true,
      stationId: null,
      effectiveStationId: null,
      effectiveStationCode: null,
      effectiveStationName: null,
      source: "NONE",
    },
  ],
};

interface SeenWrite {
  method: string;
  path: string;
  body: unknown;
}

function mockEndpoints({
  stations = rawStations,
  routingStatus = 200,
  writeStatus = 204,
}: { stations?: unknown[]; routingStatus?: number; writeStatus?: number } = {}) {
  const writes: SeenWrite[] = [];
  server.use(
    http.get("*/api/v1/pos/stations", () =>
      HttpResponse.json({ data: stations, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/menu/routing", () =>
      routingStatus === 200
        ? HttpResponse.json({ data: rawRouting, meta: null, warnings: [] })
        : HttpResponse.json(
            { error: { code: "SERVICE_UNAVAILABLE", message: "pos-service is unavailable" } },
            { status: routingStatus },
          ),
    ),
    http.put("*/api/v1/pos/menu/categories/:id/station", async ({ request, params }) => {
      writes.push({
        method: "PUT",
        path: `/menu/categories/${params.id}/station`,
        body: await request.json(),
      });
      return writeStatus === 204
        ? new HttpResponse(null, { status: 204 })
        : HttpResponse.json(
            { error: { code: "SERVICE_UNAVAILABLE", message: "pos-service is unavailable" } },
            { status: writeStatus },
          );
    }),
    http.put("*/api/v1/pos/menu/items/:id/station", async ({ request, params }) => {
      writes.push({
        method: "PUT",
        path: `/menu/items/${params.id}/station`,
        body: await request.json(),
      });
      return writeStatus === 204
        ? new HttpResponse(null, { status: 204 })
        : HttpResponse.json(
            { error: { code: "SERVICE_UNAVAILABLE", message: "pos-service is unavailable" } },
            { status: writeStatus },
          );
    }),
  );
  return writes;
}

function renderPage(
  opts: Parameters<typeof mockEndpoints>[0] & { permissions?: string[] } = {},
) {
  const { permissions = ["pos.menu.manage"], ...endpointOpts } = opts;
  seedSession({ permissions, branchId: BRANCH });
  const writes = mockEndpoints(endpointOpts);
  const Wrapper = createQueryWrapper();
  render(
    <Wrapper>
      <MenuRoutingPage />
    </Wrapper>,
  );
  return writes;
}

describe("Station Routing page", () => {
  afterEach(() => {
    clearSession();
    vi.clearAllMocks();
  });

  it("is reachable from the sidebar, so routing is not a URL only its author knows", () => {
    const hrefs = navGroups.flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/app/menu/routing");
  });

  it("routes a whole category over the wire, and says which category went where", async () => {
    const user = userEvent.setup();
    const writes = renderPage();

    const drinks = await screen.findByRole("combobox", {
      name: "Station for the Drinks category",
    });
    await user.selectOptions(drinks, BAR);

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      method: "PUT",
      path: `/menu/categories/${DRINKS}/station`,
      body: { stationId: BAR },
    });

    // The confirmation has to name BOTH ends of the decision. "Saved" on this screen is worthless:
    // the owner is forty rows down a list and needs to know which rule they just changed.
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    const said = vi.mocked(toast.success).mock.calls[0]![0] as string;
    expect(said).toContain("Drinks");
    expect(said).toContain("BAR");
    expect(said).toContain("Main bar");
  });

  it("routes one dish on its own — the category is not written, and the dish is named", async () => {
    const user = userEvent.setup();
    const writes = renderPage();

    const kebab = await screen.findByRole("combobox", { name: "Station for Seekh Kebab" });
    await user.selectOptions(kebab, GRILL);

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      method: "PUT",
      path: `/menu/items/${SEEKH}/station`,
      body: { stationId: GRILL },
    });
    // Exactly one write: a per-row control must not drag its category along with it.
    expect(writes.filter((w) => w.path.includes("/categories/"))).toHaveLength(0);

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    const said = vi.mocked(toast.success).mock.calls[0]![0] as string;
    expect(said).toContain("Seekh Kebab");
    expect(said).toContain("GRILL");
  });

  it("tells the owner when a route did NOT save, instead of confirming one that did not happen", async () => {
    const user = userEvent.setup();
    renderPage({ writeStatus: 503 });

    const drinks = await screen.findByRole("combobox", {
      name: "Station for the Drinks category",
    });
    await user.selectOptions(drinks, BAR);

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("renders the ERROR state, never 'nothing is routed', when the routing read fails", async () => {
    renderPage({ routingStatus: 503 });

    expect(await screen.findByRole("alert")).toBeInTheDocument();

    // The two sentences that would be a lie. Both are what this screen says when it genuinely
    // knows the answer, and neither may appear when it does not.
    expect(screen.queryByTestId("routing-summary")).not.toBeInTheDocument();
    expect(screen.queryByText(/sellable items have no station/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/No menu categories yet/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("routing-category")).not.toBeInTheDocument();
  });

  it("sends a branch with no stations to the station catalogue rather than showing an unusable board", async () => {
    renderPage({ stations: [] });

    expect(await screen.findByText(/This branch has no stations yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Go to Stations/i })).toBeInTheDocument();
    expect(screen.queryByTestId("routing-category")).not.toBeInTheDocument();
  });

  it("lets a persona without pos.menu.manage read the routing without being able to change it", async () => {
    renderPage({ permissions: ["pos.kds.view"] });

    const drinks = await screen.findByRole("combobox", {
      name: "Station for the Drinks category",
    });
    expect(drinks).toBeDisabled();
    expect(await screen.findByRole("combobox", { name: "Station for Pinacolada" })).toBeDisabled();
  });
});
