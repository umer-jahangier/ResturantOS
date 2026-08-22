import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";

import { server } from "@/mocks/server";
import { clearSession, seedSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { RoleSelect } from "@/components/users/role-select";
import { UserList } from "@/components/users/user-list";
import { OneTimePasswordPanel } from "@/components/users/one-time-password-panel";

/**
 * The three properties of this surface that are worth freezing, and nothing else.
 *
 * <p>Each one corresponds to a defect that has actually shipped in this repository — a failed query
 * rendering as an empty state (GA-001), a role list written in the client instead of read from the
 * ceiling-filtered catalogue (the escalation 13-07 closed on the read side), and a one-time
 * credential shown without saying it is one-time.
 */

const ADMIN = {
  roles: ["TENANT_ADMIN"],
  // Exactly what a live TENANT_ADMIN token carries: the narrow codes, and NOT `rbac.manage`.
  permissions: ["rbac.user.manage", "rbac.role.manage", "branch.manage"],
};

function renderWithQuery(node: React.ReactElement) {
  const Wrapper = createQueryWrapper();
  return render(<Wrapper>{node}</Wrapper>);
}

afterEach(() => {
  cleanup();
  clearSession();
});

describe("the user list refuses to report a failure as an empty roster", () => {
  it("renders the ERROR state, with a retry, when the request fails", async () => {
    server.use(
      http.get("*/api/v1/users", () => HttpResponse.json({ error: "boom" }, { status: 500 })),
    );
    seedSession(ADMIN);

    renderWithQuery(<UserList selectedId={null} onSelect={() => {}} />);

    expect(await screen.findByTestId("query-error")).toBeInTheDocument();
    expect(screen.getByTestId("query-error-retry")).toBeInTheDocument();
    // The control that gives the assertion above its meaning: a 500 must NOT produce the words a
    // genuinely empty tenant would see. This is the exact substitution GA-001 was made of.
    expect(screen.queryByText("No users yet")).not.toBeInTheDocument();
  });

  it("renders the EMPTY state only when the request SUCCEEDED with nothing in it", async () => {
    server.use(
      http.get("*/api/v1/users", () =>
        HttpResponse.json({
          data: [],
          meta: { page: { cursor: "0", nextCursor: null, limit: 25 }, totalCount: 0 },
          warnings: [],
        }),
      ),
    );
    seedSession(ADMIN);

    renderWithQuery(<UserList selectedId={null} onSelect={() => {}} />);

    expect(await screen.findByText("No users yet")).toBeInTheDocument();
    expect(screen.queryByTestId("query-error")).not.toBeInTheDocument();
  });

  it("lists what the server returned, and says so when someone has never signed in", async () => {
    server.use(
      http.get("*/api/v1/users", () =>
        HttpResponse.json({
          data: [
            {
              // A real UUIDv4 from the seeded tenant. `z.string().uuid()` in Zod 4 checks the
              // version and variant nibbles, so an "11111111-…" placeholder is rejected — which is
              // the schema doing its job, and a reason not to write fake ids into fixtures.
              id: "9e11ef06-4bfa-4fc2-af4f-b2063b297662",
              email: "waiter@terrace.local",
              fullName: "Terrace Waiter",
              locale: "en",
              active: true,
              mustChangePassword: true,
              totpEnabled: false,
              lastLoginAt: null,
              createdAt: "2026-08-01T00:00:00Z",
            },
          ],
          meta: { page: { cursor: "0", nextCursor: null, limit: 25 }, totalCount: 1 },
          warnings: [],
        }),
      ),
    );
    seedSession(ADMIN);

    renderWithQuery(<UserList selectedId={null} onSelect={() => {}} />);

    // Scoped to the table: `DataGrid` renders the desktop table AND the below-`md` card list
    // into the same DOM and lets CSS choose (see its docblock — choosing in JS from a media query
    // hydrates a different tree than it rendered), so a bare `getByText` on a row's own text is
    // ambiguous by construction.
    const roster = await screen.findByRole("table", { name: "Users" });
    expect(within(roster).getByText("Terrace Waiter")).toBeInTheDocument();
    expect(within(roster).getByText("Never signed in")).toBeInTheDocument();
    expect(within(roster).getByText("Password reset pending")).toBeInTheDocument();
  });
});

describe("the role picker offers exactly what the ceiling allows — no more, and no less", () => {
  it("renders only the server's roles and never invents one", async () => {
    server.use(
      http.get("*/api/v1/roles", () =>
        HttpResponse.json({
          data: [
            { code: "WAITER", name: "Waiter", system: true, permissions: ["pos.order.create"] },
            { code: "CASHIER", name: "Cashier", system: true, permissions: ["pos.till.open"] },
          ],
          meta: null,
          warnings: [],
        }),
      ),
    );
    seedSession(ADMIN);

    renderWithQuery(<RoleSelect id="r" value="" onChange={() => {}} />);

    const select = await screen.findByTestId("role-select");
    const options = [...select.querySelectorAll("option")].map((o) => o.value);
    // The empty placeholder plus exactly the two the server sent. If the component ever grew a
    // hardcoded fallback list, this is the assertion that would fail.
    expect(options).toEqual(["", "WAITER", "CASHIER"]);
    expect(screen.queryByText("Owner")).not.toBeInTheDocument();
  });

  it("reports the withheld COUNT and never the withheld names", async () => {
    server.use(
      http.get("*/api/v1/roles", () =>
        HttpResponse.json({
          data: [{ code: "WAITER", name: "Waiter", system: true, permissions: [] }],
          meta: null,
          warnings: [
            {
              code: "ROLES_WITHHELD_ABOVE_CEILING",
              message:
                "1 role(s) were withheld because they grant permissions you do not hold and therefore cannot assign",
            },
          ],
        }),
      ),
    );
    seedSession(ADMIN);

    renderWithQuery(<RoleSelect id="r" value="" onChange={() => {}} />);

    const notice = await screen.findByTestId("roles-withheld");
    expect(notice).toHaveTextContent("1 more role is not listed");
    // Naming what was withheld would republish exactly what the ceiling withholds.
    expect(notice).not.toHaveTextContent("OWNER");
  });

  it("shows the failure rather than an empty picker when the catalogue cannot be read", async () => {
    server.use(
      http.get("*/api/v1/roles", () => HttpResponse.json({ error: "nope" }, { status: 503 })),
    );
    seedSession(ADMIN);

    renderWithQuery(<RoleSelect id="r" value="" onChange={() => {}} />);

    // S1-09: a 503 from the role catalogue means auth-service is not answering, and that now
    // renders the outage copy rather than the generic "couldn't load" — which is the point, since
    // an administrator who reads "the role catalogue is unavailable" knows to check the fleet and
    // one who reads "something went wrong" does not. What this test protects is unchanged: a
    // failure must be visible, and the picker must not be rendered empty.
    await waitFor(() => expect(screen.getByTestId("query-service-outage")).toBeInTheDocument());
    // An empty `<select>` would say "you may assign no roles". The truth is "we could not ask".
    expect(screen.queryByTestId("role-select")).not.toBeInTheDocument();
  });
});

describe("a one-time password says that it is one", () => {
  it("shows the value and states plainly that it will not be shown again", () => {
    render(
      <OneTimePasswordPanel
        result={{
          userId: "u1",
          email: "new@terrace.local",
          tempPassword: "zEHaY&6?CzqWe8p2",
          mustChangePassword: true,
          loginable: true,
          assignedRoleCode: "WAITER",
        }}
        intro="The account is ready."
      />,
    );

    expect(screen.getByTestId("one-time-password-value")).toHaveTextContent("zEHaY&6?CzqWe8p2");
    expect(screen.getByText(/will not be shown again/i)).toBeInTheDocument();
    // `alert`, not `status`: it must be announced, for the same reason it is not a toast.
    expect(screen.getByTestId("one-time-password")).toHaveAttribute("role", "alert");
  });

  it("warns when the new account cannot sign in because it holds no role", () => {
    render(
      <OneTimePasswordPanel
        result={{
          userId: "u1",
          email: "new@terrace.local",
          tempPassword: "zEHaY&6?CzqWe8p2",
          mustChangePassword: true,
          loginable: false,
          assignedRoleCode: null,
        }}
        intro="The account is ready."
      />,
    );

    expect(screen.getByText(/cannot sign in even with this password/i)).toBeInTheDocument();
  });
});
