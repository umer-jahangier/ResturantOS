import type { Observability } from "./observability";

/**
 * KNOWN APPLICATION DEFECTS — found by this suite, not yet fixed.
 *
 * WHY A REGISTRY RATHER THAN A LOOSER GUARD
 * =========================================
 * When the observability guard found the 403 below, there were three options:
 *
 *   1. widen the guard so 403s stop failing tests      — destroys the guard's value everywhere
 *   2. delete the assertion from the affected specs    — the defect becomes invisible
 *   3. name the defect, once, and reference it          — this file
 *
 * Every entry is a WRITTEN CLAIM that a specific failure is the product's fault and is being
 * tolerated deliberately. It carries the evidence that established it, so a reader does not
 * have to re-derive it. Nothing here is a workaround for a test-harness problem: those get
 * fixed in the harness.
 *
 * EACH ENTRY IS PINNED. `e2e/journeys/known-defects.spec.ts` asserts each one still
 * reproduces. When someone fixes the product, that spec goes RED and tells them to delete
 * the entry — so this file cannot rot into a list of stale excuses that silently mute real
 * regressions.
 */

export interface KnownDefect {
  id: string;
  title: string;
  /** What the user experiences. */
  impact: string;
  /** How it was established — a command, a measurement, a file:line. */
  evidence: string;
  /** The apply function that declares the resulting failures to an Observability guard. */
  declare: (obs: Observability) => void;
}

export const DEFECTS = {
  /**
   * Found 2026-08-07 by the observability guard, on the FIRST run in which it was enabled.
   * Reproduced on all three tenants independently (saffron, zaitoon, marina).
   */
  ACCOUNTANT_DASHBOARD_MENU_403: {
    id: "E2E-D1",
    title: "The ACCOUNTANT dashboard fetches menu items it has no permission to read",
    impact:
      "Every ACCOUNTANT sees two failed 403 requests on their default landing page " +
      "(/app/dashboard) on every load. The menu-derived stat card silently renders as if the " +
      "menu were empty rather than as unavailable, so the number shown is wrong, not absent.",
    evidence:
      "Live token for accountant@saffron.local carries 24 permissions of which the ONLY pos.* " +
      "entry is `pos.order.view` (verified against the running gateway, 2026-08-07). " +
      "components/dashboard/tenant-dashboard.tsx:282-291 branches the dashboard on " +
      "`pos.order.view` alone, so ACCOUNTANT is routed to OperationsDashboard, whose body " +
      "(L104-107) calls useMenuItems() and useTables() unconditionally — with no permission " +
      "check and no error surface. GET /api/v1/pos/menu/items -> 403 PERMISSION_DENIED, twice " +
      "(React Query retries once). Remedy: gate useMenuItems/useTables on the permissions they " +
      "require (`pos.menu.view` / `pos.table.view`), or give ACCOUNTANT a finance dashboard " +
      "rather than the operations one.",
    declare: (obs) =>
      obs
        .expect403(
          "/api/v1/pos/menu/items",
          "E2E-D1: OperationsDashboard fetches the menu without checking permission",
        )
        .expect403(
          "/api/v1/pos/tables",
          "E2E-D1: same component, same unchecked fetch — tables may 403 for the same roles",
        ),
  },
  /**
   * Found 2026-08-07 by the role-visibility matrix. Reproduced with OWNER, WAITER and
   * KITCHEN_STAFF — i.e. it does not depend on how privileged the tenant user is.
   */
  PLATFORM_ROUTES_HAVE_NO_AUTHORIZATION: {
    id: "E2E-D2",
    title: "/platform/** is authenticated but NOT authorized — any tenant user renders it",
    impact:
      "Any signed-in tenant user, including a KITCHEN_STAFF account holding exactly two " +
      "permissions, can navigate to /platform/dashboard and render the SuperAdmin shell. " +
      "NO TENANT DATA IS EXPOSED TODAY, and that is worth stating precisely: the gateway " +
      "does refuse /api/v1/platform/** for a tenant token (Phase 13 SC1 asserts exactly " +
      "that), and the page currently reachable is a nine-line placeholder that fetches " +
      "nothing. The finding is that the ROUTE GROUP has no authorization layer at all, so " +
      "the moment a real control-plane page lands there — tenant list, tier changes, module " +
      "toggles — it renders for every tenant user, and only the API layer stands between " +
      "them and it.",
    evidence:
      "frontend/proxy.ts:53-61 gates PROTECTED = ['/platform', '/app'] on the presence of the " +
      "`has_session` cookie ONLY — an authentication check, and its own header comment says " +
      "it is not a security boundary. frontend/app/(platform)/layout.tsx renders a header and " +
      "{children} with no PermissionGuard, no role check and no platform-token check; contrast " +
      "the tenant pages, which do use <PermissionGuard require=...>. Measured live: storage " +
      "states for saffron.owner, saffron.waiter and saffron.kitchen each rendered " +
      "main='Platform Dashboard SuperAdmin shell placeholder.' at /platform/dashboard. " +
      "Remedy: wrap the (platform) layout in a guard requiring a platform-typed token " +
      "(token_type='platform' / SUPER_ADMIN), redirecting tenant sessions to /app/dashboard.",
    declare: () => {
      // Nothing to declare: the defect is that the page renders CLEANLY. There is no console
      // error and no failed request to tolerate — which is precisely why only a route-level
      // assertion could have found it.
    },
  },

  /**
   * Found 2026-08-07. Affects the FULLY PERMITTED user, not just an under-privileged one —
   * which is what makes it a functional defect rather than an authorization curiosity.
   */
  POS_ORDERS_WEBSOCKET_REJECTED_AT_GATEWAY: {
    id: "E2E-D4",
    title: "The POS live-orders WebSocket is refused by the gateway for every user",
    impact:
      "POS real-time order sync NEVER connects. The terminal silently falls back to polling " +
      "and reconnects in a loop — measured: 4 failed handshakes in the first 10 seconds of a " +
      "single /app/pos load, each emitting a browser console error. Reproduced with " +
      "saffron.cashier (an OPEN till, all 14 POS permissions) as well as saffron.kitchen, so " +
      "it is NOT permission-dependent. The user-visible symptom is the POS status indicator " +
      "sitting at 'Polling — reconnecting' forever, and orders taken on one terminal not " +
      "appearing on another until the next poll.",
    evidence:
      "gateway/.../filter/JwtGlobalFilter.java:112-118 defines WS_UPGRADE_PATHS = " +
      "['/api/v1/reporting/dashboard/', '/api/v1/kitchen/'] — the ONLY prefixes for which the " +
      "gateway will read the JWT from the `?token=` query parameter. The POS socket is at " +
      "/api/v1/pos/ws/orders/{branchId}, which is not in that list, so the upgrade falls " +
      "through to the Authorization-header branch at L157-160. A browser's native WebSocket " +
      "API cannot set that header — which is precisely why the query-param fallback exists — " +
      "so the handshake is refused 401 and Chromium reports 'HTTP Authentication failed; no " +
      "valid credentials available'. The FRONTEND is correct: it does append ?token=. " +
      "Remedy: add '/api/v1/pos/ws/' to WS_UPGRADE_PATHS. NOTE: the prior harness author " +
      "observed the symptom (auth.fixture.ts#prepareForPos: 'degrades to Polling — " +
      "reconnecting and never settles') and worked around it without diagnosing the cause.",
    declare: (obs) =>
      obs
        .expectConsoleError(
          /WebSocket connection to '.*\/api\/v1\/pos\/ws\/orders\/.*' failed/i,
          "E2E-D4: the gateway will not read ?token= for the POS WS prefix",
        )
        .expectNetworkFailure({
          url: /\/api\/v1\/pos\/ws\/orders\//,
          because: "E2E-D4: the refused WS upgrade, surfaced as a 401/403 on the handshake",
        }),
  },

  /**
   * Found 2026-08-07 while writing this suite's own CLEANUP path — which is exactly the kind
   * of place an opaque error costs the most time.
   */
  LIFECYCLE_PRECONDITION_RETURNS_500: {
    id: "E2E-D5",
    title: "A tenant-lifecycle precondition violation returns 500, not 409",
    impact:
      "Calling DELETE /api/v1/platform/tenants/{id} on a tenant that is not CANCELLED " +
      "returns `500 INTERNAL_ERROR` with the message 'An unexpected error occurred'. The " +
      "precondition is CORRECT — cancel must precede purge — but the caller is told nothing " +
      "about it. A client cannot distinguish 'you called these in the wrong order' from 'the " +
      "server is broken', so the only way to learn the required sequence is to read the " +
      "service source. It also means a real 500 in this endpoint is indistinguishable from " +
      "routine misuse in logs and alerting.",
    evidence:
      "Measured live 2026-08-07 against the running gateway. DELETE on an ACTIVE tenant -> " +
      "500 {'code':'INTERNAL_ERROR'}; POST .../cancel -> 200; DELETE -> 204; DELETE again " +
      "(now PURGED) -> 500 again. TenantLifecycleService.purge (L86-93) calls requireStatus, " +
      "which throws IllegalStateException (L102-108). The shared GlobalExceptionHandler maps " +
      "IllegalArgumentException to 400 (proved by UNKNOWN_ROLE_CODE returning 400) but has no " +
      "mapping for IllegalStateException, so it falls through to the catch-all 500. Remedy: " +
      "map IllegalStateException to 409 CONFLICT with a code such as INVALID_LIFECYCLE_STATE " +
      "and put the required status in the message.",
    declare: () => {},
  },

  /**
   * Found 2026-08-07. Arguably the most consequential finding in this suite: it blocks the
   * FIRST action every new user of the product must take.
   */
  NO_FORCED_PASSWORD_CHANGE_UI: {
    id: "E2E-D6",
    title: "A newly provisioned user cannot complete its first sign-in in the browser",
    impact:
      "Every user created by a tenant admin — and every owner created by tenant provisioning " +
      "— is issued a TEMPORARY password with must_change_password set. The server correctly " +
      "refuses their first login with 403 PASSWORD_CHANGE_REQUIRED and issues a single-use " +
      "changeToken so a client can complete the change. NOTHING IN THE FRONTEND CONSUMES IT. " +
      "The login form has no branch for that error, so it falls through to the generic " +
      "handler and shows 'Something went wrong. Please try again.' There is no " +
      "change-password route, page or component anywhere in the app. The user is stuck in a " +
      "loop with a message that misdescribes the problem, and the ONLY way to onboard anyone " +
      "is to call the API by hand — which is exactly what scripts/seed_restaurantos.py does, " +
      "and why this has stayed invisible: the seed proves the API works, and the API does.",
    evidence:
      "components/auth/login-form.tsx:94-132 handles isTotpRequired, " +
      "isTotpEnrollmentRequired, isAccountLocked and isUnauthenticated, then falls through to " +
      "`setFormError(error.message || 'Something went wrong. Please try again.')`. A " +
      "repository-wide search for PASSWORD_CHANGE_REQUIRED or 'change-password' outside e2e/ " +
      "returns ZERO frontend matches, and `find app -ipath '*password*'` returns nothing. " +
      "Measured live: a user created through POST /api/v1/users, signing in with its returned " +
      "tempPassword, is refused 403 PASSWORD_CHANGE_REQUIRED with details " +
      "[{field:'changeToken',issue:'<tenantId>.<opaque>'},{field:'expiresAt',issue:...}] and " +
      "the browser never offers a new-password field. Remedy: branch on the 403 in the login " +
      "form, carry the changeToken into a /change-password screen, and POST it to the " +
      "existing /api/v1/auth/change-password/forced endpoint — which already works.",
    declare: (obs) =>
      obs.expectNetworkFailure({
        url: "/api/v1/auth/login",
        status: 403,
        because: "E2E-D6: the forced-change refusal the UI cannot act on",
      }),
  },

  /**
   * Not a runtime failure — a missing page behind a live nav entry.
   */
  PLATFORM_TENANTS_PAGE_MISSING: {
    id: "E2E-D3",
    title: "The SuperAdmin tenant-management UI does not exist",
    impact:
      "`platformNavItems` offers 'Tenants' → /platform/tenants, but no page implements that " +
      "route, so the only navigation the SuperAdmin area exposes is a dead link. There is no " +
      "UI at any URL for creating a tenant, changing its tier, or toggling a module — the " +
      "three operations the platform admin exists to perform. They are reachable ONLY over " +
      "the API.",
    evidence:
      "frontend/app/(platform)/ contains exactly two files: layout.tsx and " +
      "platform/dashboard/page.tsx (a nine-line placeholder). No platform/tenants/page.tsx " +
      "exists. components/shared/sidebar-nav-items.ts:platformNavItems nonetheless lists " +
      "{ label: 'Tenants', href: '/platform/tenants' }. Consequence for this suite: the " +
      "SuperAdmin journey drives the control plane through the real gateway API and asserts " +
      "the BROWSER-VISIBLE consequence for the affected tenant's user, because there is no " +
      "SuperAdmin UI to drive.",
    declare: () => {},
  },
} as const satisfies Record<string, KnownDefect>;

/** Declare a known defect's expected failures on this test's guard. */
export function tolerate(obs: Observability, ...defects: KnownDefect[]): void {
  for (const d of defects) d.declare(obs);
}
