import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";

import { server } from "@/mocks/server";
import { clearSession, seedSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { UserDetailPanel } from "@/components/users/user-detail-panel";

/**
 * S2 — a role can be TAKEN BACK from the screen that granted it.
 *
 * <h3>What was actually wrong</h3>
 *
 * Two things, and the register only saw one of them. The panel had no control at all — the live
 * probe read `{buttonsInsideRolesBlock: [], anyRevokeText: false}`. Underneath it,
 * `UserRepository.removeBranchRole` existed with ZERO callers and sent no query parameters, while
 * the controller declares `branchId` and `roleCode` as REQUIRED: driven live as the owner it
 * answered `400 Required request parameter 'branchId' is missing`, and the same call with the
 * parameters answered `204` and the assignment genuinely disappeared
 * (`.planning/audits/floor/S2/_repro.json`). So the missing button was hiding a client that could
 * never have worked.
 *
 * <h3>Why these assertions and not others</h3>
 *
 * Every one is about what a person sees or what the server receives — never a prop, never a call
 * count on a mocked hook. The request assertion in particular is the one that fails against the
 * old repository: a component test that only checked "a DELETE was issued" would have passed
 * against the 400.
 */

const OWNER = {
  roles: ["OWNER"],
  permissions: ["rbac.manage", "rbac.user.manage", "rbac.role.manage"],
};

/** A branch MANAGER: may read the roster, may not administer roles. */
const MANAGER = { roles: ["MANAGER"], permissions: ["pos.order.create"] };

const TENANT_ID = "a1f6b0c2-58e1-4d2b-9d1a-7c3e4f5a6b71";
const USER_ID = "9e11ef06-4bfa-4fc2-af4f-b2063b297662";
const HQ_ID = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
const ROOFTOP_ID = "c2d74ade-7ff8-4167-8cd0-131bfbdf4fba";

const USER = {
  id: USER_ID,
  email: "waiter@terrace.local",
  fullName: "Terrace Waiter",
  locale: "en",
  active: true,
  mustChangePassword: false,
  totpEnabled: false,
  lastLoginAt: "2026-08-11T09:00:00Z",
  createdAt: "2026-08-01T00:00:00Z",
};

function assignment(branchId: string, roleCode: string, primary = false) {
  return { branchId, roleCode, primary, approvalLimitPaisa: null };
}

/** The detail endpoint, plus the branch names the panel resolves ids through. */
function seedServer(assignments: ReturnType<typeof assignment>[]) {
  server.use(
    http.get(`*/api/v1/users/${USER_ID}/stations`, () =>
      HttpResponse.json({ data: [], meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/branches", () =>
      HttpResponse.json({
        data: [
          {
            id: HQ_ID,
            tenantId: TENANT_ID,
            name: "Floating Terrace HQ",
            isHq: true,
            isActive: true,
          },
          {
            id: ROOFTOP_ID,
            tenantId: TENANT_ID,
            name: "Floating Terrace — Rooftop",
            isHq: false,
            isActive: true,
          },
        ],
        meta: null,
        warnings: [],
      }),
    ),
    http.get(`*/api/v1/users/${USER_ID}`, () =>
      HttpResponse.json({ data: { user: USER, assignments }, meta: null, warnings: [] }),
    ),
  );
}

function renderPanel() {
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <UserDetailPanel userId={USER_ID} />
    </Wrapper>,
  );
}

afterEach(() => {
  cleanup();
  clearSession();
});

describe("a role can be taken back from the Roles-by-branch panel", () => {
  it("offers a revoke control on every role row, named with the role AND the branch", async () => {
    seedServer([assignment(HQ_ID, "WAITER", true), assignment(ROOFTOP_ID, "CASHIER")]);
    seedSession(OWNER);
    renderPanel();

    // The exact probe the register ran, inverted. It read
    // `{buttonsInsideRolesBlock: [], anyRevokeText: false}`.
    expect(
      await screen.findByRole("button", { name: "Revoke WAITER at Floating Terrace HQ" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Revoke CASHIER at Floating Terrace — Rooftop" }),
    ).toBeInTheDocument();
    // Named per row rather than four identical "Revoke" buttons: on a user who works four
    // branches, which row an icon belongs to is a visual fact only.
    expect(screen.getAllByRole("button", { name: /^Revoke / })).toHaveLength(2);
  });

  it("confirms by naming the role and the branch before anything is sent", async () => {
    seedServer([assignment(HQ_ID, "WAITER", true), assignment(ROOFTOP_ID, "CASHIER")]);
    seedSession(OWNER);

    let deleteCalls = 0;
    server.use(
      http.delete(`*/api/v1/users/${USER_ID}/branch-roles`, () => {
        deleteCalls += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderPanel();
    await userEvent.click(
      await screen.findByRole("button", { name: "Revoke CASHIER at Floating Terrace — Rooftop" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Revoke CASHIER at Floating Terrace — Rooftop\?/)).toBeInTheDocument();
    // The consequence, not "are you sure".
    expect(dialog).toHaveTextContent(/loses every permission/i);
    expect(dialog).toHaveTextContent(/roles at other branches are untouched/i);
    // A confirmation that has already done the thing is not a confirmation.
    expect(deleteCalls).toBe(0);
  });

  /**
   * The assertion the old client fails.
   *
   * <p>`removeBranchRole` sent `DELETE /api/v1/users/{id}/branch-roles` with no query string at
   * all, and the controller declares both parameters required — so this test asserts the URL the
   * server actually needs, not merely that a DELETE happened. Watched failing before the fix with
   * `expected 'c2d74ade-…' but got null`.
   */
  it("sends the branch AND the role, which is what the endpoint requires", async () => {
    seedServer([assignment(HQ_ID, "WAITER", true), assignment(ROOFTOP_ID, "CASHIER")]);
    seedSession(OWNER);

    let seenUrl: URL | null = null;
    server.use(
      http.delete(`*/api/v1/users/${USER_ID}/branch-roles`, ({ request }) => {
        seenUrl = new URL(request.url);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderPanel();
    await userEvent.click(
      await screen.findByRole("button", { name: "Revoke CASHIER at Floating Terrace — Rooftop" }),
    );
    await userEvent.click(await screen.findByTestId("confirm-dialog-confirm"));

    await waitFor(() => expect(seenUrl).not.toBeNull());
    expect(seenUrl!.searchParams.get("branchId")).toBe(ROOFTOP_ID);
    expect(seenUrl!.searchParams.get("roleCode")).toBe("CASHIER");
  });

  it("warns that the account will not be able to sign in when it is the last role", async () => {
    seedServer([assignment(HQ_ID, "WAITER", true)]);
    seedSession(OWNER);
    renderPanel();

    await userEvent.click(
      await screen.findByRole("button", { name: "Revoke WAITER at Floating Terrace HQ" }),
    );

    const dialog = await screen.findByRole("dialog");
    // The one outcome an administrator would not predict from the word "revoke".
    expect(dialog).toHaveTextContent(/only role/i);
    expect(dialog).toHaveTextContent(/no longer be able to sign in/i);
  });

  /**
   * The refusal shown must be the SERVER'S SENTENCE, not the generic fallback.
   *
   * <p>This assertion exists because the first version of it did not survive contact with the
   * running stack. `formatUserFacingError` swaps any message longer than 160 characters for
   * "Something went wrong. Please try again." — a cap that keeps raw Zod dumps off the screen — and
   * the refusal auth-service first sent ran to 171. Driven live, the dialog read exactly
   * "Something went wrong", which tells an owner nothing about why the role they tried to remove is
   * still on screen (`.planning/audits/floor/S2/_prove.json`, first run). The server sentence was
   * shortened at its source; this pins the outcome rather than the length.
   *
   * <p>The fixture message is the real one, character for character.
   */
  it("shows the server's actual refusal inside the dialog, not the generic fallback", async () => {
    seedServer([assignment(HQ_ID, "WAITER", true), assignment(ROOFTOP_ID, "OWNER")]);
    seedSession(OWNER);

    server.use(
      http.delete(`*/api/v1/users/${USER_ID}/branch-roles`, () =>
        HttpResponse.json(
          {
            error: {
              code: "ROLE_CEILING_EXCEEDED",
              message:
                "You cannot revoke the role OWNER: it grants 12 permission(s) you do not hold yourself. Ask an administrator who holds them.",
              details: [],
            },
          },
          { status: 403 },
        ),
      ),
    );

    renderPanel();
    await userEvent.click(
      await screen.findByRole("button", { name: "Revoke OWNER at Floating Terrace — Rooftop" }),
    );
    await userEvent.click(await screen.findByTestId("confirm-dialog-confirm"));

    // In the dialog, not a toast over a closed dialog — the administrator has to be able to read
    // why the list in front of them did not change.
    const dialog = await screen.findByRole("dialog");
    const alert = await waitFor(() => within(dialog).getByRole("alert"));
    expect(alert).toHaveTextContent(/cannot revoke the role OWNER/i);
    // The control that gives the line above its meaning. Without it, "an alert appeared" is
    // satisfied by the generic string — which is what the live run actually produced.
    expect(alert).not.toHaveTextContent(/Something went wrong/i);

    // Dismiss and look at the list again. The row must still be there: a refusal that leaves the
    // panel showing the role gone would be the panel lying about the server's state. (The query is
    // by test id because the modal is `aria-modal`, so while it is open nothing behind it is
    // exposed to a role query — which is why this assertion comes after the dialog is closed.)
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(
      screen.getByRole("button", { name: "Revoke OWNER at Floating Terrace — Rooftop" }),
    ).toBeInTheDocument();
  });

  /**
   * The same guarantee, for a refusal that does NOT fit in a tweet.
   *
   * <h3>Why this exists as well as the case above</h3>
   *
   * The case above was made to pass by shortening auth-service's sentence until it fitted a
   * 160-character cap in `formatUserFacingError`. That fixed one message and left the rule that
   * broke it in place — a rule keyed on LENGTH, which cannot tell a raw Zod dump from a refusal
   * that took the trouble to explain itself. An audit of the fleet found eight refusals over that
   * cap, every one of them reaching a screen as "Something went wrong": a payslip refusal carrying
   * the arithmetic breakdown an operator needs (306 chars), a goods-receipt refusal that spends 72
   * of its characters on two UUIDs (400), and more. The cap is now a structural test for machine
   * output plus a backstop far above real copy.
   *
   * <p>So this drives the whole path — msw response, repository, hook, dialog — with a refusal
   * that the old rule would have swallowed, and asserts the words survive to the alert. A unit
   * test on `formatUserFacingError` would not have caught the original defect either, because the
   * function was behaving exactly as written; what was wrong was what a person saw at the end of
   * it. `__tests__/lib/errors/user-facing.test.ts` covers the rule itself.
   */
  it("shows a long refusal in full, rather than swallowing it for being long", async () => {
    seedServer([assignment(HQ_ID, "WAITER", true), assignment(ROOFTOP_ID, "OWNER")]);
    seedSession(OWNER);

    // Realistic for this endpoint: names the role, the branch, the size of the gap, and the way
    // out. 209 characters — comfortably past the cap that used to replace it wholesale.
    const LONG_REFUSAL =
      "You cannot revoke the role OWNER at Floating Terrace — Rooftop: it grants 12 permission(s) " +
      "you do not hold yourself, including the authority to manage roles. Ask an administrator " +
      "who holds them to make this change.";

    // The guard. If this fixture is ever shortened under the old cap, this test stops proving
    // anything, and it should say so loudly rather than keep passing.
    expect(LONG_REFUSAL.length).toBeGreaterThan(160);

    server.use(
      http.delete(`*/api/v1/users/${USER_ID}/branch-roles`, () =>
        HttpResponse.json(
          {
            error: { code: "ROLE_CEILING_EXCEEDED", message: LONG_REFUSAL, details: [] },
          },
          { status: 403 },
        ),
      ),
    );

    renderPanel();
    await userEvent.click(
      await screen.findByRole("button", { name: "Revoke OWNER at Floating Terrace — Rooftop" }),
    );
    await userEvent.click(await screen.findByTestId("confirm-dialog-confirm"));

    const dialog = await screen.findByRole("dialog");
    const alert = await waitFor(() => within(dialog).getByRole("alert"));

    // Every clause, not merely the opening one: the remedy is the LAST sentence in this message —
    // as it is across the fleet — so a rule that truncated to fit would pass an "it starts with
    // the right words" assertion while discarding the only part the reader can act on.
    expect(alert).toHaveTextContent(/including the authority to manage roles/i);
    expect(alert).toHaveTextContent(/Ask an administrator who holds them to make this change/i);
    // The control, as in the case above.
    expect(alert).not.toHaveTextContent(/Something went wrong/i);
  });

  it("renders no revoke control for a persona without role authority", async () => {
    seedServer([assignment(HQ_ID, "WAITER", true)]);
    seedSession(MANAGER);
    renderPanel();

    // The panel still renders — this persona can read the roster — but the write control is not
    // drawn. The server refuses it too (403 PERMISSION_DENIED, measured live); hiding it is the
    // courtesy, not the control.
    expect(await screen.findByText("Roles by branch")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Revoke / })).not.toBeInTheDocument();
  });
});
