import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { server } from "@/mocks/server";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { FleetUserDirectory } from "@/components/platform/fleet-user-directory";
import { PermissionMatrix } from "@/components/platform/permission-matrix";
import { UserAccessPanel } from "@/components/platform/user-access-panel";
import { UserActionDialog } from "@/components/platform/user-action-dialog";
import { UserAuditPanel } from "@/components/platform/user-audit-panel";
import { UserIdentityPanel } from "@/components/platform/user-identity-panel";
import { UserLifecycleActions } from "@/components/platform/user-lifecycle-actions";

import { FRONTEND_ROOT, stripComments } from "../../lib/theme/module-graph";

/**
 * The three honesty properties the users-and-access screens are built around.
 *
 * <h3>Why these three and not a render-everything suite</h3>
 *
 * Each one is a claim that is EASY to break by writing plausible code, and invisible once broken:
 *
 * <ol>
 *   <li><b>The fleet total is withheld, not estimated.</b> There is no cross-tenant user query in
 *       this product, so the directory is one HTTP call per tenant with one chance per tenant to
 *       fail. When one does, the API returns `totalCount: null` and names the tenants — and the
 *       single most natural "improvement" a later author makes is `scan.totalCount ?? rows.length`,
 *       which compiles, reads as defensive, and prints a confident number for a list that is
 *       missing a whole restaurant.</li>
 *   <li><b>The RBAC surface has no write path.</b> The platform tier holds no `user_branch_roles`,
 *       so there is no role ceiling to bound a platform-tier role editor — which is why the API is
 *       three reads and no writes, and why the response carries `readOnlyReason` at all. A screen
 *       that quietly grew an edit affordance would be pointing at an endpoint that does not
 *       exist.</li>
 *   <li><b>The reason is mandatory.</b> All five lifecycle endpoints refuse a blank
 *       `{"reason"}`, because each writes an append-only audit row. A dialog that submitted an
 *       empty one would turn a refusal the operator can see into a 400 they cannot.</li>
 * </ol>
 *
 * <h3>Negative controls — run, OBSERVED RED, restored (D-38-07)</h3>
 *
 * 1. Changed the directory's absent-total tile to `value={formatNumber(rows.length)}`. → RED:
 *    "withholds the fleet total and names the tenants it could not read" — the stated absence was
 *    gone and `2` was on screen. Restored.
 * 2. Dropped the `unreachable` notice's slug interpolation, leaving only the count. → RED: the
 *    same test, on `getByText(/mango-grill/)`. Restored.
 * 3. Removed `disabled` from the matrix's Edit control. → RED: "offers no edit affordance that
 *    would 404". Restored.
 * 4. Added `useMutation` to `lib/hooks/use-platform-rbac.ts`. → RED: "the RBAC hook file declares
 *    no mutation". Restored.
 * 5. Changed the action dialog's gate to `!isPending` alone. → RED: "will not submit without a
 *    reason". Restored.
 */

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "33333333-3333-4333-8333-333333333333";
const USER_B = "44444444-4444-4444-8444-444444444444";

function tenant(id: string, slug: string, brandName: string) {
  return {
    id,
    slug,
    brandName,
    status: "ACTIVE",
    tier: "GROWTH",
    createdAt: "2026-01-01T00:00:00Z",
    suspendedAt: null,
    cancelledAt: null,
    maxBranches: 5,
    maxUsers: 50,
    storageGb: 10,
    nlqQuota: 100,
    billingRef: null,
    trialEndsAt: null,
    renewsAt: null,
  };
}

function user(id: string, email: string, tenantId: string, tenantSlug: string) {
  return {
    tenantId,
    tenantSlug,
    tenantBrandName: tenantSlug === "mango-grill" ? "Mango Grill" : "Blue Olive",
    userId: id,
    email,
    fullName: "Ali Raza",
    locale: "en",
    active: true,
    mustChangePassword: false,
    totpEnabled: false,
    lastLoginAt: "2026-08-20T09:00:00Z",
    createdAt: "2026-02-01T00:00:00Z",
  };
}

const MATRIX = {
  tenantId: null,
  scope: "GLOBAL",
  permissionCodes: ["pos.order.create", "pos.order.void.any", "finance.journal.post"],
  rows: [
    {
      roleCode: "OWNER",
      roleName: "Owner",
      system: true,
      grantedPermissionCodes: ["pos.order.create", "pos.order.void.any"],
      assignedUserCount: 0,
    },
    {
      roleCode: "CASHIER",
      roleName: "Cashier",
      system: true,
      grantedPermissionCodes: ["pos.order.create"],
      assignedUserCount: 0,
    },
  ],
  readOnlyReason:
    "Roles are read-only to the platform tier. Composing a role is granting authority, and the " +
    "tenant tier bounds that with the role ceiling.",
};

function directoryHandlers(scan: Record<string, unknown>, users: unknown[]) {
  return [
    http.get("*/api/v1/platform/users", () => HttpResponse.json({ data: { users, scan } })),
    http.get("*/api/v1/platform/tenants", () =>
      HttpResponse.json({
        data: [
          tenant(TENANT_A, "mango-grill", "Mango Grill"),
          tenant(TENANT_B, "blue-olive", "Blue Olive"),
        ],
      }),
    ),
    http.get("*/api/v1/platform/rbac/matrix", () => HttpResponse.json({ data: MATRIX })),
  ];
}

afterEach(cleanup);

describe("the fleet directory tells the truth about an incomplete scan", () => {
  it("withholds the fleet total and names the tenants it could not read", async () => {
    server.use(
      ...directoryHandlers(
        {
          tenantsMatched: 3,
          tenantsScanned: 2,
          unreachable: [
            { tenantId: TENANT_B, tenantSlug: "mango-grill", detail: "UPSTREAM_TIMEOUT" },
            { tenantId: TENANT_A, tenantSlug: "blue-olive", detail: null },
          ],
          truncated: false,
          totalCount: null,
          totalCountNote: "2 tenants could not be read, so no total is knowable from this scan.",
        },
        [user(USER_A, "ali@mango.test", TENANT_A, "mango-grill")],
      ),
    );

    const Wrapper = createQueryWrapper();
    render(<FleetUserDirectory />, { wrapper: Wrapper });

    const notice = await screen.findByTestId("fleet-scan-unreachable");
    // NAMED, not merely counted — the whole point of the block. A count tells an operator their
    // list is wrong; the names tell them which restaurant is missing from it.
    expect(notice).toHaveTextContent("mango-grill");
    expect(notice).toHaveTextContent("blue-olive");

    // And the total is a stated absence rather than a number. `rows.length` is 1 here, so a
    // fallback would put a confident "1" where the reason belongs.
    const summary = await screen.findByTestId("fleet-scan-summary");
    expect(summary).toHaveTextContent(/Total withheld/i);
    expect(summary).toHaveTextContent(/no total is knowable/i);
  });

  it("states the total when every tenant answered", async () => {
    server.use(
      ...directoryHandlers(
        {
          tenantsMatched: 2,
          tenantsScanned: 2,
          unreachable: [],
          truncated: false,
          totalCount: 2,
          totalCountNote: null,
        },
        [
          user(USER_A, "ali@mango.test", TENANT_A, "mango-grill"),
          user(USER_B, "sara@olive.test", TENANT_B, "blue-olive"),
        ],
      ),
    );

    const Wrapper = createQueryWrapper();
    render(<FleetUserDirectory />, { wrapper: Wrapper });

    const summary = await screen.findByTestId("fleet-scan-summary");
    expect(summary).toHaveTextContent("2 people");
    expect(screen.queryByTestId("fleet-scan-unreachable")).not.toBeInTheDocument();
  });

  it("says the scan stopped short when the fan-out cap bit", async () => {
    server.use(
      ...directoryHandlers(
        {
          tenantsMatched: 140,
          tenantsScanned: 100,
          unreachable: [],
          truncated: true,
          totalCount: null,
          totalCountNote: "The scan stopped after 100 of 140 matching tenants.",
        },
        [user(USER_A, "ali@mango.test", TENANT_A, "mango-grill")],
      ),
    );

    const Wrapper = createQueryWrapper();
    render(<FleetUserDirectory />, { wrapper: Wrapper });

    const truncated = await screen.findByTestId("fleet-scan-truncated");
    expect(truncated).toHaveTextContent(/stopped short/i);
    expect(await screen.findByTestId("fleet-scan-summary")).toHaveTextContent(/Total withheld/i);
  });
});

describe("the RBAC matrix renders its read-only posture instead of an edit button", () => {
  it("shows the API's own reason and disables the edit control against it", async () => {
    server.use(
      http.get("*/api/v1/platform/rbac/matrix", () => HttpResponse.json({ data: MATRIX })),
      http.get("*/api/v1/platform/rbac/permissions", () =>
        HttpResponse.json({
          data: [
            {
              module: "pos",
              permissions: [
                { code: "pos.order.create", module: "pos", description: "Start an order" },
                { code: "pos.order.void.any", module: "pos", description: "Void any order" },
              ],
            },
            {
              module: "finance",
              permissions: [
                { code: "finance.journal.post", module: "finance", description: "Post a journal" },
              ],
            },
          ],
        }),
      ),
      http.get("*/api/v1/platform/tenants", () => HttpResponse.json({ data: [] })),
    );

    const Wrapper = createQueryWrapper();
    render(<PermissionMatrix />, { wrapper: Wrapper });

    const reason = await screen.findByTestId("rbac-read-only-reason");
    // The API's sentence, not a local paraphrase: a policy change on the server has to be able to
    // change what the console says without a frontend release.
    expect(reason).toHaveTextContent("Composing a role is granting authority");

    const edit = screen.getByTestId("rbac-edit-disabled");
    expect(edit).toBeDisabled();
    // A disabled control that explains itself. `aria-describedby` has to resolve to the reason,
    // or the button is merely inert to everyone who cannot see the note beside it.
    const describedBy = edit.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toContainElement(reason);
  });

  it("names the permissions no role grants at all", async () => {
    server.use(
      http.get("*/api/v1/platform/rbac/matrix", () => HttpResponse.json({ data: MATRIX })),
      http.get("*/api/v1/platform/rbac/permissions", () => HttpResponse.json({ data: [] })),
      http.get("*/api/v1/platform/tenants", () => HttpResponse.json({ data: [] })),
    );

    const Wrapper = createQueryWrapper();
    render(<PermissionMatrix />, { wrapper: Wrapper });

    // `finance.journal.post` is in `permissionCodes` and in neither role's grants. An orphaned
    // permission produces a clean 403 for every user including the owner, so the screen counts it
    // rather than leaving it as one unremarkable row among seventy-nine.
    const summary = await screen.findByTestId("rbac-summary");
    expect(summary).toHaveTextContent(/1 permission is granted by no role at all/i);
  });
});

describe("a platform action on a person cannot be submitted without a reason", () => {
  it("keeps the confirm disabled until a reason is typed", async () => {
    const onConfirm = vi.fn();
    const user_ = userEvent.setup();

    render(
      <UserActionDialog
        open
        onOpenChange={() => {}}
        title="Clear the lockout on Ali Raza?"
        consequence={<p>Clears the cooldown.</p>}
        confirmLabel="Clear lockout"
        reasonLabel="Reason for clearing the lockout"
        tone="neutral"
        onConfirm={onConfirm}
      />,
    );

    const submit = screen.getByTestId("user-action-submit");
    expect(submit).toBeDisabled();

    await user_.type(screen.getByTestId("user-action-reason-input"), "Support ticket 4102");
    await waitFor(() => expect(submit).toBeEnabled());

    await user_.click(submit);
    expect(onConfirm).toHaveBeenCalledWith("Support ticket 4102");
  });

  it("also waits for the typed target where one is demanded", async () => {
    const onConfirm = vi.fn();
    const user_ = userEvent.setup();

    render(
      <UserActionDialog
        open
        onOpenChange={() => {}}
        title="Deactivate Ali Raza?"
        consequence={<p>Signs them out everywhere.</p>}
        confirmPhrase="ali@mango.test"
        confirmLabel="Deactivate account"
        reasonLabel="Reason for deactivation"
        onConfirm={onConfirm}
      />,
    );

    const submit = screen.getByTestId("user-action-submit");
    await user_.type(screen.getByTestId("user-action-reason-input"), "Left the company");
    // Reason alone is not enough on an action that removes access: the typed target is what
    // confirms the operator knows WHICH row they are on.
    expect(submit).toBeDisabled();

    await user_.type(screen.getByTestId("user-action-phrase-input"), "ali@mango.test");
    await waitFor(() => expect(submit).toBeEnabled());
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("the platform's RBAC surface stays read-only in the source, not just on screen", () => {
  it("the RBAC hook file declares no mutation", () => {
    const source = stripComments(
      readFileSync(resolve(FRONTEND_ROOT, "lib/hooks/use-platform-rbac.ts"), "utf8"),
    );
    // The rendered assertions above can only see the screen. This one sees the capability: a
    // mutation hook here would mean somebody had found an endpoint to call, and there is none —
    // the platform tier holds no `user_branch_roles`, so nothing bounds what a role it composed
    // could grant.
    expect(/\buseMutation\s*[<(]/.test(source), "use-platform-rbac.ts declares a mutation").toBe(
      false,
    );
  });

  it("the access repository posts to no RBAC path", () => {
    const source = stripComments(
      readFileSync(
        resolve(FRONTEND_ROOT, "lib/repositories/platform-access.repository.ts"),
        "utf8",
      ),
    );
    const rbacWrites = [...source.matchAll(/\b(?:post|put|patch|del)\s*[<(][^\n]*rbac/g)].map(
      (match) => match[0],
    );
    expect(rbacWrites, "a write against /platform/rbac/**, which has no such endpoint").toEqual([]);
  });
});

/** A detail record with every honest-absence field at its ORDINARY value, for tests to bend. */
function detail(overrides: Record<string, unknown> = {}) {
  return {
    tenant: {
      tenantId: TENANT_A,
      slug: "mango-grill",
      brandName: "Mango Grill",
      status: "ACTIVE",
      tier: "GROWTH",
    },
    userId: USER_A,
    email: "ali@mango.test",
    fullName: "Ali Raza",
    locale: "en",
    active: true,
    mustChangePassword: false,
    totpEnabled: false,
    createdAt: new Date("2026-02-01T00:00:00Z"),
    activity: {
      lastLoginAt: new Date("2026-08-20T09:00:00Z"),
      hasEverSignedIn: true,
      note: "Current state only. Attempt-level login history lives in audit_db.audit_events.",
    },
    branchRoles: [
      { branchId: TENANT_B, roleCode: "CASHIER", primary: true, approvalLimitPaisa: null },
    ],
    stationScopes: [],
    stationScopeNote: null,
    loginable: true,
    loginableNote: null,
    ...overrides,
  } as Parameters<typeof UserIdentityPanel>[0]["user"];
}

describe("the user detail keeps three absences apart that all look like nothing", () => {
  it("renders a never-used account as a state, not a blank date", () => {
    render(
      <UserIdentityPanel
        user={detail({
          activity: { lastLoginAt: null, hasEverSignedIn: false, note: "Current state only." },
        })}
      />,
    );

    // `last_login_at` is the ONLY activity signal the platform records. Its null is the visible
    // form of a restaurant whose administrator cannot get in, and it must never render as an
    // empty cell beside an otherwise healthy-looking account.
    expect(screen.getByTestId("user-never-signed-in")).toHaveTextContent(/never signed in/i);
    expect(screen.queryByTestId("user-last-sign-in")).not.toBeInTheDocument();
  });

  it("says an account cannot be used, in the API's words rather than its own", () => {
    render(
      <UserIdentityPanel
        user={detail({
          loginable: false,
          loginableNote:
            "The account holds no active branch-role assignment, so permission resolution fails " +
            "before a token is minted.",
        })}
      />,
    );

    const notice = screen.getByTestId("user-not-loginable");
    expect(notice).toHaveTextContent(/permission resolution fails/i);
    expect(screen.queryByTestId("user-loginable")).not.toBeInTheDocument();
  });

  it("distinguishes unreadable station scopes from unrestricted ones", () => {
    const { unmount } = render(
      <UserAccessPanel
        user={detail({
          stationScopes: null,
          stationScopeNote: "Station assignments could not be read on this request.",
        })}
      />,
    );

    // `null` is "we did not find out". Rendering it as the empty case would tell an operator this
    // person can work every station when nobody knows whether they can work any.
    expect(screen.getByTestId("user-station-unreadable")).toHaveTextContent(/could not be read/i);
    expect(screen.queryByTestId("user-station-unrestricted")).not.toBeInTheDocument();
    unmount();

    render(<UserAccessPanel user={detail({ stationScopes: [] })} />);
    expect(screen.getByTestId("user-station-unrestricted")).toHaveTextContent(/every station/i);
    expect(screen.queryByTestId("user-station-unreadable")).not.toBeInTheDocument();
  });

  it("makes an empty role list the headline rather than an empty table", () => {
    render(<UserAccessPanel user={detail({ branchRoles: [] })} />);

    // An account with no assignment cannot log in at all — a defect this product has shipped —
    // so the most important fact on the screen must not arrive as an absence of rows.
    expect(screen.getByTestId("user-no-roles")).toHaveTextContent(
      /holds no active branch-role assignment/i,
    );
    expect(screen.queryByTestId("user-role-summary")).not.toBeInTheDocument();
  });
});

describe("the account actions and the trail that records them", () => {
  it("offers the transition the account is in a state for, and explains the one it is not", () => {
    const Wrapper = createQueryWrapper();
    render(<UserLifecycleActions user={detail()} />, { wrapper: Wrapper });

    // An unavailable action keeps its row and its reason rather than disappearing: a control that
    // vanishes when it does not apply leaves an operator unsure whether they lack the authority,
    // the account is in the wrong state, or the console is broken.
    expect(screen.getByTestId("user-deactivate")).toBeEnabled();
    expect(screen.getByTestId("user-reactivate")).toBeDisabled();
    expect(screen.getByText(/This account is already active/i)).toBeInTheDocument();

    // Clearing a lockout is offered unconditionally, because the user record this console reads
    // carries no lock field at all — the only way it learns the lock state is to perform the
    // unlock and read the answer.
    expect(screen.getByTestId("user-unlock")).toBeEnabled();
  });

  it("says the trail is empty rather than that nothing has happened to the account", async () => {
    server.use(
      http.get("*/api/v1/platform/operator-audit", () =>
        HttpResponse.json({
          data: [],
          meta: { page: { cursor: "0", nextCursor: null, limit: 25 }, totalCount: 0 },
        }),
      ),
    );

    const Wrapper = createQueryWrapper();
    render(<UserAuditPanel userId={USER_A} who="Ali Raza" />, { wrapper: Wrapper });

    // "No platform operator has acted on this account" and "nothing has happened to this person"
    // are different statements, and only the first is one this trail can make: it records what
    // PLATFORM staff do, not what the tenant's own administrators do inside their restaurant.
    const empty = await screen.findByTestId("user-audit-empty");
    expect(empty).toHaveTextContent(/No platform operator has acted on this account/i);
    expect(empty).toHaveTextContent(/not what the tenant/i);
  });

  it("shows a refusal as a refusal, with the reason its operator gave", async () => {
    server.use(
      http.get("*/api/v1/platform/operator-audit", () =>
        HttpResponse.json({
          data: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              occurredAt: "2026-08-21T11:00:00Z",
              platformUserId: null,
              platformUserEmail: "ops@restaurantos.test",
              action: "USER_DEACTIVATED",
              outcome: "REFUSED",
              tenantId: TENANT_A,
              tenantSlug: "mango-grill",
              targetUserId: USER_A,
              reason: "Offboarding, ticket 4102",
              detail: "UPSTREAM_CONFLICT",
            },
          ],
          meta: { page: { cursor: "0", nextCursor: null, limit: 25 }, totalCount: 1 },
        }),
      ),
    );

    const Wrapper = createQueryWrapper();
    render(<UserAuditPanel userId={USER_A} who="Ali Raza" />, { wrapper: Wrapper });

    // Refusals are written to the trail and shown alongside successes: an operator repeatedly
    // attempting something they are refused is exactly the pattern an abuse review looks for, and
    // a feed of successes cannot show it.
    // The refusal rides on `ActivityRow`'s tone label — the primitive's own non-colour channel —
    // so it is asserted there rather than by a loose text match that would also pass on the word
    // appearing anywhere in the row.
    const tone = await screen.findByText("Refused");
    expect(tone).toHaveAttribute("data-slot", "activity-tone");
    expect(screen.getByText(/Offboarding, ticket 4102/)).toBeInTheDocument();
    expect(screen.getByText("ops@restaurantos.test")).toBeInTheDocument();
  });
});
