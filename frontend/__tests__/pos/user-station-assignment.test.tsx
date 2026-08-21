import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { renderHook, waitFor as waitForHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { UserRepository } from "@/lib/repositories/user.repository";
import { branchStationScope } from "@/lib/models/user.model";
import { useReplaceUserStations, useUserStations } from "@/lib/hooks/use-users";
import { CreateUserDialog, EditUserDialog } from "@/components/users/user-form-dialog";
import { UserDetailPanel } from "@/components/users/user-detail-panel";
import type { TenantUser } from "@/lib/models/user.model";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * Station assignment on the account (28-11) — the capability the user said was missing:
 * *"don't have the exact capacity to select the specific screen/station for that account he is
 * creating."*
 *
 * <p>Three assertions here would cause real damage if they were wrong, and they are the reason
 * this file exists rather than a smoke test:
 *
 * <ol>
 *   <li><b>Empty means EVERYTHING.</b> Every user in every tenant is currently unassigned. A form
 *       that renders that as "none" invites an admin to fix a problem that does not exist, and
 *       turns a working one-screen kitchen into a set of narrow ones.</li>
 *   <li><b>The selection is cleared when the branch changes.</b> Station codes are unique within a
 *       branch and auth-service deliberately does not validate them against pos-service, so a code
 *       carried across a branch change is accepted and silently filters the user to a station that
 *       produces no tickets.</li>
 *   <li><b>An unrestricted scope is a named property, not an empty array.</b> `[]` is one typo away
 *       from being rendered as a restriction.</li>
 * </ol>
 */

const BRANCH_A = "b1000001-0000-4000-8000-000000000001";
const BRANCH_B = "b1000001-0000-4000-8000-000000000002";
const USER_ID = "e1000001-0000-4000-8000-000000000001";

const TENANT = "a1000001-0000-4000-8000-000000000001";

const rawBranches = [
  { id: BRANCH_A, tenantId: TENANT, name: "Terrace", isHq: true, isActive: true },
  { id: BRANCH_B, tenantId: TENANT, name: "Marina", isHq: false, isActive: true },
];

const stationsAtBranchA = [
  {
    id: "51000001-0000-4000-8000-000000000001",
    branchId: BRANCH_A,
    code: "GRILL",
    name: "Hot line",
    active: true,
    stationType: "KITCHEN",
    displayFamily: "KITCHEN",
  },
  {
    id: "51000001-0000-4000-8000-000000000002",
    branchId: BRANCH_A,
    code: "BAR",
    name: "Main bar",
    active: true,
    stationType: "BAR",
    displayFamily: "BAR",
  },
  {
    id: "51000001-0000-4000-8000-000000000003",
    branchId: BRANCH_A,
    code: "OLDPASS",
    name: "Old pass",
    active: false,
    stationType: "EXPO",
    displayFamily: "EXPO",
  },
];

const stationsAtBranchB = [
  {
    id: "51000001-0000-4000-8000-000000000009",
    branchId: BRANCH_B,
    code: "MARINABAR",
    name: "Marina bar",
    active: true,
    stationType: "BAR",
    displayFamily: "BAR",
  },
];

const USER: TenantUser = {
  id: USER_ID,
  email: "bartender@terrace.local",
  fullName: "Asha",
  locale: null,
  active: true,
  mustChangePassword: false,
  totpEnabled: false,
  lastLoginAt: null,
  createdAt: null,
};

function mockSupportingEndpoints(options: { stationCodes?: string[]; branchId?: string } = {}) {
  const assignments =
    options.stationCodes && options.stationCodes.length > 0
      ? [{ branchId: options.branchId ?? BRANCH_A, stationCodes: options.stationCodes }]
      : [];

  server.use(
    http.get("*/api/v1/branches", () =>
      HttpResponse.json({ data: rawBranches, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/pos/stations", ({ request }) => {
      const branchId = new URL(request.url).searchParams.get("branchId");
      const data = branchId === BRANCH_B ? stationsAtBranchB : stationsAtBranchA;
      return HttpResponse.json({ data, meta: null, warnings: [] });
    }),
    http.get(`*/api/v1/users/${USER_ID}/stations`, () =>
      HttpResponse.json({ data: assignments, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/roles", () =>
      HttpResponse.json({
        data: [
          { code: "KITCHEN_STAFF", name: "Kitchen staff", system: true, permissions: [] },
          { code: "WAITER", name: "Waiter", system: true, permissions: [] },
        ],
        meta: null,
        warnings: [],
      }),
    ),
  );
}

// ── Task 1: the client layers ────────────────────────────────────────────────────────────

describe("user station assignment — the client layers", () => {
  afterEach(() => {
    clearSession();
    vi.clearAllMocks();
  });

  it("parses a user's assignments into a model grouped by branch", async () => {
    seedSession({ permissions: ["rbac.role.manage"], branchId: BRANCH_A });
    server.use(
      http.get(`*/api/v1/users/${USER_ID}/stations`, () =>
        HttpResponse.json({
          data: [
            { branchId: BRANCH_A, stationCodes: ["BAR", "GRILL"] },
            { branchId: BRANCH_B, stationCodes: ["MARINABAR"] },
          ],
          meta: null,
          warnings: [],
        }),
      ),
    );

    const scope = await UserRepository.getStationAssignments(USER_ID);

    expect(scope.unrestrictedEverywhere).toBe(false);
    expect(scope.branches).toEqual([
      { branchId: BRANCH_A, stationCodes: ["BAR", "GRILL"] },
      { branchId: BRANCH_B, stationCodes: ["MARINABAR"] },
    ]);
  });

  it("expresses the unrestricted state as a named property, never as an empty array", async () => {
    seedSession({ permissions: ["rbac.role.manage"], branchId: BRANCH_A });
    server.use(
      http.get(`*/api/v1/users/${USER_ID}/stations`, () =>
        HttpResponse.json({ data: [], meta: null, warnings: [] }),
      ),
    );

    const scope = await UserRepository.getStationAssignments(USER_ID);

    expect(scope.unrestrictedEverywhere).toBe(true);

    // And per branch the same rule is a TYPE state, not a length check a caller can forget.
    const atA = branchStationScope(scope, BRANCH_A);
    expect(atA.unrestricted).toBe(true);
    // The dangerous reading — "no stations" — is not reachable: `stationCodes` does not exist on
    // the unrestricted arm of the union.
    expect("stationCodes" in atA).toBe(false);
  });

  it("sends the FULL set on replace, and an empty set is a legal request that clears the branch", async () => {
    seedSession({ permissions: ["rbac.role.manage"], branchId: BRANCH_A });
    const bodies: unknown[] = [];
    server.use(
      http.put(`*/api/v1/users/${USER_ID}/stations`, async ({ request }) => {
        const body = await request.json();
        bodies.push(body);
        return HttpResponse.json({ data: [], meta: null, warnings: [] });
      }),
    );

    await UserRepository.replaceStationAssignments(USER_ID, {
      branchId: BRANCH_A,
      stationCodes: ["BAR", "GRILL"],
    });
    await UserRepository.replaceStationAssignments(USER_ID, {
      branchId: BRANCH_A,
      stationCodes: [],
    });

    expect(bodies).toEqual([
      { branchId: BRANCH_A, stationCodes: ["BAR", "GRILL"] },
      // Not omitted, not null — the empty array IS how a branch is cleared back to unrestricted.
      { branchId: BRANCH_A, stationCodes: [] },
    ]);
  });

  it("invalidates the user detail after a successful replace, so the panel reflects it", async () => {
    seedSession({ permissions: ["rbac.role.manage"], branchId: BRANCH_A });
    let assignments: { branchId: string; stationCodes: string[] }[] = [];
    server.use(
      http.get(`*/api/v1/users/${USER_ID}/stations`, () =>
        HttpResponse.json({ data: assignments, meta: null, warnings: [] }),
      ),
      http.put(`*/api/v1/users/${USER_ID}/stations`, async ({ request }) => {
        const body = (await request.json()) as { branchId: string; stationCodes: string[] };
        assignments = body.stationCodes.length > 0 ? [body] : [];
        return HttpResponse.json({ data: assignments, meta: null, warnings: [] });
      }),
    );

    const Wrapper = createQueryWrapper();
    const { result } = renderHook(
      () => ({ read: useUserStations(USER_ID), write: useReplaceUserStations() }),
      { wrapper: Wrapper },
    );

    await waitForHook(() => expect(result.current.read.data?.unrestrictedEverywhere).toBe(true));

    await result.current.write.mutateAsync({
      userId: USER_ID,
      payload: { branchId: BRANCH_A, stationCodes: ["BAR"] },
    });

    await waitForHook(() =>
      expect(result.current.read.data?.branches).toEqual([
        { branchId: BRANCH_A, stationCodes: ["BAR"] },
      ]),
    );
  });

  it("targets the station assignment endpoints from plan 28-01", async () => {
    seedSession({ permissions: ["rbac.role.manage"], branchId: BRANCH_A });
    const seen: string[] = [];
    server.use(
      http.get(`*/api/v1/users/${USER_ID}/stations`, ({ request }) => {
        seen.push(`GET ${new URL(request.url).pathname}`);
        return HttpResponse.json({ data: [], meta: null, warnings: [] });
      }),
      http.put(`*/api/v1/users/${USER_ID}/stations`, ({ request }) => {
        seen.push(`PUT ${new URL(request.url).pathname}`);
        return HttpResponse.json({ data: [], meta: null, warnings: [] });
      }),
    );

    await UserRepository.getStationAssignments(USER_ID);
    await UserRepository.replaceStationAssignments(USER_ID, {
      branchId: BRANCH_A,
      stationCodes: [],
    });

    expect(seen).toEqual([
      `GET /api/v1/users/${USER_ID}/stations`,
      `PUT /api/v1/users/${USER_ID}/stations`,
    ]);
  });
});

// ── Task 2: the field in the form, and the assignment on the detail view ──────────────────

function renderCreateDialog() {
  seedSession({ permissions: ["rbac.user.manage", "rbac.role.manage"], branchId: BRANCH_A });
  mockSupportingEndpoints();
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <CreateUserDialog open onOpenChange={() => {}} />
    </Wrapper>,
  );
}

async function chooseBranch(user: ReturnType<typeof userEvent.setup>, branchId: string) {
  const branchSelect = (await screen.findByLabelText("Branch")) as HTMLSelectElement;
  // The branch list is a query; selecting before it resolves picks from a one-option select.
  await waitFor(() =>
    expect(branchSelect.querySelector(`option[value="${branchId}"]`)).not.toBeNull(),
  );
  await user.selectOptions(branchSelect, branchId);
}

describe("the station field in the user form", () => {
  afterEach(() => {
    clearSession();
    vi.clearAllMocks();
  });

  it("shows no station field until a branch has been chosen", async () => {
    renderCreateDialog();
    await screen.findByLabelText("Branch");

    expect(screen.queryByTestId("station-assignment-field")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await chooseBranch(user, BRANCH_A);

    expect(await screen.findByTestId("station-assignment-field")).toBeInTheDocument();
  });

  it("lists the chosen branch's ACTIVE stations with their types", async () => {
    renderCreateDialog();
    const user = userEvent.setup();
    await chooseBranch(user, BRANCH_A);

    const field = await screen.findByTestId("station-assignment-field");
    expect(within(field).getByLabelText(/Main bar/)).toBeInTheDocument();
    expect(within(field).getByText(/Bar — Bar screen/)).toBeInTheDocument();
    expect(within(field).getByLabelText(/Hot line/)).toBeInTheDocument();
    // A retired station is not offered — assigning someone to it would scope them to a screen
    // that receives nothing.
    expect(within(field).queryByLabelText(/Old pass/)).not.toBeInTheDocument();
  });

  it("says, with nothing selected, that the user will see EVERY station in the branch", async () => {
    renderCreateDialog();
    const user = userEvent.setup();
    await chooseBranch(user, BRANCH_A);

    const summary = await screen.findByTestId("station-assignment-summary");
    expect(summary).toHaveTextContent("They will see every station in this branch.");
    // Not a warning. Every user in the product is in this state and it is the correct state for a
    // one-screen kitchen; styling it as a problem is how admins create restrictions nobody wanted.
    expect(summary).not.toHaveAttribute("role", "alert");
  });

  it("says, once stations are selected, that the user will see only those", async () => {
    renderCreateDialog();
    const user = userEvent.setup();
    await chooseBranch(user, BRANCH_A);

    const field = await screen.findByTestId("station-assignment-field");
    await user.click(within(field).getByLabelText(/Main bar/));

    expect(await screen.findByTestId("station-assignment-summary")).toHaveTextContent(
      "They will see Main bar only.",
    );
  });

  it("states when the change reaches a user who is already signed in", async () => {
    renderCreateDialog();
    const user = userEvent.setup();
    await chooseBranch(user, BRANCH_A);

    expect(await screen.findByTestId("station-assignment-delay-notice")).toHaveTextContent(
      /already signed in.*15 minutes/i,
    );
  });

  it("clears a station selection when the branch changes, rather than carrying codes across", async () => {
    renderCreateDialog();
    const user = userEvent.setup();
    await chooseBranch(user, BRANCH_A);

    const field = await screen.findByTestId("station-assignment-field");
    await user.click(within(field).getByLabelText(/Main bar/));
    expect(await screen.findByTestId("station-assignment-summary")).toHaveTextContent(
      "They will see Main bar only.",
    );

    // Away and back. auth-service does not validate codes against pos-service, so a code carried
    // across a branch change would be ACCEPTED and would filter the user to a station that
    // produces no tickets — a screen that simply never lights up.
    await chooseBranch(user, BRANCH_B);
    await chooseBranch(user, BRANCH_A);

    await waitFor(() =>
      expect(screen.getByTestId("station-assignment-summary")).toHaveTextContent(
        "They will see every station in this branch.",
      ),
    );
    expect(
      within(screen.getByTestId("station-assignment-field")).getByLabelText(/Main bar/),
    ).not.toBeChecked();
  });

  it("offers stations only for the branch the admin is signed in to, and says why", async () => {
    // `StationServiceImpl.requireOwnBranch` refuses a `branchId` that is not the caller's own JWT
    // branch with a 403, so a picker for another branch cannot be populated at all. Rendering an
    // empty or erroring picker there would look like a defect; the field explains instead.
    renderCreateDialog();
    const user = userEvent.setup();
    await chooseBranch(user, BRANCH_B);

    const field = await screen.findByTestId("station-assignment-field");
    expect(within(field).getByTestId("station-assignment-cross-branch")).toHaveTextContent(
      /Switch to Marina/,
    );
    expect(within(field).queryByLabelText(/Marina bar/)).not.toBeInTheDocument();
  });

  it("renders a failed station list as a failure with a retry, never as an empty picker", async () => {
    seedSession({ permissions: ["rbac.user.manage", "rbac.role.manage"], branchId: BRANCH_A });
    mockSupportingEndpoints();
    server.use(
      http.get("*/api/v1/pos/stations", () => HttpResponse.json({ error: {} }, { status: 500 })),
    );
    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <CreateUserDialog open onOpenChange={() => {}} />
      </Wrapper>,
    );

    const user = userEvent.setup();
    await chooseBranch(user, BRANCH_A);

    const field = await screen.findByTestId("station-assignment-field");
    expect(within(field).getByTestId("query-error")).toBeInTheDocument();
    expect(within(field).getByTestId("query-error-retry")).toBeInTheDocument();
    expect(within(field).queryByTestId("station-assignment-summary")).not.toBeInTheDocument();
  });

  it("creates a user with a branch, a role and two stations, and assigns both", async () => {
    seedSession({ permissions: ["rbac.user.manage", "rbac.role.manage"], branchId: BRANCH_A });
    mockSupportingEndpoints();
    let assigned: { branchId: string; stationCodes: string[] } | null = null;
    server.use(
      http.post("*/api/v1/users", () =>
        HttpResponse.json(
          {
            data: {
              id: USER_ID,
              email: "bartender@terrace.local",
              tempPassword: "Temp-1234",
              mustChangePassword: true,
              loginable: true,
              assignedRoleCode: "KITCHEN_STAFF",
            },
            meta: null,
            warnings: [],
          },
          { status: 201 },
        ),
      ),
      http.put(`*/api/v1/users/${USER_ID}/stations`, async ({ request }) => {
        assigned = (await request.json()) as { branchId: string; stationCodes: string[] };
        return HttpResponse.json({ data: [assigned], meta: null, warnings: [] });
      }),
    );

    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <CreateUserDialog open onOpenChange={() => {}} />
      </Wrapper>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email address"), "bartender@terrace.local");
    await chooseBranch(user, BRANCH_A);
    await user.selectOptions(screen.getByLabelText("Role"), "KITCHEN_STAFF");

    const field = await screen.findByTestId("station-assignment-field");
    await user.click(within(field).getByLabelText(/Main bar/));
    await user.click(within(field).getByLabelText(/Hot line/));

    await user.click(screen.getByRole("button", { name: "Create user" }));

    await waitFor(() => expect(assigned).not.toBeNull());
    expect(assigned).toEqual({ branchId: BRANCH_A, stationCodes: ["BAR", "GRILL"] });
  });

  it("creates a user with NO station without calling the assignment endpoint at all", async () => {
    seedSession({ permissions: ["rbac.user.manage", "rbac.role.manage"], branchId: BRANCH_A });
    mockSupportingEndpoints();
    let assignmentCalls = 0;
    server.use(
      http.post("*/api/v1/users", () =>
        HttpResponse.json(
          {
            data: {
              id: USER_ID,
              email: "waiter@terrace.local",
              tempPassword: "Temp-1234",
              mustChangePassword: true,
              loginable: true,
              assignedRoleCode: "WAITER",
            },
            meta: null,
            warnings: [],
          },
          { status: 201 },
        ),
      ),
      http.put(`*/api/v1/users/${USER_ID}/stations`, () => {
        assignmentCalls += 1;
        return HttpResponse.json({ data: [], meta: null, warnings: [] });
      }),
    );

    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <CreateUserDialog open onOpenChange={() => {}} />
      </Wrapper>,
    );

    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email address"), "waiter@terrace.local");
    await chooseBranch(user, BRANCH_A);
    await user.selectOptions(screen.getByLabelText("Role"), "WAITER");
    await user.click(screen.getByRole("button", { name: "Create user" }));

    expect(await screen.findByText("Account created")).toBeInTheDocument();
    // Unrestricted is the DO-NOTHING default, all the way down to the wire. Sending an empty
    // replace would be harmless but it would also be a write nobody asked for.
    expect(assignmentCalls).toBe(0);
  });

  it("keeps the branch-and-role-together rule, and still allows neither", async () => {
    renderCreateDialog();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Email address"), "someone@terrace.local");
    await chooseBranch(user, BRANCH_A);
    await user.click(screen.getByRole("button", { name: "Create user" }));

    expect(
      await screen.findByText("Choose both a branch and a role, or neither"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Account created")).not.toBeInTheDocument();
  });

  it("loads the user's current stations into the edit dialog and saves a changed selection", async () => {
    seedSession({ permissions: ["rbac.user.manage", "rbac.role.manage"], branchId: BRANCH_A });
    mockSupportingEndpoints({ stationCodes: ["BAR"] });
    let saved: { branchId: string; stationCodes: string[] } | null = null;
    server.use(
      http.patch(`*/api/v1/users/${USER_ID}`, () =>
        HttpResponse.json({
          data: { user: USER, assignments: [] },
          meta: null,
          warnings: [],
        }),
      ),
      http.put(`*/api/v1/users/${USER_ID}/stations`, async ({ request }) => {
        saved = (await request.json()) as { branchId: string; stationCodes: string[] };
        return HttpResponse.json({ data: [saved], meta: null, warnings: [] });
      }),
    );

    const Wrapper = createQueryWrapper();
    render(
      <Wrapper>
        <EditUserDialog user={USER} open onOpenChange={() => {}} />
      </Wrapper>,
    );

    const field = await screen.findByTestId("station-assignment-field");
    // The current assignment is loaded, not blank.
    await waitFor(() => expect(within(field).getByLabelText(/Main bar/)).toBeChecked());

    const user = userEvent.setup();
    await user.click(within(field).getByLabelText(/Hot line/));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(saved).not.toBeNull());
    expect(saved).toEqual({ branchId: BRANCH_A, stationCodes: ["BAR", "GRILL"] });
  });
});

describe("the assignment on the user detail panel", () => {
  afterEach(() => {
    clearSession();
    vi.clearAllMocks();
  });

  function renderPanel(stationCodes: string[]) {
    seedSession({ permissions: ["rbac.user.manage", "rbac.role.manage"], branchId: BRANCH_A });
    mockSupportingEndpoints({ stationCodes });
    server.use(
      http.get(`*/api/v1/users/${USER_ID}`, () =>
        HttpResponse.json({
          data: {
            user: USER,
            assignments: [
              {
                branchId: BRANCH_A,
                roleCode: "KITCHEN_STAFF",
                primary: true,
                approvalLimitPaisa: null,
              },
            ],
          },
          meta: null,
          warnings: [],
        }),
      ),
    );
    const Wrapper = createQueryWrapper();
    return render(
      <Wrapper>
        <UserDetailPanel userId={USER_ID} />
      </Wrapper>,
    );
  }

  it("lists the stations a user is assigned to, without opening an editor", async () => {
    renderPanel(["BAR"]);

    const section = await screen.findByTestId("user-station-scope");
    expect(section).toHaveTextContent("Main bar");
  });

  it("says an unassigned user sees every station, rather than showing a blank", async () => {
    renderPanel([]);

    const section = await screen.findByTestId("user-station-scope");
    expect(section).toHaveTextContent("Sees every station in every branch they work.");
    expect(section).not.toHaveTextContent(/no access|none assigned/i);
  });
});
