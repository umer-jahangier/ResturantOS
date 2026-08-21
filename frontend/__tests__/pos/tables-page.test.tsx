import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { toast } from "sonner";
import TablesPage from "@/app/(tenant)/app/tables/page";

// The app mounts <Toaster /> at the layout level, which these component-scoped tests do not — so
// a toast leaves no DOM to query. Spying is how the confirmation can still be asserted.
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * The dining-table catalogue UI (19b). Before this screen, `POST /api/v1/pos/tables` answered
 * 405 and every tenant had zero tables — the waiter's picker was built and wired, and reading an
 * empty catalogue nothing could write to.
 *
 * <p>The assertion that matters most is {@link "renders the ERROR state, never an empty one, when
 * the request fails"}: on a screen whose entire job is to say which tables exist, showing "No
 * tables yet" because pos-service is down is the product lying about the one thing it must not
 * (GA-001, eleven list screens).
 */

const T1 = "d1000001-0000-4000-8000-000000000001";
const T2 = "d1000001-0000-4000-8000-000000000002";
const T3 = "d1000001-0000-4000-8000-000000000003";
const BRANCH = "b1000001-0000-4000-8000-000000000001";

const rawTables = [
  {
    id: T1,
    branchId: BRANCH,
    tableName: "T1",
    capacity: 4,
    section: "Rooftop",
    active: true,
    status: "AVAILABLE",
  },
  {
    id: T2,
    branchId: BRANCH,
    tableName: "T2",
    capacity: 2,
    section: "Rooftop",
    active: true,
    status: "OCCUPIED",
  },
  {
    id: T3,
    branchId: BRANCH,
    tableName: "Old Corner",
    capacity: 6,
    section: null,
    active: false,
    status: "AVAILABLE",
  },
];

function mockTableEndpoints() {
  server.use(
    http.get("*/api/v1/pos/tables", () =>
      HttpResponse.json({ data: rawTables, meta: null, warnings: [] }),
    ),
  );
}

function renderPage(permissions: string[] = ["pos.tables.admin"]) {
  seedSession({ permissions, branchId: BRANCH });
  mockTableEndpoints();
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <TablesPage />
    </Wrapper>,
  );
}

describe("Tables page", () => {
  afterEach(() => {
    clearSession();
    vi.clearAllMocks();
  });

  it("lists active tables grouped by section, with runtime status", async () => {
    renderPage();

    const rooftop = await screen.findByRole("group", { name: "Rooftop section" });
    expect(within(rooftop).getByText("T1")).toBeInTheDocument();
    expect(within(rooftop).getByText("T2")).toBeInTheDocument();
    // 4 + 2 seats across two tables — the section header states both.
    expect(within(rooftop).getByText(/2 tables · 6 seats/)).toBeInTheDocument();

    // Runtime status is shown per row and is a DIFFERENT axis from retired/active.
    expect(within(rooftop).getByText("Available")).toBeInTheDocument();
    expect(within(rooftop).getByText("Occupied")).toBeInTheDocument();
  });

  it("hides retired tables until the toggle is checked", async () => {
    renderPage();
    await screen.findByText("T1");

    expect(screen.queryByText("Old Corner")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Show retired"));

    expect(await screen.findByText("Old Corner")).toBeInTheDocument();
    expect(screen.getByText("Retired")).toBeInTheDocument();
  });

  it("creates a table with a name, seats and a section", async () => {
    let posted: unknown = null;
    let postedUrl = "";
    server.use(
      http.post("*/api/v1/pos/tables", async ({ request }) => {
        postedUrl = request.url;
        posted = await request.json();
        return HttpResponse.json({
          data: {
            id: "d1000001-0000-4000-8000-00000000000f",
            branchId: BRANCH,
            tableName: "T9",
            capacity: 8,
            section: "Garden",
            active: true,
            status: "AVAILABLE",
          },
          meta: null,
          warnings: [],
        });
      }),
    );

    renderPage();
    await screen.findByText("T1");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add table" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Name or number" }), "T9");
    await user.clear(within(dialog).getByRole("textbox", { name: "Seats" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Seats" }), "8");
    // `role: combobox`, not textbox — an <input list="…"> IS a combobox to the accessibility
    // tree, which is exactly what the datalist of existing sections is there to provide.
    await user.type(within(dialog).getByRole("combobox", { name: "Section" }), "Garden");
    await user.click(within(dialog).getByRole("button", { name: "Add table" }));

    await waitFor(() =>
      expect(posted).toEqual({ tableNumber: "T9", capacity: 8, section: "Garden" }),
    );
    // branchId travels as a query param — the server re-checks it against the JWT branch, so a
    // mismatched value is refused rather than honoured.
    expect(postedUrl).toContain(`branchId=${BRANCH}`);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Added T9"));
  });

  it("sends capacity as a number and refuses a non-numeric one before any request", async () => {
    let called = false;
    server.use(
      http.post("*/api/v1/pos/tables", () => {
        called = true;
        return HttpResponse.json({ data: null, meta: null, warnings: [] });
      }),
    );

    renderPage();
    await screen.findByText("T1");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Add table" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox", { name: "Name or number" }), "T7");
    await user.clear(within(dialog).getByRole("textbox", { name: "Seats" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Seats" }), "abc");
    await user.click(within(dialog).getByRole("button", { name: "Add table" }));

    expect(await within(dialog).findByText("Enter a number of seats")).toBeInTheDocument();
    expect(called).toBe(false);
  });

  it("retires a table through the deactivate endpoint — never a DELETE", async () => {
    let patchedPath = "";
    server.use(
      http.patch("*/api/v1/pos/tables/:id/:action", ({ request }) => {
        patchedPath = new URL(request.url).pathname;
        return HttpResponse.json({
          data: { ...rawTables[0], active: false },
          meta: null,
          warnings: [],
        });
      }),
    );

    renderPage();
    await screen.findByText("T1");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Actions for T1" }));
    await user.click(await screen.findByRole("menuitem", { name: "Retire" }));

    await waitFor(() => expect(patchedPath).toBe(`/api/v1/pos/tables/${T1}/deactivate`));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Retired T1"));
  });

  it("surfaces the server's refusal to retire an occupied table", async () => {
    server.use(
      http.patch("*/api/v1/pos/tables/:id/deactivate", () =>
        HttpResponse.json(
          {
            error: {
              code: "STATE_INVALID",
              message: "Table T2 is OCCUPIED — close or move its order before retiring it.",
            },
          },
          { status: 409 },
        ),
      ),
    );

    renderPage();
    await screen.findByText("T2");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Actions for T2" }));
    await user.click(await screen.findByRole("menuitem", { name: "Retire" }));

    // The actionable sentence, not a generic fallback.
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("close or move its order")),
    );
  });

  it("renders the ERROR state, never an empty one, when the request fails", async () => {
    seedSession({ permissions: ["pos.tables.admin"], branchId: BRANCH });
    server.use(
      http.get("*/api/v1/pos/tables", () =>
        HttpResponse.json({ error: { code: "INTERNAL", message: "boom" } }, { status: 500 }),
      ),
    );
    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <TablesPage />
      </Wrapper>,
    );

    expect(await screen.findByTestId("query-error")).toBeInTheDocument();
    // The lie this guards against: telling a manager their restaurant has no tables because
    // pos-service is down.
    expect(screen.queryByText("No tables yet")).not.toBeInTheDocument();
  });

  it("offers no management actions to a user without pos.tables.admin", async () => {
    renderPage(["pos.order.view", "pos.tables.manage"]);
    await screen.findByText("T1");

    // A waiter can SEE the floor but cannot re-lay it.
    expect(screen.queryByRole("button", { name: "Add table" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Actions for T1" })).not.toBeInTheDocument();
  });
});
