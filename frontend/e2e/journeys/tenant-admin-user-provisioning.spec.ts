import { expect, test } from "../fixtures/auth.fixture";
import { apiLogin, jwtClaims } from "../fixtures/gateway";
import { persona, storageStatePath } from "../fixtures/personas";
import { e2eEmail, e2ePassword, runId } from "../fixtures/isolation";
import { readFileSync } from "node:fs";

/**
 * JOURNEY — a tenant admin creates a user, assigns it a role, and that user signs in and
 * sees ONLY its permitted navigation.
 *
 * WHY THE CREATION HALF IS API-DRIVEN. The OWNER drives the real public API that a UI would
 * call, and the assertion that matters — the new user signing in and seeing a correctly-scoped
 * app — happens in a browser.
 *
 * <p>THAT JUSTIFICATION HAS EXPIRED AND IS LEFT NAMED RATHER THAN QUIETLY DROPPED. This
 * docblock used to read "There is no user-management UI: the 'Users' nav entry
 * (/app/settings/users) is marked `comingSoon` and no page implements it." Plan 19-01 built
 * `app/(tenant)/app/users/page.tsx`, moved the nav entry off the never-built href to
 * `/app/users`, and removed `comingSoon` (`sidebar-nav-items.ts:553-563`) — measured live
 * 2026-08-22, an OWNER's sidebar renders "Users". So a UI-driven creation half is now possible
 * and would be a stronger journey. Converting it is a separate change: the API half also
 * asserts the 400 UNKNOWN_ROLE_CODE refusal and reads the temp password out of the response
 * body, and neither has a UI equivalent yet.
 *
 * ISOLATION. Emails carry a per-run id, so re-running never collides and a failed run leaves
 * an identifiable orphan rather than blocking the next run. Users are deliberately NOT
 * deleted: there is no user-delete endpoint, and inventing a direct DB write to clean up
 * would be a worse violation than leaving a row behind.
 */

test.describe.configure({ mode: "serial" });

const OWNER = persona("terrace", "owner");
const NEW_USER_ROLE = "WAITER";

interface Created {
  userId: string;
  email: string;
  tempPassword: string;
  slug: string;
}

/** The branch the OWNER's own session is scoped to — read from its minted storage state. */
function ownerBranchId(): string {
  const state = JSON.parse(readFileSync(storageStatePath(OWNER.id), "utf8")) as {
    __meta?: { branchId?: string };
  };
  const id = state.__meta?.branchId;
  expect(id, "the owner storage state carries no branch_id claim — re-run auth-setup").toBeTruthy();
  return id!;
}

test.describe("tenant admin provisions a user", () => {
  let created: Created;

  test("OWNER creates a user and assigns it a role", async ({ gateway, token, tenants }) => {
    const slug = tenants[OWNER.tenantKey]!.slug;
    const auth = { Authorization: `Bearer ${await token(OWNER)}` };

    // The role catalog is READ, not assumed. A roleCode that persists but resolves to nothing
    // produces a login with an empty permission list — the silent failure Phase 13's B3 was
    // about, and one that only shows up as "the app is empty" much later.
    const roles = await gateway.get("/api/v1/roles", { headers: auth });
    expect(roles.status(), "the role catalog must be readable by a tenant admin").toBe(200);
    const codes = ((await roles.json()).data as Array<{ code: string }>).map((r) => r.code);
    expect(
      codes,
      `the role catalog does not offer ${NEW_USER_ROLE}. Assigning it would create a user ` +
        "whose token carries no permissions at all.",
    ).toContain(NEW_USER_ROLE);

    const email = e2eEmail("waiter");
    const res = await gateway.post("/api/v1/users", {
      headers: auth,
      data: {
        email,
        fullName: `E2E Waiter ${runId()}`,
        locale: "en",
        branchId: ownerBranchId(),
        roleCode: NEW_USER_ROLE,
      },
      failOnStatusCode: false,
    });
    expect(
      res.status(),
      `creating ${email} returned ${res.status()}: ${(await res.text()).slice(0, 300)}`,
    ).toBe(201);

    const body = (await res.json()) as {
      data: { id?: string; userId?: string; tempPassword?: string };
    };
    const userId = body.data.id ?? body.data.userId ?? "";
    expect(userId, "user creation must return the new user's id").toBeTruthy();
    expect(
      body.data.tempPassword,
      "creation must hand back a one-time temporary password — it is the only way the new " +
        "user can ever sign in, since self-service reset ships disabled (13-09 / D-31)",
    ).toBeTruthy();

    created = { userId, email, tempPassword: body.data.tempPassword!, slug };

    // An unknown role must be REFUSED, not silently accepted. Without this the positive
    // case above could pass against an endpoint that ignores roleCode entirely.
    const bogus = await gateway.post("/api/v1/users", {
      headers: auth,
      data: {
        email: e2eEmail("bogus"),
        fullName: "E2E Bogus",
        locale: "en",
        branchId: ownerBranchId(),
        roleCode: "NOT_A_REAL_ROLE",
      },
      failOnStatusCode: false,
    });
    expect(
      bogus.status(),
      "an unknown roleCode must be refused 400 UNKNOWN_ROLE_CODE with nothing written",
    ).toBe(400);
  });

  /**
   * THE FORCED PASSWORD CHANGE, at the API boundary.
   *
   * Asserted here separately from the browser attempt below, because the two answer different
   * questions: this one proves the SERVER demands the change (it does, correctly); the next
   * proves whether a USER can satisfy that demand in the product (they cannot).
   */
  test("the new user's first login is refused PASSWORD_CHANGE_REQUIRED", async ({ gateway }) => {
    expect(created, "the creation test must run first (serial mode)").toBeTruthy();

    const first = await apiLogin(gateway, {
      email: created.email,
      password: created.tempPassword,
      tenantSlug: created.slug,
    });

    expect(
      first.status,
      `a freshly created user must be forced to change its password, got ${first.status} ` +
        `${first.errorCode ?? ""}`,
    ).toBe(403);
    expect(first.errorCode).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(
      first.accessToken,
      "a refused first login must NOT hand back a usable access token",
    ).toBeNull();
  });

  /**
   * THE BROWSER HALF — and the one that finds the gap.
   *
   * `test.fail()` records that this currently does NOT work. See E2E-D6: the login form has
   * no branch for PASSWORD_CHANGE_REQUIRED and the app has no change-password screen, so a
   * newly provisioned user cannot complete a first sign-in through the UI at all.
   */
  test("a new user can complete the forced password change in the browser", async ({
    page,
    obs,
  }) => {
    test.fail(
      true,
      "E2E-D6: the login form has no PASSWORD_CHANGE_REQUIRED branch and no " +
        "change-password screen exists. When this starts passing, delete this marker.",
    );
    obs.expectNetworkFailure({
      url: "/api/v1/auth/login",
      status: 403,
      because: "the forced-change refusal is the mechanism under test",
    });

    await page.goto(`/login?tenant=${encodeURIComponent(created.slug)}`);
    await page.getByLabel("Email").fill(created.email);
    await page.getByLabel("Password").fill(created.tempPassword);
    await page.getByRole("button", { name: "Sign in" }).click();

    // What SHOULD happen: the user is taken somewhere they can set a new password.
    const newPassword = page.getByLabel(/new password/i);
    await expect(
      newPassword,
      "after 403 PASSWORD_CHANGE_REQUIRED the product must offer a way to set a new " +
        "password. The server issues a single-use changeToken in error.details[] for exactly " +
        "this purpose (POST /api/v1/auth/change-password/forced), and nothing in the frontend " +
        "consumes it.",
    ).toBeVisible({ timeout: 15_000 });
  });

  /**
   * Complete the change over the API — the ONLY path that works today — so the rest of the
   * journey (the point of it: a real user, a real role, a real browser) can proceed.
   */
  test("after the change the user signs in and sees only WAITER navigation", async ({
    gateway,
    browser,
    obs,
  }) => {
    const newPassword = e2ePassword();

    // The changeToken is single-use and arrives in the refusal body.
    const refusal = await apiLogin(gateway, {
      email: created.email,
      password: created.tempPassword,
      tenantSlug: created.slug,
    });
    expect(refusal.status).toBe(403);
    // The refusal body's `details` is a list of {field, issue} pairs — the changeToken is the
    // `issue` of the entry whose `field` is "changeToken", alongside an `expiresAt` entry.
    // Measured shape, 2026-08-07:
    //   [{"field":"changeToken","issue":"<tenantId>.<opaque>"},
    //    {"field":"expiresAt","issue":"2026-08-07T02:13:14.936271Z"}]
    const details = ((refusal.raw as { error?: { details?: unknown[] } }).error?.details ??
      []) as Array<{ field?: string; issue?: string }>;
    const changeToken = details.find((d) => d.field === "changeToken")?.issue ?? null;
    expect(
      changeToken,
      `the 403 must carry a single-use changeToken in error.details[]; got ${JSON.stringify(details).slice(0, 200)}`,
    ).toBeTruthy();

    // Exact shape from scripts/seed_restaurantos.py#forced_change (L588-591). The token
    // already identifies the tenant and the user, so no email/slug is sent; `currentPassword`
    // is mandatory and A WRONG ONE SPENDS THE TOKEN (13-08), which is why it is the password
    // the API itself just handed back rather than anything reconstructed.
    const changed = await gateway.post("/api/v1/auth/change-password/forced", {
      data: {
        changeToken,
        currentPassword: created.tempPassword,
        newPassword,
      },
      failOnStatusCode: false,
    });
    expect(changed.status(), `forced change failed: ${(await changed.text()).slice(0, 300)}`).toBe(
      200,
    );

    // ── the real login, with the real new password ────────────────────────────────────
    const login = await apiLogin(gateway, {
      email: created.email,
      password: newPassword,
      tenantSlug: created.slug,
    });
    expect(login.status, `login after change: ${JSON.stringify(login.raw).slice(0, 200)}`).toBe(
      200,
    );

    const claims = jwtClaims(login.accessToken!);
    expect(claims.roles, "the assigned role must be the one the token carries").toContain(
      NEW_USER_ROLE,
    );
    const permissions = claims.permissions as string[];
    expect(
      permissions.length,
      "a role that resolves to zero permissions is the silent failure this asserts against",
    ).toBeGreaterThan(0);
    expect(permissions).toContain("pos.order.create");
    expect(
      permissions.filter((p) => p.startsWith("pos.till.")),
      "a WAITER must hold NO till permission — that is D-30's whole point",
    ).toEqual([]);

    // ── and now the BROWSER: this user sees a WAITER's app, not everyone's ────────────
    const ctx = await browser.newContext();
    const state = await gateway.storageState();
    const refreshCookie = state.cookies.find((c) => c.name === "refresh_token");
    expect(
      refreshCookie,
      "the login above returned 200 but set no refresh_token cookie — nothing can rehydrate " +
        "a session from it, and the browser half of this journey would fail 25s later and far " +
        "from the cause.",
    ).toBeTruthy();
    await ctx.addCookies([{ ...refreshCookie!, sameSite: "Strict" as const }]);

    // DOMAIN AND SECURE ARE DERIVED FROM THE REFRESH COOKIE, NOT HARDCODED.
    //
    // They were `domain: "localhost", secure: false`. Against dev.restaurantos.softxlogic.com
    // the browser therefore never sent this marker, `proxy.ts` treated the request as signed
    // out and bounced it to /login, and the assertion below timed out for 25s against a login
    // form — reported as "a newly provisioned WAITER cannot see POS", which is a permissions
    // sentence about a cookie-scoping bug. The error-context snapshot for the failing run is
    // the login page, not the app shell.
    //
    // This is the SAME defect commit 1dbfae3f fixed in `e2e/setup/auth.setup.ts` (where it cost
    // 59 failures that all looked like product defects and were one wrong string); that fix did
    // not reach this spec, which mints its own context rather than using a minted storage
    // state. The remedy is identical and is copied deliberately: the refresh cookie is issued
    // by the server for the host actually under test, so its own `domain` is correct by
    // construction, and on HTTPS a `SameSite=Strict` cookie must also be `secure` or the
    // browser drops it.
    await ctx.addCookies([
      {
        name: "has_session",
        value: "1",
        domain: refreshCookie!.domain,
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 3600,
        httpOnly: false,
        secure: refreshCookie!.secure,
        sameSite: "Strict" as const,
      },
    ]);
    const page = await ctx.newPage();
    obs.watch(page);

    await page.goto("/app/dashboard");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "POS", exact: true })).toBeVisible({
      timeout: 25_000,
    });

    // A WAITER's sidebar: Dashboard, POS, Kitchen Display — and nothing else.
    for (const forbidden of [
      "Till Review",
      "Accounts",
      "Purchasing",
      "Reports",
      "HR",
      "Customers",
    ]) {
      await expect(
        nav.getByRole("link", { name: forbidden, exact: true }),
        `a newly provisioned WAITER can see "${forbidden}". The role assignment did not scope ` +
          "the app.",
      ).toHaveCount(0);
    }

    await ctx.close();
  });
});
