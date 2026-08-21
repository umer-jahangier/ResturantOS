import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The audit log screen, asserted on what a person sees.
 *
 * <h2>Why this file exists</h2>
 *
 * <p>The 2026-08-12 walkthrough's finding was not that the audit API was wrong. It was that
 * `audit_events` held 3,457 rows for the working tenant, `GET /api/v1/audit/events` answered 200
 * for the OWNER, the permission was seeded, the gateway routed it — and there was no screen, so
 * "nobody in the building can read the audit log". Every backend test in `audit-service` was green
 * throughout. So the tests that matter here are the ones that fail if a person cannot READ the
 * thing: a name instead of a UUID, a local time instead of a UTC one, a stated total, a refusal
 * that is not an empty list.
 *
 * <h2>What is mocked, and what deliberately is not</h2>
 *
 * <p>Only the HTTP transport (`@/lib/api-client/request`). Everything between the wire and the
 * pixels is the real thing — the Zod schema, the adapter that parses `afterState`, the repository
 * that builds the query string, the hooks, `QueryBoundary`, `DataGrid` and the component. A test
 * that mocked the hook would assert that the component renders its props, which is the class of
 * test that let a screen ship with a filter parameter the server had never declared.
 */

const transport = vi.hoisted(() => ({
  get: vi.fn(),
  getPaginated: vi.fn(),
}));

vi.mock("@/lib/api-client/request", () => ({
  get: (...args: unknown[]) => transport.get(...args),
  getPaginated: (...args: unknown[]) => transport.getPaginated(...args),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@/lib/hooks/auth/use-current-user", () => ({
  useCurrentUser: () => ({
    isAuthenticated: true,
    userId: "61334688-6b5c-4926-ac82-e93208ba5324",
    branchId: "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03",
    roles: ["OWNER"],
    permissions: ["audit.log.view"],
    attributes: {},
  }),
}));

import { AuditLog } from "@/components/audit/audit-log";

/** Floating Terrace's F-7, as `GET /api/v1/branches/{id}` really answers. */
const BRANCH = {
  id: "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03",
  tenantId: "9f2b1c40-7a55-4c1e-9c3e-5b7c1d2e3f40",
  name: "Floating Terrace",
  isHq: true,
  isActive: true,
  timezone: "Asia/Karachi",
};

const FACETS = {
  actions: ["ORDER_VOIDED", "USER_LOGIN_SUCCEEDED"],
  resourceTypes: ["ORDER", "USER"],
  // The window those two lists were read from. The server bounds a dateless request to the last 90
  // days rather than reading the whole seven-year record, and returns the days it used so the
  // screen can name them instead of recomputing them from a second copy of the constant.
  windowFrom: "2026-05-14",
  windowTo: "2026-08-12",
};

/**
 * A real row, copied from the live response on 2026-08-12 — including the UTC instant that is
 * 08:16 in Karachi, and the `afterState` blob the reason has to be dug out of.
 */
const VOID_ROW = {
  id: 8790,
  occurredAt: "2026-08-12T03:16:13.304953Z",
  action: "ORDER_VOIDED",
  resourceType: "ORDER",
  resourceId: "f4ec7d5b-9b14-4aba-8b68-cfa44a41a3f1",
  branchId: BRANCH.id,
  userId: "bc0d9897-e0ef-40de-b404-89ce044ab2cb",
  userName: "Shift Cashier 984155",
  impersonatedBy: null,
  impersonatedByName: null,
  afterState: JSON.stringify({
    reason: "End of shift — parked check never taken",
    orderId: "f4ec7d5b-9b14-4aba-8b68-cfa44a41a3f1",
  }),
  metadata: null,
};

const LOGIN_ROW = {
  id: 8822,
  occurredAt: "2026-08-12T03:54:06.525809Z",
  action: "USER_LOGIN_SUCCEEDED",
  resourceType: "USER",
  resourceId: null,
  branchId: BRANCH.id,
  userId: "61334688-6b5c-4926-ac82-e93208ba5324",
  userName: "owner@terrace.local",
  impersonatedBy: null,
  impersonatedByName: null,
  afterState: JSON.stringify({ ip: "127.0.0.1", email: "owner@terrace.local" }),
  metadata: null,
};

function page(
  rows: unknown[],
  totalCount: number,
  pageNumber = 0,
  nextCursor: string | null = null,
) {
  return {
    data: rows,
    meta: {
      page: { cursor: String(pageNumber), nextCursor, limit: 50 },
      totalCount,
    },
  };
}

function renderScreen() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AuditLog />
    </QueryClientProvider>,
  );
}

/** Point the branch at a different zone for one test, without touching the machine's. */
function branchInZone(timezone: string) {
  transport.get.mockImplementation((url: string) => {
    if (url.startsWith("/api/v1/branches/")) return Promise.resolve({ ...BRANCH, timezone });
    if (url === "/api/v1/audit/facets") return Promise.resolve(FACETS);
    throw new Error(`unexpected GET ${url}`);
  });
}

/**
 * A facets response from a server that does not send the window — the shape this screen met before
 * the field existed, and the shape it meets during a rolling deploy.
 */
function facetsWithoutWindow() {
  const { windowFrom: _from, windowTo: _to, ...withoutWindow } = FACETS;
  transport.get.mockImplementation((url: string) => {
    if (url.startsWith("/api/v1/branches/")) return Promise.resolve(BRANCH);
    if (url === "/api/v1/audit/facets") return Promise.resolve(withoutWindow);
    throw new Error(`unexpected GET ${url}`);
  });
}

beforeEach(() => {
  transport.get.mockImplementation((url: string) => {
    if (url.startsWith("/api/v1/branches/")) return Promise.resolve(BRANCH);
    if (url === "/api/v1/audit/facets") return Promise.resolve(FACETS);
    throw new Error(`unexpected GET ${url}`);
  });
  transport.getPaginated.mockResolvedValue(page([VOID_ROW, LOGIN_ROW], 3457, 0, "1"));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("the audit log can actually be read", () => {
  /**
   * The walkthrough's step 6 — "check the audit log recorded the void with an actor" — in the form
   * a person performs it.
   */
  it("shows a void with the actor's NAME, its reason, and the time in the branch's zone", async () => {
    renderScreen();

    const table = await screen.findByRole("table", { name: "Audit log" });
    const row = within(table).getByText("End of shift — parked check never taken").closest("tr");
    expect(row).not.toBeNull();

    // The name, not the id. `"by bc0d9897-…"` is an answer only to someone holding the users table.
    expect(within(row as HTMLElement).getByText("Shift Cashier 984155")).toBeTruthy();

    // 03:16 UTC is 08:16 in Asia/Karachi. Rendering the browser's zone — or the raw instant — is
    // the same defect the Takings screen shipped, and it is invisible in a screenshot.
    const when = within(row as HTMLElement).getByTestId(`audit-when-${VOID_ROW.id}`).textContent!;
    expect(when).toContain("08:16");
    expect(when).not.toContain("03:16");
    expect(when).toContain("12 Aug 2026");
  });

  /**
   * The other half, and the one that cannot pass by accident.
   *
   * <p>The assertion above would go green on a machine whose own clock is already Asia/Karachi even
   * if the screen ignored the branch entirely — which is precisely how the first run of this file
   * passed against a broken branch read. New York is UTC-4 in August, so the same instant is
   * 11:16 pm the PREVIOUS day there. No machine is in both zones, so one of these two tests is
   * always measuring the branch and not the box.
   */
  it("follows the branch's zone even when that changes the DAY", async () => {
    branchInZone("America/New_York");
    renderScreen();

    const table = await screen.findByRole("table", { name: "Audit log" });
    const when = within(table).getByTestId(`audit-when-${VOID_ROW.id}`).textContent!;
    expect(when).toContain("11 Aug 2026");
    expect(when).toContain("11:16");
  });

  /**
   * The screen reads the last 90 days by default, so it has to SAY it reads the last 90 days.
   *
   * <p>The bound exists because a dateless facets request was a DISTINCT scan over every attached
   * partition — 84 of them at the seven-year retention — on every first load. The bound is cheap;
   * the risk it introduces is entirely about what the reader concludes. Shown 90 days of a
   * seven-year record with nothing saying so, an owner concludes that IS the record, which is the
   * same false impression as a filter option that can only return an empty log, arriving by a
   * different route. So the dates are named, "retained and searchable" says nothing was deleted,
   * and widening is one click.
   */
  it("names the window it is showing and offers to widen it", async () => {
    renderScreen();

    const note = await screen.findByTestId("audit-window-note");
    // The dates a person would write, not a relative phrase that makes the reader compute.
    expect(note.textContent).toContain("14 May");
    expect(note.textContent).toContain("12 Aug 2026");
    expect(note.textContent).toContain("the last 90 days");
    // The half that says nothing is missing, only unfetched.
    expect(note.textContent).toMatch(/retained and searchable/i);
    expect(screen.getByTestId("audit-search-all-time")).toBeTruthy();
  });

  /**
   * The dates are the SERVER's, never recomputed here.
   *
   * <p>A client that works the window out for itself holds a second copy of the 90-day default, and
   * the day the two drift the screen names a range it did not read — which is this whole change's
   * own bug class, relocated from facets-vs-grid to client-vs-server. A server that says nothing
   * must therefore produce no claim at all rather than a locally-invented one.
   */
  it("says nothing about the window when the server did not state one", async () => {
    facetsWithoutWindow();
    renderScreen();

    await screen.findByRole("table", { name: "Audit log" });
    expect(screen.queryByTestId("audit-window-note")).toBeNull();
  });

  it("states the total, not just the page", async () => {
    renderScreen();
    const summary = await screen.findByTestId("audit-page-summary");
    // A pager with only Next teaches the reader that the log ends where the first page does.
    expect(summary.textContent).toMatch(/of 3,457 events/);
  });

  it("Next asks the SERVER for the next page and the rows change", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByTestId("audit-page-summary");

    transport.getPaginated.mockResolvedValueOnce(
      page(
        [{ ...VOID_ROW, id: 9001, afterState: JSON.stringify({ reason: "Second page row" }) }],
        3457,
        1,
        "2",
      ),
    );
    await user.click(screen.getByTestId("audit-next-page"));

    await waitFor(() => expect(screen.getByText("Second page row")).toBeTruthy());
    expect(transport.getPaginated).toHaveBeenLastCalledWith(
      "/api/v1/audit/events",
      expect.objectContaining({ page: 1 }),
    );
    expect(screen.getByTestId("audit-page-number").textContent).toBe("Page 2");
  });

  /**
   * The correction to walkthrough finding #19. `?resourceType=` was not "ignored" — it was never a
   * declared parameter, so Spring discarded it and the caller got the unfiltered log. This asserts
   * the two halves that were missing: the browser sends it, and the rows shown are the ones that
   * came back for it.
   */
  it("filtering by resource type sends resourceType and shows only what came back", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole("table", { name: "Audit log" });

    transport.getPaginated.mockResolvedValueOnce(page([VOID_ROW], 42, 0, null));
    await user.selectOptions(screen.getByTestId("audit-filter-resource"), "ORDER");

    await waitFor(() =>
      expect(transport.getPaginated).toHaveBeenLastCalledWith(
        "/api/v1/audit/events",
        expect.objectContaining({ resourceType: "ORDER" }),
      ),
    );
    await waitFor(() => expect(screen.queryByText("owner@terrace.local")).toBeNull());
    expect(screen.getByText("End of shift — parked check never taken")).toBeTruthy();
  });

  /** The day boundary is the branch's, and the request says so rather than leaving it to UTC. */
  it("sends the branch's time zone with the date filter", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole("table", { name: "Audit log" });

    await user.type(screen.getByTestId("audit-filter-from"), "2026-08-12");

    await waitFor(() =>
      expect(transport.getPaginated).toHaveBeenLastCalledWith(
        "/api/v1/audit/events",
        expect.objectContaining({ from: "2026-08-12", zone: "Asia/Karachi" }),
      ),
    );
  });
});

describe("the screen cannot tell a lie about an empty log", () => {
  it("a failed read shows the failure and never 'nothing has been recorded'", async () => {
    transport.getPaginated.mockRejectedValue(new Error("audit-service is not answering"));
    renderScreen();

    // GA-001 at its most damaging: "nothing recorded" shown during an outage is the product
    // asserting that nothing happened.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/audit log/i);
    expect(screen.queryByText(/Nothing has been recorded yet/i)).toBeNull();
    expect(screen.queryByRole("table", { name: "Audit log" })).toBeNull();
  });

  it("a genuinely empty log says so, and says it differently when a filter is on", async () => {
    transport.getPaginated.mockResolvedValue(page([], 0, 0, null));
    renderScreen();

    expect(await screen.findByText(/Nothing has been recorded yet/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("a range that cannot match is refused before it is sent", () => {
  it("names both fields and the real problem, and does not send the filter", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole("table", { name: "Audit log" });
    transport.getPaginated.mockClear();

    await user.type(screen.getByTestId("audit-filter-from"), "2026-08-12");
    await waitFor(() => expect(transport.getPaginated).toHaveBeenCalled());
    transport.getPaginated.mockClear();
    await user.type(screen.getByTestId("audit-filter-to"), "2026-08-10");

    const error = await screen.findByTestId("audit-range-error");
    expect(error.getAttribute("role")).toBe("alert");
    expect(error.textContent).toContain("From");
    expect(error.textContent).toContain("To");
    expect(error.textContent).toContain("2026-08-10");

    // Not sent. The server's honest answer would be zero rows, and zero rows HERE reads as a
    // missing audit trail rather than as a mistyped date.
    expect(transport.getPaginated).not.toHaveBeenCalledWith(
      "/api/v1/audit/events",
      expect.objectContaining({ to: "2026-08-10" }),
    );
    expect(screen.getByTestId("audit-filter-from").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByTestId("audit-filter-to").getAttribute("aria-invalid")).toBe("true");
  });

  /**
   * Found by driving the screen in Chromium, not by reading it.
   *
   * <p>The Clear button was gated on the APPLIED filters, and a backwards range is deliberately
   * never applied — so the one state where a user most needs to clear their filters was the only
   * state with no Clear button. The error told them to move a date and gave them nothing to press.
   */
  it("still offers Clear filters while the range is refused", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByRole("table", { name: "Audit log" });

    await user.type(screen.getByTestId("audit-filter-from"), "2026-08-12");
    await user.type(screen.getByTestId("audit-filter-to"), "2026-08-01");
    await screen.findByTestId("audit-range-error");

    const clear = screen.getByTestId("audit-clear-filters");
    await user.click(clear);

    await waitFor(() => expect(screen.queryByTestId("audit-range-error")).toBeNull());
    expect((screen.getByTestId("audit-filter-from") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("audit-filter-to") as HTMLInputElement).value).toBe("");
  });
});
