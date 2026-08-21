// Adversarial re-verification harness for "Admin: roles, permissions and feature gating".
// DIAGNOSE ONLY. No production code touched.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

export const REPO = "/Users/muhammadumer/Documents/Projects/ResturantOS";
export const SHOTS = `${REPO}/.planning/audits/diagnosis/rbac-verify`;
export const BASE = "http://localhost:3000";
export const GW = "http://localhost:8080";

mkdirSync(SHOTS, { recursive: true });

export const USERS = {
  superadmin: { email: "superadmin@softxlogic.com", password: "Test@123!", tenant: "", totp: false },
  owner: { email: "owner@terrace.local", password: "Terrace#Owner1", tenant: "floating-terrace", totp: true },
  admin: { email: "admin@terrace.local", password: "Terrace#Admin1", tenant: "floating-terrace", totp: true },
  manager: { email: "manager@terrace.local", password: "Terrace#Manager1", tenant: "floating-terrace", totp: false },
  cashier: { email: "cashier@terrace.local", password: "Terrace#Cashier1", tenant: "floating-terrace", totp: false },
  waiter: { email: "waiter@terrace.local", password: "Terrace#Waiter1", tenant: "floating-terrace", totp: false },
  accountant: { email: "accountant@terrace.local", password: "Terrace#Accountant1", tenant: "floating-terrace", totp: true },
};

export function totp(email) {
  const out = execFileSync("python3", [`${REPO}/scripts/generate_totp.py`, email], {
    cwd: REPO,
    encoding: "utf8",
  });
  return out.match(/TOTP code:\s*(\d{6})/)[1];
}

export async function login(page, key) {
  const u = USERS[key];
  const url = u.tenant ? `${BASE}/login?tenant=${u.tenant}` : `${BASE}/login`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const totpField = page.getByTestId("totp-code");
  for (let attempt = 0; attempt < 6 && !/\/app\/|\/platform\//.test(page.url()); attempt += 1) {
    await page.getByLabel("Email").fill(u.email).catch(() => {});
    await page.getByLabel("Password").fill(u.password).catch(() => {});
    if (await totpField.isVisible().catch(() => false)) {
      await totpField.fill(totp(u.email));
    }
    await page.getByTestId("login-submit").click().catch(() => {});
    await Promise.race([
      page.waitForURL(/\/app\/|\/platform\//, { timeout: 9000 }).catch(() => {}),
      totpField.waitFor({ state: "visible", timeout: 9000 }).catch(() => {}),
    ]);
    await page.waitForTimeout(1200);
  }
  await page.waitForURL(/\/app\/|\/platform\//, { timeout: 20000 });
  return page.url();
}

/** Navigate; retry once if the page is mid-failure, because an error state looks like a missing feature. */
export async function open(page, path, { settle = 2600 } = {}) {
  let last;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(settle);
    const body = await page.locator("body").innerText().catch(() => "");
    const alerts = (await page.locator('[role="alert"]').allInnerTexts().catch(() => [])).filter((t) => t.trim());
    const denied = /access denied|not authorized|don'?t have permission|do not have permission|restricted to platform/i.test(body);
    const notFound = /this page doesn'?t exist|404/i.test(body);
    const failed = /couldn'?t load|failed to load|something went wrong|unexpected error/i.test(body);
    last = { url: page.url(), denied, notFound, failed, alerts, body };
    if (attempt === 0 && (alerts.length || failed)) {
      console.log(`  [RETRY] ${path} showed alert/error attempt 1: ${JSON.stringify(alerts).slice(0, 220)}`);
      await page.waitForTimeout(3000);
      continue;
    }
    return last;
  }
  return last;
}

export async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }).catch(() => {});
  console.log(`  shot: ${name}.png`);
}

/**
 * The access token is held in memory only (lib/auth/session.ts — never localStorage), so it cannot
 * be read out of storage. Sniff it off the wire instead: every gateway call the app makes carries it
 * in the Authorization header, so the token an API probe uses is byte-identical to the one the UI is
 * using. Call this BEFORE login and read `.value` after.
 */
export function sniffToken(page) {
  const box = { value: null };
  page.on("request", (req) => {
    const auth = req.headers()["authorization"];
    if (auth && auth.startsWith("Bearer ey")) box.value = auth.slice(7);
  });
  return box;
}

/**
 * Mint a token straight from the gateway — used for API-only probes and cross-tenant tests.
 *
 * Backs off on 429: the login endpoint is genuinely rate-limited, and a burst of diagnostic logins
 * trips it. A 429 read as "login failed" would have me filing a false MISSING, which is the exact
 * class of error this pass exists to catch.
 */
export async function apiLogin({ email, password, tenantSlug, totpEmail }) {
  const body = { email, password };
  if (tenantSlug) body.tenantSlug = tenantSlug;
  let r, j;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    r = await fetch(`${GW}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.status !== 429) break;
    const wait = 15000 * (attempt + 1);
    console.log(`  [429] login rate-limited for ${email}; waiting ${wait / 1000}s`);
    await new Promise((res) => setTimeout(res, wait));
  }
  j = await r.json().catch(() => ({}));
  const needsTotp = JSON.stringify(j).includes("TOTP") || j?.data?.totpRequired;
  if (needsTotp && totpEmail) {
    r = await fetch(`${GW}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, totpCode: totp(totpEmail) }),
    });
    j = await r.json().catch(() => ({}));
  }
  return { status: r.status, token: j?.data?.accessToken ?? j?.accessToken ?? null, raw: j };
}

export async function api(token, path, init = {}) {
  const r = await fetch(`${GW}${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await r.text();
  return { status: r.status, body: body.slice(0, 500) };
}

export function jwtClaims(tok) {
  try {
    return JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
  } catch {
    return null;
  }
}
