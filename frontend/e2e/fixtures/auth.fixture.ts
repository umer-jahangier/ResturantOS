import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { readFileSync } from "node:fs";

import {
  TENANT_MANIFEST_PATH,
  storageStatePath,
  type Persona,
  type TenantManifest,
} from "./personas";
import { GATEWAY_URL, newGatewayContext, tokenViaRefresh, workerIp } from "./gateway";
import { loadTotpSecret, TOTP_SECRET_DIR, totpStable } from "./totp";
import { Observability, settle } from "./observability";

/**
 * The fixture every journey spec imports instead of `@playwright/test`.
 *
 * Provides three things and nothing else:
 *   `tenants`  — the slug/tenantId manifest the auth-setup project resolved from the live
 *                platform API. Specs never hard-code a slug.
 *   `as`       — a browser page already signed in as a persona, by REPLAYING the storage
 *                state the setup project minted. Cheap: no login request is issued.
 *   `gateway`  — an APIRequestContext pointed at Spring Cloud Gateway, for the assertions
 *                that must be made at the API boundary (e.g. FEATURE_DISABLED) rather than
 *                inferred from what the UI chose to render.
 *
 * `as` is deliberately NOT the only way in. Anything that needs a `totp_verified` access
 * token must use {@link uiLoginWithTotp}, because a replayed session cannot have one — see
 * the note on that function.
 */

/**
 * Give this worker's BROWSER traffic its own gateway rate-limit bucket.
 *
 * Why a route handler and not `extraHTTPHeaders`: the gateway answers a CORS preflight with
 * `Access-Control-Allow-Headers: content-type, x-request-id` — an allowlist that does not
 * include x-forwarded-for — so a context-level header makes Chromium block EVERY cross-origin
 * call to :8080. Measured 2026-08-07: it took the suite from 5 failures to 23. A route handler
 * adds the header after the browser has already made its CORS decision, so no preflight is
 * triggered for it.
 *
 * Why it is needed at all, with the arithmetic:
 *   /api/v1/auth/** is the CREDENTIAL bucket — replenish 2/s, burst RATE_LIMIT_AUTH_PER_MIN
 *   (100), keyed per source IP (gateway application.yml:80-84, RateLimitConfig.java:41-54).
 *   Every full page load spends TWO tokens from it: SessionProvider's POST /auth/refresh, and
 *   useTenantBrand's GET /api/v1/auth/tenants/<slug>. A 30-test suite at ~2 navigations each
 *   is ~120 tokens — more than the entire burst, before a second run starts.
 *
 * This works because the harness reaches the gateway DIRECTLY. Behind deploy/nginx/nginx.conf
 * (`proxy_set_header X-Forwarded-For $remote_addr`, line 68 — a replace) the spoof is
 * overwritten, correctly. For staging, set E2E_WORKER_IP=0 and raise RATE_LIMIT_AUTH_PER_MIN
 * on that environment instead.
 */
async function isolateGatewayBucket(ctx: BrowserContext): Promise<void> {
  const ip = workerIp();
  if (!ip) return;
  await ctx.route(`${GATEWAY_URL}/**`, async (route) => {
    await route.continue({
      headers: { ...route.request().headers(), "x-forwarded-for": ip },
    });
  });
}

interface AuthFixtures {
  tenants: TenantManifest["tenants"];
  as: (p: Persona) => Promise<Page>;
  gateway: APIRequestContext;
  /** A bearer token for a persona, obtained by refreshing its minted session — never by logging in. */
  token: (p: Persona) => Promise<string>;
  /**
   * The console-error / failed-request guard. Attached to EVERY page the test opens — the
   * default `page` and every page from `as()` — and asserted clean at teardown.
   *
   * A spec that expects a failure declares it: `obs.expect403(url, 'why')`.
   */
  obs: Observability;
  /** Set false in a spec that must opt out entirely. Prefer declaring the failure instead. */
  guardConsole: boolean;
}

export const test = base.extend<AuthFixtures>({
  guardConsole: [true, { option: true }],

  /**
   * AUTO fixture: runs for every test whether or not the body mentions it, so a new spec
   * cannot forget the guard. Assertion happens in teardown, AFTER the test body, so a
   * failure is reported with everything the test provoked.
   */
  obs: [
    async ({ guardConsole }, use, testInfo) => {
      const o = new Observability();
      await use(o);

      if (!guardConsole) return;
      // Only judge a test that PASSED its own assertions: piling a console report on top of
      // an already-failing test buries the real cause.
      if (testInfo.status !== testInfo.expectedStatus) return;

      await settle();
      const report = o.report();
      if (report) {
        throw new Error(
          `Browser reported errors during "${testInfo.title}".\n\n${report}\n` +
            "This is a UI/network defect surfaced by the observability guard, not a flake.",
        );
      }
    },
    { auto: true },
  ],

  tenants: async ({}, use) => {
    let manifest: TenantManifest;
    try {
      manifest = JSON.parse(readFileSync(TENANT_MANIFEST_PATH, "utf8")) as TenantManifest;
    } catch {
      throw new Error(
        `No tenant manifest at ${TENANT_MANIFEST_PATH}. It is produced by the ` +
          "`auth-setup` project — run the journeys project (which depends on it) rather than " +
          "a bare `--grep`, or run `pnpm e2e:journeys` which wires the dependency.",
      );
    }
    await use(manifest.tenants);
  },

  as: async ({ browser, obs }, use) => {
    const opened: BrowserContext[] = [];

    await use(async (p: Persona) => {
      const ctx = await browser.newContext({ storageState: storageStatePath(p.id) });
      await isolateGatewayBucket(ctx);
      // Applied to EVERY context, not just POS ones. It is harmless where there is no
      // service worker, and where there is one it is the difference between a test and a
      // 90-second hang — see prepareForPos. Making it conditional means every new POS spec
      // has to remember, and one that forgets fails in a way that looks like a timeout.
      await prepareForPos(ctx);
      opened.push(ctx);
      const page = await ctx.newPage();
      obs.watch(page);
      return page;
    });

    for (const ctx of opened) await ctx.close();
  },

  /**
   * The default `page`/`context` (used by the form-login specs) gets the same treatment.
   * Overriding `context` rather than `page` keeps Playwright's own page lifecycle intact.
   *
   * `obs.watch` is bound to `context.on("page")` so popups and any page the test opens
   * itself are covered too — not just the first one.
   */
  context: async ({ context, obs }, use) => {
    await isolateGatewayBucket(context);
    await prepareForPos(context);
    context.on("page", (p) => obs.watch(p));
    await use(context);
  },

  gateway: async ({}, use) => {
    const ctx = await newGatewayContext();
    await use(ctx);
    await ctx.dispose();
  },

  /**
   * Prefer this over apiLoginPersona inside a spec. Two specs that each log in as the same
   * persona will run in different workers and race the user row — see the note on
   * tokenViaRefresh. Cached per test so repeated calls cost one refresh, not N.
   */
  token: async ({}, use) => {
    const cache = new Map<string, Promise<string>>();
    await use((p: Persona) => {
      const hit = cache.get(p.id);
      if (hit) return hit;
      const pending = tokenViaRefresh(storageStatePath(p.id));
      cache.set(p.id, pending);
      return pending;
    });
  },
});

export { expect };

/**
 * Sign in through the actual login form, supplying a live TOTP code.
 *
 * THIS IS NOT AN OPTIMISATION TARGET. A replayed storage state can never produce a
 * `totp_verified` access token: `AuthServiceImpl.refresh` mints that claim false on every
 * refresh, deliberately (services/auth-service/.../AuthServiceImpl.java:160-168), and the
 * only thing a storage state can do is refresh. Every journey whose final action is
 * step-up-gated — accounting-period close, payroll approval — has to come through here.
 *
 * The two-submit shape is the product's, not the test's: the form has no TOTP field until
 * the server has refused once with TOTP_REQUIRED, at which point `onError` reveals it
 * (frontend/components/auth/login-form.tsx:95-101).
 *
 * `?tenant=` is always passed explicitly. NEXT_PUBLIC_DEFAULT_TENANT_SLUG is set in
 * frontend/.env.local, and proxy.ts rewrites a bare /login to that tenant and hides the
 * restaurant field (frontend/proxy.ts:35-43) — a multi-tenant suite that relied on the
 * default would silently test one tenant three times.
 */
export async function uiLoginWithTotp(page: Page, p: Persona, tenantSlug: string): Promise<void> {
  const secret = loadTotpSecret(p.email);
  expect(
    secret,
    `${p.email} is TOTP-enrolled but no secret exists in ${TOTP_SECRET_DIR}. auth-service ` +
      "mints it at enrolment and it cannot be re-derived — re-run " +
      "`python3 scripts/seed_restaurantos.py --phase personas --repair`.",
  ).not.toBeNull();

  await page.goto(`/login?tenant=${encodeURIComponent(tenantSlug)}`);
  await page.getByLabel("Email").fill(p.email);
  await page.getByLabel("Password").fill(p.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // "Authenticator OR RECOVERY code" — the label the form has carried since recovery codes were
  // added (`components/auth/login-form.tsx:704`, identical in origin/main). `getByLabel` matches
  // a SUBSTRING, and "Authenticator code" is not a substring of that, so the old locator could
  // never match on any build and this helper spent 15s failing against a form that was correct.
  // Same defect, same fix, as step-up-totp.spec.ts.
  const totpField = page.getByLabel("Authenticator or recovery code");
  await expect(
    totpField,
    "the server should have refused with TOTP_REQUIRED and the form should have revealed " +
      "the authenticator field",
  ).toBeVisible({ timeout: 15_000 });

  await totpField.fill(await totpStable(secret!));
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app\//, { timeout: 20_000 });
}

/** Sign in through the form for a persona with no second factor. */
export async function uiLogin(page: Page, p: Persona, tenantSlug: string): Promise<void> {
  await page.goto(`/login?tenant=${encodeURIComponent(tenantSlug)}`);
  await page.getByLabel("Email").fill(p.email);
  await page.getByLabel("Password").fill(p.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app\//, { timeout: 20_000 });
}

/**
 * Prepare a context for the POS/KDS routes. MEASURED 2026-08-07 — without this, a
 * `page.goto("/app/pos")` never fires `load` and `context.close()` hangs the test out to its
 * timeout (90s in the probe that found it), because /app/pos registers a service worker
 * (app/(tenant)/app/pos/layout.tsx) and holds a live socket that degrades to "Polling —
 * reconnecting" and never settles.
 *
 * Two things are therefore mandatory for any POS or KDS journey:
 *   1. call this BEFORE the first navigation, and
 *   2. navigate with `{ waitUntil: "domcontentloaded" }`, never the default `load`.
 *
 * The pre-existing e2e/pos-settlement.spec.ts arrived at the same workaround independently
 * (its own addInitScript, lines 60-80) — this is the shared version of it.
 */
export async function prepareForPos(ctx: BrowserContext): Promise<void> {
  await ctx.addInitScript(() => {
    try {
      if ("serviceWorker" in navigator) {
        Object.defineProperty(navigator.serviceWorker, "register", {
          configurable: true,
          writable: true,
          value: () => Promise.reject(new Error("[e2e] SW registration disabled")),
        });
      }
    } catch {
      /* best effort */
    }
  });
}
