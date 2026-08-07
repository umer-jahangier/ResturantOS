import {
  request as playwrightRequest,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

import { loadTotpSecret, TOTP_SECRET_DIR, totpStable } from "./totp";
import type { Persona } from "./personas";

/**
 * Talking to the REAL gateway from the test process.
 *
 * Everything here goes through http://localhost:8080 — Spring Cloud Gateway — not a mock and
 * not the Next.js server. That matters because the gateway is where three of the four things
 * this suite must not fake actually live: the JWT filter, the per-tenant FeatureFlagFilter,
 * and the rate limiter.
 */

export const GATEWAY_URL = (process.env.E2E_GATEWAY_URL ?? "http://localhost:8080").replace(
  /\/$/,
  "",
);

/* ─────────────────────────────────────────────────────────────────────────────
 * Rate-limit budget
 *
 * gateway/src/main/resources/application.yml:80-84 puts /api/v1/auth/** behind a
 * RequestRateLimiter with replenishRate=2/s, burstCapacity=RATE_LIMIT_AUTH_PER_MIN (100),
 * keyed on `#{@ipKeyResolver}` — i.e. per SOURCE IP, so every Playwright worker on one
 * machine (and every browser page that calls /auth/refresh on load) shares ONE bucket.
 *
 * Consequences that shape this file:
 *   · the bucket is shared, so pacing must be conservative, not per-worker;
 *   · a burst of 100 is generous but finite — 18 setup logins plus one /auth/refresh per
 *     page load per test adds up faster than it looks;
 *   · a 429 is a harness failure, not a product failure, so it is retried rather than
 *     surfaced as a test result. Anything that made a 429 look like a red test would
 *     teach the team to ignore red tests.
 * ───────────────────────────────────────────────────────────────────────────── */

const MIN_LOGIN_INTERVAL_MS = Number(process.env.E2E_LOGIN_INTERVAL_MS ?? 550);
let nextLoginAt = 0;

/* ─────────────────────────────────────────────────────────────────────────────
 * Per-worker rate-limit bucket
 *
 * MEASURED, not assumed (2026-08-07, local dev stack): 130 logins from one fixed
 * `X-Forwarded-For` produced a 429 at request 67; the very next request with a DIFFERENT
 * spoofed value returned 401 immediately. `RateLimitConfig.ipKeyResolver` (gateway/.../
 * config/RateLimitConfig.java:41-54) reads the header unconditionally and takes
 * `split(",")[0]` — there is no trusted-proxy check on that path — so the client picks its
 * own bucket.
 *
 * This is SAFE TO RELY ON HERE and only here, because the harness talks to the gateway
 * DIRECTLY on :8080. In a deployment the request arrives through deploy/nginx/nginx.conf,
 * which sets `X-Forwarded-For $remote_addr` (line 68) — a REPLACE, not an append — so the
 * spoof is overwritten before the gateway sees it. Against a staging URL that goes through
 * nginx, set E2E_WORKER_IP=0 and raise RATE_LIMIT_AUTH_PER_MIN on that environment instead.
 *
 * Why it is needed at all: /api/v1/auth/** carries the CREDENTIAL bucket (replenish 2/s,
 * burst 100) and `/api/v1/auth/refresh` is on it. SessionProvider calls refresh on EVERY
 * full page load, so N parallel workers × M navigations all spend one budget. Measured
 * without this: 4 workers, 5 of 30 journeys failed with `POST /api/v1/auth/refresh → 429`,
 * and the app treated the 429 as an expired session and redirected to /login.
 * ───────────────────────────────────────────────────────────────────────────── */

const USE_WORKER_IP = process.env.E2E_WORKER_IP !== "0";

/** A stable, private-range address unique to this Playwright worker. */
export function workerIp(): string | null {
  if (!USE_WORKER_IP) return null;
  const salt = Number(process.env.E2E_XFF_SALT ?? 0) % 250;
  const index = Number(process.env.TEST_PARALLEL_INDEX ?? process.env.TEST_WORKER_INDEX ?? 0);
  return `10.63.${salt}.${(index % 250) + 1}`;
}

/** Headers every gateway call from this worker should carry. */
export function workerHeaders(): Record<string, string> {
  const ip = workerIp();
  return ip ? { "X-Forwarded-For": ip } : {};
}

async function paceLogin(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextLoginAt - now);
  nextLoginAt = Math.max(now, nextLoginAt) + MIN_LOGIN_INTERVAL_MS;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

/**
 * Retry the two failure classes that are the HARNESS's problem, not the product's:
 *
 *   429 — the shared credential bucket, above. Backed off at the replenish rate.
 *   502 / 503 — a stale Eureka registration or an open circuit breaker. Observed live on
 *         2026-08-07: POST /api/v1/platform/auth/login returned 502 UPSTREAM_ERROR while the
 *         identical curl a second later returned 200, and platform-admin-service's log showed
 *         a prior instance's shutdown. On a Eureka + load-balanced stack a first call after a
 *         restart can reach a de-registering instance. Retrying is correct; asserting on the
 *         first attempt would make every service restart look like a product failure.
 *
 * Everything else is returned untouched — a 401 or a 403 IS the result under test.
 */
const TRANSIENT = new Set([429, 502, 503]);

/**
 * Plus one more, and ONLY on the login helpers below (never on a business endpoint, where a
 * 409 is a real result):
 *
 *   409 CONCURRENT_MODIFICATION — two logins for the SAME account overlapping. This is a
 *   product defect, recorded in .planning/research/adaptivity/browser-e2e.md: login writes
 *   failed_login_count / locked_until / last_login_at and saves a `@Version` entity, so the
 *   loser of the race is told "This record changed while you were editing it". Retrying is
 *   literally what that message asks for, and it is what a real client would have to do.
 *
 *   The workaround is deliberately narrow so it cannot mask the defect anywhere else, and the
 *   defect is asserted head-on nowhere in this suite — it is reported, not encoded.
 */
async function isRetryableConflict(res: APIResponse): Promise<boolean> {
  if (res.status() !== 409) return false;
  return (await res.text()).includes("CONCURRENT_MODIFICATION");
}

async function withTransientRetry(
  fn: () => Promise<APIResponse>,
  attempts = Number(process.env.E2E_TRANSIENT_ATTEMPTS ?? 6),
): Promise<APIResponse> {
  let last: APIResponse | null = null;
  for (let i = 0; i < attempts; i += 1) {
    last = await fn();
    if (!TRANSIENT.has(last.status()) && !(await isRetryableConflict(last))) return last;
    // Linear, not exponential: a 429 clears at 2 tokens/second, and a de-registering Eureka
    // instance clears on the next 30s heartbeat — both want steady re-probing, not a long
    // sleep. Six attempts ≈ 21s total, which covers both without hiding a real outage.
    await new Promise((r) => setTimeout(r, 1_000 * (i + 1)));
  }
  return last!;
}

/** A throwaway APIRequestContext with its own cookie jar, pointed at the gateway. */
export async function newGatewayContext(
  extraHeaders: Record<string, string> = {},
): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: GATEWAY_URL,
    extraHTTPHeaders: { ...workerHeaders(), ...extraHeaders },
  });
}

export interface LoginOutcome {
  status: number;
  errorCode: string | null;
  accessToken: string | null;
  raw: unknown;
}

async function readBody(res: APIResponse): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * POST /api/v1/auth/login exactly as the browser does it.
 *
 * Returns the outcome instead of throwing, because three of the interesting states are
 * NON-200 by design and a caller has to be able to branch on them:
 *   401 TOTP_REQUIRED             — enrolled account, no code supplied (D-29a)
 *   401 TOTP_ENROLLMENT_REQUIRED  — must have a factor, has never enrolled one
 *   403 PASSWORD_CHANGE_REQUIRED  — outstanding forced change (13-08); body carries the
 *                                   single-use changeToken in error.details[].
 */
export async function apiLogin(
  ctx: APIRequestContext,
  input: { email: string; password: string; tenantSlug: string; totpCode?: string },
): Promise<LoginOutcome> {
  await paceLogin();
  const res = await withTransientRetry(() =>
    ctx.post("/api/v1/auth/login", {
      data: {
        email: input.email,
        password: input.password,
        tenantSlug: input.tenantSlug,
        ...(input.totpCode ? { totpCode: input.totpCode } : {}),
      },
      failOnStatusCode: false,
    }),
  );
  const body = await readBody(res);
  const error = body.error as { code?: string } | undefined;
  const data = body.data as { accessToken?: string } | undefined;
  return {
    status: res.status(),
    errorCode: error?.code ?? null,
    accessToken: data?.accessToken ?? null,
    raw: body,
  };
}

/**
 * Log a persona in, supplying a live TOTP code when the account is enrolled.
 *
 * The retry on TOTP_REQUIRED with `skew` is deliberate: it is the same one-window tolerance
 * `login()` in scripts/seed_restaurantos.py applies, and it exists because a code minted at
 * T can be validated at T+1s in a *different* 30s window.
 */
export async function apiLoginPersona(
  ctx: APIRequestContext,
  p: Persona,
  tenantSlug: string,
): Promise<LoginOutcome> {
  const secret = p.totpEnrolled ? loadTotpSecret(p.email) : null;

  if (p.totpEnrolled && !secret) {
    return {
      status: 0,
      errorCode: "E2E_MISSING_TOTP_SECRET",
      accessToken: null,
      raw: {
        message:
          `${p.email} is TOTP-enrolled (D-29a) but no secret was found in ${TOTP_SECRET_DIR}. ` +
          "auth-service mints the secret at enrolment and it cannot be re-derived. " +
          "Re-run: python3 scripts/seed_restaurantos.py --phase personas --repair",
      },
    };
  }

  const first = await apiLogin(ctx, {
    email: p.email,
    password: p.password,
    tenantSlug,
    ...(secret ? { totpCode: await totpStable(secret) } : {}),
  });

  if (first.status === 200 || !secret || first.errorCode !== "TOTP_REQUIRED") return first;

  return apiLogin(ctx, {
    email: p.email,
    password: p.password,
    tenantSlug,
    totpCode: await totpStable(secret),
  });
}

/** POST /api/v1/platform/auth/login — the control-plane credential endpoint. */
export async function apiPlatformLogin(
  ctx: APIRequestContext,
  input: { email: string; password: string },
): Promise<LoginOutcome> {
  await paceLogin();
  const res = await withTransientRetry(() =>
    ctx.post("/api/v1/platform/auth/login", { data: input, failOnStatusCode: false }),
  );
  const body = await readBody(res);
  const error = body.error as { code?: string } | undefined;
  const data = body.data as { accessToken?: string } | undefined;
  return {
    status: res.status(),
    errorCode: error?.code ?? null,
    accessToken: data?.accessToken ?? null,
    raw: body,
  };
}

/**
 * An access token for a persona WITHOUT logging in, by exchanging the refresh cookie in its
 * minted storage state.
 *
 * This is the default way to get a bearer token in a spec, and the reason is a measured
 * product constraint rather than speed. `AuthServiceImpl.login` writes failed_login_count,
 * locked_until and last_login_at and calls `userRepository.save(user)` on a `@Version`
 * entity (L122-126, UserEntity.java:59), so two concurrent logins as the SAME account race
 * that row and the loser gets 409 CONCURRENT_MODIFICATION. Measured 2026-08-07: four
 * simultaneous logins as one user → 1×200, 3×409; as four different users → 4×200.
 *
 * `POST /api/v1/auth/refresh` has no such hazard: `RefreshSessionService.validate` is a pure
 * read (no save, and RefreshSessionEntity carries no @Version), and AuthServiceImpl.refresh
 * only signs a token. Concurrent refreshes for one user are safe.
 *
 * The token it returns carries `totp_verified: false` — always, by design. Anything asserting
 * on step-up must log in properly.
 */
export async function tokenViaRefresh(storageStatePath: string): Promise<string> {
  const ctx = await playwrightRequest.newContext({
    baseURL: GATEWAY_URL,
    storageState: storageStatePath,
    extraHTTPHeaders: workerHeaders(),
  });
  try {
    const res = await withTransientRetry(() =>
      ctx.post("/api/v1/auth/refresh", { failOnStatusCode: false }),
    );
    if (res.status() !== 200) {
      throw new Error(
        `POST /api/v1/auth/refresh returned ${res.status()} for storage state ` +
          `${storageStatePath}. Re-run the auth-setup project — states are minted per run, ` +
          "not committed.",
      );
    }
    const body = (await res.json()) as { data: { accessToken: string } };
    return body.data.accessToken;
  } finally {
    await ctx.dispose();
  }
}

/** Decode a JWT payload. Signature is NOT checked — the gateway does that; this is for assertions. */
export function jwtClaims(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("not a JWT");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}
