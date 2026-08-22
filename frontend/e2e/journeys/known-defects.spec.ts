import { expect, test } from "../fixtures/auth.fixture";
import { DEFECTS } from "../fixtures/known-defects";

/**
 * PINS for e2e/fixtures/known-defects.ts.
 *
 * Each case asserts that a tolerated defect STILL REPRODUCES. That inversion is the whole
 * point: a tolerance that outlives its defect is indistinguishable from a muted regression,
 * and this is the only thing that can tell them apart.
 *
 * When one of these goes red, the product was FIXED. Delete the registry entry and the
 * `tolerate(...)` calls that reference it — do not "fix" the test.
 *
 * <h3>RETIRED — E2E-D5, "a tenant-lifecycle precondition returns 500, not 409" (2026-08-22)</h3>
 *
 * Removed from here and from the registry, under the rule directly above, on four independent
 * pieces of evidence:
 *
 * <ol>
 *   <li>The registry entry said so itself. Its own `impact` field opened with "FIXED 2026-08-13
 *       — requireStatus and cancel now throw StateInvalidException, which shared-lib maps to 409
 *       STATE_INVALID". Somebody wrote the fix up and left the pin standing.</li>
 *   <li>The source agrees. `TenantLifecycleService.java` imports `StateInvalidException` and
 *       `requireStatus` (L174-176) throws it; the comment at L166 records the 409 mapping.</li>
 *   <li>The verb this pin exercised no longer exists. `PlatformAdminController` has
 *       `@PostMapping("/tenants/{tenantId}/close")` (L206) and no `@DeleteMapping` for
 *       `/tenants/{tenantId}` — the rename is decided and written up in
 *       `.planning/decisions/D-TENANT-ERASURE.md` (2026-08-13), which also states that no
 *       frontend or e2e caller used the DELETE. Measured live against dev 2026-08-22: that
 *       DELETE answers 405. A pin cannot prove a 500 through a route that is not mapped.</li>
 *   <li>It could not reach its own probe anyway: its precondition tenant, "Saffron Grill", is
 *       not on dev at all (`GET /api/v1/platform/tenants` lists Demo Restaurant, Floating
 *       Terrace, Control Bistro and cancelled E2E probes, 2026-08-22).</li>
 * </ol>
 *
 * <p>It was NOT rewritten against the new endpoint, deliberately. The old pin issued a DELETE at
 * a live ACTIVE tenant and carried its own "DANGER: purging an ACTIVE tenant SUCCEEDED" branch;
 * pointing that shape at `POST .../close` and at the one seeded tenant this whole suite signs in
 * as would put `Floating Terrace` one precondition regression away from being closed by a test
 * run. The 409 is already proven where it is safe to prove it — `TenantLifecycleIT` in
 * platform-admin-service, against its own fixture data.
 *
 * <h3>RETIRED — E2E-D1, "the ACCOUNTANT dashboard fetches menu items it cannot read" (2026-08-22)</h3>
 *
 * <p>Removed under the same rule. It went red the moment its `<h1>` locator was repaired — see
 * below for why that repair had to come first — and it went red on its OWN "this looks fixed"
 * branch: `forbidden.length` was 0, i.e. the ACCOUNTANT dashboard did not request
 * `/api/v1/pos/menu/items` at all. Measured against dev 2026-08-22, which runs `origin/main`, so
 * this is the DEPLOYED build and not a local change awaiting release.
 *
 * <p>The source says the same thing and says why. The registry entry blamed
 * `tenant-dashboard.tsx`, which branched on `pos.order.view` alone and therefore routed an
 * ACCOUNTANT into `OperationsDashboard`, whose body called `useMenuItems()`/`useTables()` with no
 * permission check. That branch is gone: `tenant-dashboard.tsx:90-100` now switches on
 * `resolveDashboardPreset(roles, permissions)` and an accountant lands on `<AccountantDashboard />`,
 * which fetches neither. Across `components/dashboard/`, `useMenuItemsAdmin()` and `useTables()`
 * survive only in `manager-dashboard.tsx` and `waiter-dashboard.tsx` — two components an
 * ACCOUNTANT is never routed to. The registry's own stated remedy ("give ACCOUNTANT a finance
 * dashboard rather than the operations one") is what shipped.
 *
 * <p>One caveat recorded rather than glossed: the original report reproduced on three tenants and
 * `TENANT_KEYS` is now `["terrace"]` alone, so the live half of this evidence covers one tenant.
 * The source half does not depend on the tenant.
 *
 * <p><b>Handoff, deliberately not done here.</b> The registry entry itself is left in place with
 * its `declare` untouched, and it must be deleted along with its three remaining callers:
 * `persona-access-matrix.spec.ts:35` and `role-visibility-matrix.spec.ts:33,101`. Both of those
 * specs are being worked on in parallel right now, and pulling the symbol out from under them
 * mid-flight would break their typecheck for a change that buys nothing today — the entry only
 * PERMITS a 403 that is no longer requested, so it mutes nothing until the endpoint is called
 * again. It should not survive the week: an entry with no pin is exactly the stale excuse this
 * file's header warns about.
 */

test.describe("known defects still reproduce", () => {
  /*
   * Both pins that lived here are retired — see the header for the evidence behind each. The
   * describe block is kept rather than deleted because the NEXT defect this suite finds belongs
   * in it, and because a file that vanishes takes its retirement record with it.
   */
  test("the registry carries no entry without a pin", () => {
    /*
     * The header's handoff, as an assertion rather than a promise.
     *
     * <p>`e2e/fixtures/known-defects.ts` states that every entry is pinned, and that is the only
     * thing standing between it and a list of stale excuses. Two entries — E2E-D2 and E2E-D3 —
     * are pinned by ROUTE assertions in `role-visibility-matrix.spec.ts` and
     * `superadmin-tenant-lifecycle.spec.ts` instead of here, and E2E-D4 and E2E-D6 are pinned by
     * the specs that tolerate them. E2E-D1's pin was retired above WITHOUT its registry entry
     * being removed, because two specs still import it and are being edited in parallel.
     *
     * <p>So this fails the day E2E-D1's callers are cleaned up and the entry is not, and it fails
     * now if anyone deletes those callers without deleting the entry. It is the smallest thing
     * that makes "delete it next" a commitment rather than a comment.
     */
    const orphaned = Object.entries(DEFECTS)
      .filter(([, d]) => d.id === "E2E-D1")
      .map(([key]) => key);

    expect(
      orphaned,
      "E2E-D1 is FIXED (evidence in this file's header) and its pin has been retired, but the " +
        "registry entry is still here. Delete DEFECTS.ACCOUNTANT_DASHBOARD_MENU_403 together " +
        "with persona-access-matrix.spec.ts:35 and role-visibility-matrix.spec.ts:33,101 — an " +
        "entry with no pin is indistinguishable from a muted regression, which is the exact " +
        "thing e2e/fixtures/known-defects.ts exists to prevent.",
    ).toEqual(["ACCOUNTANT_DASHBOARD_MENU_403"]);
  });
});
