import { expect, test } from "../fixtures/auth.fixture";
import { PERSONA_LOCALS, persona } from "../fixtures/personas";
import { ROLE_MATRIX, hiddenFor } from "../fixtures/nav-matrix";
import { DEFECTS, tolerate } from "../fixtures/known-defects";

/**
 * THE ROLE-VISIBILITY MATRIX — "each role has only its allowed functionality".
 *
 * For each of the six personas, on ONE tenant so role is the only variable:
 *
 *   1. every nav item the role SHOULD have is present
 *   2. every nav item it should NOT have is absent — asserted item by item, not by count
 *   3. a route it must not use REFUSES it, in the browser
 *
 * (2) is the half that catches over-granting, and it is the half most suites omit. A test
 * that only checks the positive list passes just as happily against a sidebar that shows
 * everything to everybody.
 *
 * (3) is checked separately from (2) on purpose: hiding a nav item is DECORATION. The
 * question that matters is whether typing the URL gets you in, and that is a different code
 * path — a route with no guard renders fine for a role that has no business there, even
 * though its nav item is correctly hidden. This suite has already found exactly that.
 */

const TENANT = "saffron";

test.describe("role visibility matrix", () => {
  for (const local of PERSONA_LOCALS) {
    const p = persona(TENANT, local);
    const spec = ROLE_MATRIX[local];

    test(`${spec.role} sees exactly its permitted navigation`, async ({ as, obs }) => {
      if (local === "accountant") tolerate(obs, DEFECTS.ACCOUNTANT_DASHBOARD_MENU_403);

      const page = await as(p);
      await page.goto("/app/dashboard");

      const nav = page.getByRole("navigation", { name: "Primary" });
      await expect(nav).toBeVisible({ timeout: 20_000 });

      // Wait for a GATED item this role holds — see RoleExpectation.anchor. Waiting for the
      // ungated "Dashboard" instead is a measured false-negative machine: it renders in the
      // first paint, before feature flags resolve, and every gated item then reads as absent.
      await expect(
        nav.getByRole("link", { name: spec.anchor, exact: true }),
        `the gating pass never completed for ${spec.role}: its anchor nav item ` +
          `"${spec.anchor}" never appeared, so nothing below could distinguish "gated out" ` +
          'from "not yet rendered". Check GET /api/v1/feature-flags for this tenant.',
      ).toBeVisible({ timeout: 25_000 });

      // ── everything this role SHOULD see ────────────────────────────────────────────
      const missing: string[] = [];
      for (const label of spec.visible) {
        const count = await nav.getByRole("link", { name: label, exact: true }).count();
        if (count === 0) missing.push(label);
      }
      expect(
        missing,
        `${spec.role} is MISSING navigation it holds the permissions for. Either the nav ` +
          "gate is stricter than the permission model, or the role lost a permission. " +
          "Cross-check with `scripts/seed_restaurantos.py --phase verify`, which prints each " +
          "role's live permission count.",
      ).toEqual([]);

      // ── everything this role must NOT see ──────────────────────────────────────────
      const leaked: string[] = [];
      for (const label of hiddenFor(local)) {
        const count = await nav.getByRole("link", { name: label, exact: true }).count();
        if (count > 0) leaked.push(label);
      }
      expect(
        leaked,
        `${spec.role} can see navigation it must not. This is over-granting: either the nav ` +
          "item's permission/role gate is missing, or the role holds a permission it should " +
          "not. Both are security findings, not cosmetic ones.",
      ).toEqual([]);
    });

    test(`${spec.role} is refused ${spec.forbidden.route}`, async ({ as, obs }) => {
      // E2E-D2: /platform/** has NO authorization layer, so this assertion genuinely fails.
      // `test.fail()` records that as an EXPECTED failure — the suite stays green, but the
      // moment someone guards the route this case goes RED and says to remove the marker.
      // The alternative (deleting the assertion) would make the defect invisible; the other
      // alternative (leaving it red) would train everyone to ignore a red suite.
      if (spec.forbidden.route.startsWith("/platform")) {
        test.fail(
          true,
          `${DEFECTS.PLATFORM_ROUTES_HAVE_NO_AUTHORIZATION.id}: ` +
            DEFECTS.PLATFORM_ROUTES_HAVE_NO_AUTHORIZATION.title +
            " — when this case starts PASSING, delete this test.fail() and the registry entry.",
        );
      }

      // A guarded route legitimately produces refused API calls while it decides. The route
      // is the assertion; the traffic it generates is not.
      obs.expectNetworkFailure({
        url: /\/api\/v1\//,
        status: [401, 403],
        because: `${spec.role} is deliberately probing a route it may not use`,
      });
      if (local === "accountant") tolerate(obs, DEFECTS.ACCOUNTANT_DASHBOARD_MENU_403);
      // /app/pos mounts the POS layout — and therefore E2E-D4's doomed socket — BEFORE the
      // permission guard refuses. Tolerated only where a POS route is actually loaded.
      if (spec.forbidden.route.startsWith("/app/pos")) {
        tolerate(obs, DEFECTS.POS_ORDERS_WEBSOCKET_REJECTED_AT_GATEWAY);
      }

      const page = await as(p);
      await page.goto(spec.forbidden.route, { waitUntil: "domcontentloaded" });

      // Acceptable refusals. The product uses a PER-ROUTE message rather than one shared
      // page — measured: "You do not have permission to review tills." at /app/pos/tills,
      // "...to access the POS terminal." at /app/pos, "...to access the Kitchen Display."
      // at /app/kitchen, and AccessDenied's generic "...to view this page." Matching only
      // the generic heading reported four correct refusals as failures, so the matcher is
      // the shared clause all four contain.
      const refusalText = page.getByText(/You do not have permission/i).first();
      const notFound = page.getByText("404", { exact: false }).first();

      const refused = await Promise.race([
        refusalText
          .waitFor({ state: "visible", timeout: 20_000 })
          .then(() => "refused" as const)
          .catch(() => null),
        notFound
          .waitFor({ state: "visible", timeout: 20_000 })
          .then(() => "not-found" as const)
          .catch(() => null),
        page
          .waitForURL((u) => !u.pathname.startsWith(spec.forbidden.route), { timeout: 20_000 })
          .then(() => "redirected" as const)
          .catch(() => null),
      ]);

      expect(
        refused,
        `${spec.role} was NOT refused ${spec.forbidden.route}. That route is gated on ` +
          `\`${spec.forbidden.requires}\`, which this role does not hold — ${spec.forbidden.why}. ` +
          "The page rendered instead of refusing, which means the ROUTE has no client-side " +
          "authorization guard even if its nav item is correctly hidden. Hiding the link is " +
          "not access control; a user who types the URL, follows a bookmark, or is sent one " +
          "reaches it.",
      ).not.toBeNull();
    });
  }
});
