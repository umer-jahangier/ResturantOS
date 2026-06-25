import { http, HttpResponse } from "msw";

// Shared MSW handlers for the auth + feature-flags endpoints (FE-07). Used by
// both the dev worker (mocks/browser.ts) and the Vitest server (mocks/server.ts).

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const BRANCH_ID = "33333333-3333-4333-8333-333333333333";
const ALT_BRANCH_ID = "44444444-4444-4444-8444-444444444444";

// The seeded privileged user requires a TOTP step-up (FD-2).
const TOTP_USER_EMAIL = "owner@demo.test";

interface LoginRequestBody {
  email?: string;
  password?: string;
  tenantSlug?: string;
  totpCode?: string;
}

function base64Url(input: string): string {
  const base64 =
    typeof btoa === "function"
      ? btoa(input)
      : Buffer.from(input, "utf-8").toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// An unsigned, real-shaped JWT whose payload the `decodeJwt` util can read
// (sub / tenant_id / branch_id / roles / permissions / attributes).
function mockAccessToken(branchId: string): string {
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      sub: USER_ID,
      tenant_id: TENANT_ID,
      branch_id: branchId,
      roles: ["TENANT_OWNER"],
      permissions: ["FEATURE_POS", "order:create", "order:read"],
      attributes: { approval_limit_paisa: 5_000_000 },
    }),
  );
  return `${header}.${payload}.`;
}

function authError(code: string, message: string, status: number) {
  return HttpResponse.json(
    { error: { code, message, details: [], traceId: "mock-trace-id" } },
    { status },
  );
}

export const handlers = [
  http.post("*/api/v1/auth/login", async ({ request }) => {
    const body = (await request.json()) as LoginRequestBody;

    // Conditional TOTP step-up: privileged user without a code → 401 TOTP_REQUIRED.
    if (body.email === TOTP_USER_EMAIL && !body.totpCode) {
      return authError("TOTP_REQUIRED", "TOTP code required", 401);
    }

    const headers = new Headers();
    // Mirrors prod: HttpOnly refresh token (lands in MSW's virtual jar)…
    headers.append(
      "Set-Cookie",
      "refresh_token=mock; HttpOnly; Path=/api/v1/auth; SameSite=Strict",
    );
    // …plus the broadly-scoped, non-HttpOnly marker the server-side proxy reads.
    headers.append("Set-Cookie", "has_session=1; Path=/; SameSite=Strict");

    return HttpResponse.json(
      {
        data: {
          accessToken: mockAccessToken(BRANCH_ID),
          expiresInSeconds: 900,
          userId: USER_ID,
          tenantId: TENANT_ID,
          branchId: BRANCH_ID,
        },
        meta: null,
        warnings: [],
      },
      { status: 200, headers },
    );
  }),

  http.post("*/api/v1/auth/refresh", () =>
    HttpResponse.json({
      data: { accessToken: mockAccessToken(BRANCH_ID), expiresInSeconds: 900 },
      meta: null,
      warnings: [],
    }),
  ),

  http.post("*/api/v1/auth/logout", () => {
    const headers = new Headers();
    headers.append(
      "Set-Cookie",
      "refresh_token=; HttpOnly; Path=/api/v1/auth; SameSite=Strict; Max-Age=0",
    );
    headers.append("Set-Cookie", "has_session=; Path=/; SameSite=Strict; Max-Age=0");
    return HttpResponse.json({ data: null, meta: null, warnings: [] }, { headers });
  }),

  http.post("*/api/v1/auth/switch-branch", () =>
    HttpResponse.json({
      data: { accessToken: mockAccessToken(ALT_BRANCH_ID), expiresInSeconds: 900 },
      meta: null,
      warnings: [],
    }),
  ),

  http.get("*/api/v1/feature-flags", () =>
    HttpResponse.json({
      data: { features: ["FEATURE_POS", "FEATURE_INVENTORY", "FEATURE_KDS"] },
      meta: null,
      warnings: [],
    }),
  ),
];
