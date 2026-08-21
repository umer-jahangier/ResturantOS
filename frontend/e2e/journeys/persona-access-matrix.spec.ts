import { expect, test } from "../fixtures/auth.fixture";
import { ALL_PERSONAS, persona } from "../fixtures/personas";
import { DEFECTS, tolerate } from "../fixtures/known-defects";

/**
 * JOURNEY 1 — every seeded persona can actually reach the app in a browser.
 *
 * This is the browser twin of `scripts/seed_restaurantos.py --phase verify`, and it exists
 * because that script proves an HTTP login works, not that a BROWSER ends up signed in.
 * Those are different claims, and this project has shipped the gap between them before: the
 * audit that produced Phase 13 found a phase marked "24/24 passed" whose verification had
 * only grepped source (AUDIT-REPORT-2026-08-06.md).
 *
 * What each case proves, in order:
 *   1. proxy.ts does NOT bounce the request (the has_session marker is present)
 *   2. SessionProvider's POST /api/v1/auth/refresh succeeded against the real gateway —
 *      if the replayed refresh_token were stale the app would land on /login?reason=…
 *   3. the shell rendered with a session, i.e. useCurrentUser resolved
 *
 * Point 2 is the one that matters: it is the only assertion here that a mocked backend
 * could not satisfy.
 */

test.describe("persona access matrix", () => {
  test("an unauthenticated browser never sees the app shell", async ({ page }) => {
    await page.goto("/app/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  for (const p of ALL_PERSONAS) {
    test(`${p.id} (${p.role}) reaches the tenant shell`, async ({ as, obs }) => {
      // The ACCOUNTANT dashboard 403s on its own menu fetch. That is a PRODUCT defect, pinned
      // by known-defects.spec.ts — not a tolerance added to make this test green.
      if (p.local === "accountant") tolerate(obs, DEFECTS.ACCOUNTANT_DASHBOARD_MENU_403);

      const page = await as(p);

      const refreshed = page.waitForResponse(
        (r) => r.url().includes("/api/v1/auth/refresh") && r.request().method() === "POST",
        { timeout: 30_000 },
      );

      await page.goto("/app/dashboard");

      // The rehydration call itself, against the gateway. A 200 here is the difference
      // between "the cookie replayed" and "the session is real".
      const res = await refreshed;
      expect(
        res.status(),
        res.status() === 429
          ? `POST /api/v1/auth/refresh returned 429 for ${p.email}. This is the gateway's ` +
              "CREDENTIAL rate-limit bucket (replenish 2/s, burst RATE_LIMIT_AUTH_PER_MIN=100, " +
              "keyed per-IP) — /auth/refresh shares it with /auth/login, and SessionProvider " +
              "calls refresh on every page load. Either the per-worker X-Forwarded-For isolation " +
              "is off (E2E_WORKER_IP=0) or you are behind a proxy that rewrites it: lower " +
              "--workers, or raise RATE_LIMIT_AUTH_PER_MIN on the e2e stack. NOTE: the product " +
              "treats this 429 as an expired session and bounces the user to /login."
          : `POST /api/v1/auth/refresh returned ${res.status()} for ${p.email}. The storage ` +
              "state carries a refresh_token auth-service no longer accepts — re-run the " +
              "auth-setup project (states are minted, not committed).",
      ).toBe(200);

      // Not bounced back to /login by either gate.
      await expect(page).toHaveURL(/\/app\/dashboard/);

      // The shell rendered with a session. KITCHEN_STAFF gets a different H1 by design
      // (components/dashboard/tenant-dashboard.tsx:78-84).
      const heading = p.local === "kitchen" ? "Kitchen" : "Dashboard";
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({
        timeout: 20_000,
      });

      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    });
  }

  /**
   * The negative half of the matrix, on ONE tenant so the only variable is the role — a
   * cross-tenant comparison here would confound RBAC with feature gating.
   *
   * "Till Review" is the manager/owner action that approves or flags a CASHIER's closed till,
   * so it is gated on `pos.till.review`, which the cashier deliberately does not hold — the
   * cashier holds `pos.till.open` instead. Verified against the live tokens rather than
   * inferred from the nav file: MANAGER carries 49 permission codes including pos.till.review;
   * CASHIER carries 14 and does not (components/shared/sidebar-nav-items.ts:170-178 states the
   * same intent in prose).
   */
  test("nav is role-scoped: manager sees Till Review, cashier does not", async ({ as }) => {
    const managerPage = await as(persona("terrace", "manager"));
    await managerPage.goto("/app/dashboard");
    const managerNav = managerPage.getByRole("navigation", { name: "Primary" });
    await expect(managerNav.getByRole("link", { name: "Till Review" })).toBeVisible({
      timeout: 20_000,
    });

    const cashierPage = await as(persona("terrace", "cashier"));
    await cashierPage.goto("/app/dashboard");
    const cashierNav = cashierPage.getByRole("navigation", { name: "Primary" });
    // Anchor on an item the cashier DOES have first, so "absent" means "gated out" and not
    // "the sidebar had not rendered yet".
    await expect(cashierNav.getByRole("link", { name: "POS" })).toBeVisible({ timeout: 20_000 });
    await expect(cashierNav.getByRole("link", { name: "Till Review" })).toHaveCount(0);
  });
});
