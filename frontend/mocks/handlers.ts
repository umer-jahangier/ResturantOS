import { http, HttpResponse } from "msw";

// MSW request handlers for the auth + feature-flags endpoints (FE-07).
// TEST-ONLY: consumed by the Vitest server (mocks/server.ts). There is no
// runtime/browser mocking — the app always talks to the live gateway.

const TENANT_ID = "a0000001-0000-4000-8000-000000000001";
const BRANCH_ID = "b0000001-0000-4000-8000-000000000001";
const ALT_BRANCH_ID = "b0000002-0000-4000-8000-000000000002";

// The privileged users require TOTP step-up (FD-2) — mirrors real DB behaviour.
// owner@demo.local  → has rbac.manage → TOTP_REQUIRED
// accountant@demo.local → has finance.period.close → TOTP_REQUIRED
const TOTP_REQUIRED_EMAILS = new Set([
  "owner@demo.local",
  "accountant@demo.local",
  "owner@demo.test",
]);

// Mirrors the real DB seed (900-seed-auth-dev-data.xml + role_permissions).
// Permission codes are the EXACT codes in the role_permissions table.
const DEMO_USERS: Record<string, DemoUser> = {
  "cashier@demo.local": {
    userId: "c0000001-0000-4000-8000-000000000001",
    roles: ["CASHIER"],
    // CASHIER: pos.order.* — no finance, no rbac
    permissions: ["pos.order.create", "pos.order.close", "pos.order.view"],
    approvalLimit: 5_000_000,
  },
  "owner@demo.local": {
    userId: "c0000002-0000-4000-8000-000000000002",
    roles: ["OWNER"],
    // OWNER: all permissions — but requires TOTP step-up at login
    permissions: [
      "pos.order.create", "pos.order.close", "pos.order.view",
      "pos.order.void.own", "pos.order.void.any",
      "inventory.item.view", "inventory.item.manage",
      "finance.journal.view", "finance.journal.post", "finance.period.close",
      "finance.expense.approve",
      "vendor.manage", "vendor.po.approve",
      "rbac.manage",
    ],
    approvalLimit: 100_000_000,
  },
  "accountant@demo.local": {
    userId: "c0000003-0000-4000-8000-000000000003",
    roles: ["ACCOUNTANT"],
    // ACCOUNTANT: finance + pos.order.view — but requires TOTP (has finance.period.close)
    permissions: [
      "finance.journal.view", "finance.journal.post", "finance.period.close",
      "pos.order.view",
    ],
    approvalLimit: 50_000_000,
  },
  "finance_demo@demo.local": {
    userId: "c0000004-0000-4000-8000-000000000004",
    roles: ["FINANCE_VIEWER"],
    // FINANCE_VIEWER: journal view+post — no period.close, no rbac.manage → no TOTP
    permissions: ["finance.journal.view", "finance.journal.post"],
    approvalLimit: 25_000_000,
  },
};

type DemoUser = {
  userId: string;
  roles: string[];
  permissions: string[];
  approvalLimit: number;
};

// Fallback for any unknown email (test usage)
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const DEFAULT_USER: DemoUser = DEMO_USERS["cashier@demo.local"]!;

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

function lookupUser(email?: string): DemoUser {
  return (email ? (DEMO_USERS[email.toLowerCase()] ?? DEFAULT_USER) : DEFAULT_USER);
}

// An unsigned, real-shaped JWT whose payload the `decodeJwt` util can read
// (sub / tenant_id / branch_id / roles / permissions / attributes).
function mockAccessToken(branchId: string, email?: string): string {
  const user = lookupUser(email);
  const header = base64Url(JSON.stringify({ alg: "none", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      sub: user.userId,
      tenant_id: TENANT_ID,
      branch_id: branchId,
      roles: user.roles,
      permissions: user.permissions,
      attributes: { approval_limit_paisa: user.approvalLimit },
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
    const email = body.email?.toLowerCase() ?? "";

    // Mirrors real auth-service: TOTP step-up for rbac.manage / finance.period.close owners.
    if (TOTP_REQUIRED_EMAILS.has(email) && !body.totpCode) {
      return authError("TOTP_REQUIRED", "TOTP code required", 401);
    }

    const user = lookupUser(email);
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
          accessToken: mockAccessToken(BRANCH_ID, email),
          expiresInSeconds: 900,
          userId: user.userId,
          tenantId: TENANT_ID,
          branchId: BRANCH_ID,
        },
        meta: null,
        warnings: [],
      },
      { status: 200, headers },
    );
  }),

  http.post("*/api/v1/auth/refresh", async ({ request }) => {
    // Reuse the email from the request body if provided (branch-switch), else default user
    const body = (await request.json().catch(() => ({}))) as LoginRequestBody;
    const email = body.email?.toLowerCase() ?? "";
    return HttpResponse.json({
      data: { accessToken: mockAccessToken(BRANCH_ID, email), expiresInSeconds: 900 },
      meta: null,
      warnings: [],
    });
  }),

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
      data: {
        features: [
          "FEATURE_POS",
          "FEATURE_INVENTORY",
          "FEATURE_KDS",
          "FEATURE_FINANCE",
          "FEATURE_REPORTING",
        ],
      },
      meta: null,
      warnings: [],
    }),
  ),
];
