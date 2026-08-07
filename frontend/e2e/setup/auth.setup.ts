import { expect, test as setup } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  ALL_PERSONAS,
  AUTH_DIR,
  SUPERADMIN,
  TENANTS,
  TENANT_KEYS,
  TENANT_MANIFEST_PATH,
  storageStatePath,
  type TenantManifest,
} from "../fixtures/personas";
import {
  apiLoginPersona,
  apiPlatformLogin,
  jwtClaims,
  newGatewayContext,
} from "../fixtures/gateway";

/**
 * Setup gets a rate-limit bucket of its own, distinct from any journeys worker's.
 * Nineteen logins would otherwise leave worker 0 inheriting a drained budget the moment the
 * journeys project starts — a failure that would land on whichever test happened to run first
 * and look like a flake instead of a budget.
 */
const SETUP_HEADERS = { "X-Forwarded-For": "10.63.200.1" };

/**
 * The `auth-setup` project: resolve tenant slugs, then mint one reusable storage state per
 * seeded persona by logging in THROUGH THE REAL GATEWAY.
 *
 * WHY STORAGE STATE WORKS HERE, precisely
 * =======================================
 * The access token is memory-only and is never written to a cookie or to localStorage
 * (frontend/lib/auth/session.ts:5-8). So there is nothing token-shaped to snapshot. What a
 * browser actually needs to come back as a signed-in user is exactly two cookies:
 *
 *   refresh_token   HttpOnly, SameSite=Strict, Path=/api/v1/auth, 30-day TTL
 *                   (services/auth-service/.../AuthController.java:84-90)
 *   has_session     non-HttpOnly UX marker, Path=/, written by setSession()
 *                   (frontend/lib/auth/session.ts:13-20)
 *
 * On load, SessionProvider sees `has_session`, calls POST /api/v1/auth/refresh with the
 * HttpOnly cookie, and rehydrates (components/providers/session-provider.tsx:44-70). So a
 * storage state carrying those two cookies IS a logged-in browser.
 *
 * The refresh_token cookie is set by the GATEWAY origin (:8080) while the app is served from
 * :3000. Cookies ignore port, so one `localhost` jar serves both, and SameSite=Strict is
 * satisfied because :3000 and :8080 are the same *site*.
 *
 * REUSE IS SAFE ACROSS PARALLEL WORKERS. `AuthServiceImpl.refresh` (L153-176) validates the
 * session and mints a new access token; it does NOT rotate or revoke the refresh token, so N
 * workers replaying the same state cannot trip reuse detection. Verified by reading that
 * method, not assumed.
 *
 * WHAT STORAGE STATE CANNOT CARRY: `totp_verified`. AuthServiceImpl.refresh mints it FALSE on
 * purpose (L160-168) — an hour-grade proof of possession must not ride a 30-day credential.
 * Any journey that ends in a step-up-gated action (accounting-period close, payroll approval)
 * therefore MUST drive the login form with a live code; see e2e/journeys/step-up-totp.spec.ts.
 */

setup.describe.configure({ mode: "serial" });

setup("resolve tenant slugs from the platform API", async () => {
  const ctx = await newGatewayContext(SETUP_HEADERS);

  const login = await apiPlatformLogin(ctx, {
    email: SUPERADMIN.email,
    password: SUPERADMIN.password,
  });
  expect(
    login.status,
    `SuperAdmin ${SUPERADMIN.email} could not authenticate at the gateway ` +
      `(${login.status} ${login.errorCode ?? ""}). This account is created by ` +
      "services/platform-admin-service/.../901-seed-project-superadmin.xml — if this fails the " +
      "migration has not run, not the test.",
  ).toBe(200);

  const claims = jwtClaims(login.accessToken!);
  expect(claims.roles, "the platform token must carry SUPER_ADMIN").toContain("SUPER_ADMIN");

  const res = await ctx.get("/api/v1/platform/tenants?page=0&size=200", {
    headers: { Authorization: `Bearer ${login.accessToken}` },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { data: Array<Record<string, string>> };

  const manifest: TenantManifest = { generatedAt: new Date().toISOString(), tenants: {} };
  const missing: string[] = [];

  for (const key of TENANT_KEYS) {
    const spec = TENANTS[key];
    const row = body.data.find((t) => t.brandName === spec.brand);
    if (!row) {
      missing.push(`${spec.brand} (${key})`);
      continue;
    }
    manifest.tenants[key] = {
      slug: row.slug ?? "",
      tenantId: row.id ?? "",
      tier: row.tier ?? "",
    };
  }

  expect(
    missing,
    "seeded tenants are absent from the platform API. Run: python3 scripts/seed_restaurantos.py",
  ).toEqual([]);

  mkdirSync(dirname(TENANT_MANIFEST_PATH), { recursive: true });
  writeFileSync(TENANT_MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  await ctx.dispose();
});

setup("mint a storage state for every seeded persona", async () => {
  const manifest = (await import("node:fs")).readFileSync(TENANT_MANIFEST_PATH, "utf8");
  const tenants = (JSON.parse(manifest) as TenantManifest).tenants;

  const failures: string[] = [];

  for (const p of ALL_PERSONAS) {
    const slug = tenants[p.tenantKey]?.slug;
    if (!slug) {
      failures.push(`${p.email}: no slug resolved for tenant ${p.tenantKey}`);
      continue;
    }

    // A fresh jar per persona: one shared jar would let the last login's refresh_token
    // overwrite the previous persona's, and every storage state would be the same user.
    const ctx = await newGatewayContext(SETUP_HEADERS);
    const outcome = await apiLoginPersona(ctx, p, slug);

    if (outcome.status !== 200 || !outcome.accessToken) {
      failures.push(
        `${p.email} (${p.role}, ${slug}): ${outcome.status} ${outcome.errorCode ?? ""} ` +
          `${JSON.stringify(outcome.raw).slice(0, 200)}`,
      );
      await ctx.dispose();
      continue;
    }

    const claims = jwtClaims(outcome.accessToken);
    const state = await ctx.storageState();

    const refresh = state.cookies.find((c) => c.name === "refresh_token");
    if (!refresh) {
      failures.push(
        `${p.email}: login returned 200 but set no refresh_token cookie — a storage state ` +
          "without it cannot rehydrate, and the journey would fail later and further away.",
      );
      await ctx.dispose();
      continue;
    }

    // The UX marker SessionProvider gates its bootstrap on. It is written by client JS in a
    // real browser, so it is absent from an APIRequestContext jar and has to be added here.
    state.cookies.push({
      name: "has_session",
      value: "1",
      domain: "localhost",
      path: "/",
      expires: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
      httpOnly: false,
      secure: false,
      sameSite: "Strict",
    });

    const file = storageStatePath(p.id);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify(
        {
          ...state,
          // Not read by Playwright; read by humans debugging a stale state.
          __meta: {
            persona: p.id,
            email: p.email,
            role: p.role,
            tenantSlug: slug,
            tenantId: claims.tenant_id,
            branchId: claims.branch_id,
            totpVerifiedAtLogin: claims.totp_verified,
            mintedAt: new Date().toISOString(),
          },
        },
        null,
        2,
      ),
    );
    await ctx.dispose();
  }

  expect(
    failures,
    "personas that could not authenticate through the real gateway. The seed script's own " +
      "verify phase asserts the same thing — run `python3 scripts/seed_restaurantos.py --phase verify` " +
      "to confirm whether this is a seed problem or a harness problem.",
  ).toEqual([]);
});

setup("mint a storage state for the SuperAdmin", async () => {
  const ctx = await newGatewayContext(SETUP_HEADERS);
  const login = await apiPlatformLogin(ctx, {
    email: SUPERADMIN.email,
    password: SUPERADMIN.password,
  });
  expect(login.status).toBe(200);

  // NOTE, and it is load-bearing: platform login returns a bearer token but — unlike the
  // tenant login — no refresh_token cookie was observed. The platform area of the UI
  // therefore cannot be entered by replaying cookies the way a tenant persona can. Until
  // that is confirmed either way, /platform/** journeys drive the login form. The state is
  // still written so the manifest is complete and the gap is visible rather than silent.
  const state = await ctx.storageState();
  const file = storageStatePath(SUPERADMIN.id);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify(
      {
        ...state,
        __meta: {
          persona: SUPERADMIN.id,
          email: SUPERADMIN.email,
          hasRefreshCookie: state.cookies.some((c) => c.name === "refresh_token"),
          mintedAt: new Date().toISOString(),
        },
      },
      null,
      2,
    ),
  );
  await ctx.dispose();
});

export { AUTH_DIR };
