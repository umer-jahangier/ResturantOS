// S1-07 — "Switching branch does not survive a reload".
// Shared helpers for the repro + proof runs. DIAGNOSTIC/PROOF ONLY.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

export const REPO = "/Users/muhammadumer/Documents/Projects/ResturantOS";
export const SHOTS = `${REPO}/.planning/audits/repair/S1-07`;
export const BASE = "http://localhost:3000";
export const GW = "http://localhost:8080";

mkdirSync(SHOTS, { recursive: true });

export const MANAGER = {
  email: "manager@terrace.local",
  password: "Terrace#Manager1",
  tenant: "floating-terrace",
};

export function totp(email) {
  const out = execFileSync("python3", [`${REPO}/scripts/generate_totp.py`, email], {
    cwd: REPO,
    encoding: "utf8",
  });
  return out.match(/TOTP code:\s*(\d{6})/)[1];
}

export function jwtClaims(tok) {
  try {
    return JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/** Raw login that keeps the Set-Cookie header, so the refresh cookie can be replayed by hand. */
export async function rawLogin({ email, password, tenantSlug, totpEmail }) {
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
  if ((JSON.stringify(j).includes("TOTP") || j?.data?.totpRequired) && totpEmail) {
    r = await fetch(`${GW}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, totpCode: totp(totpEmail) }),
    });
    j = await r.json().catch(() => ({}));
  }
  const setCookie = r.headers.getSetCookie?.() ?? [r.headers.get("set-cookie")].filter(Boolean);
  return {
    status: r.status,
    token: j?.data?.accessToken ?? null,
    cookie: setCookie.map((c) => c.split(";")[0]).join("; "),
    setCookie,
    raw: j,
  };
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
  return { status: r.status, body };
}

/** Playwright login for the manager (no TOTP). */
export async function loginUi(page, user = MANAGER) {
  await page.goto(`${BASE}/login?tenant=${user.tenant}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  for (let attempt = 0; attempt < 5 && !/\/app\//.test(page.url()); attempt += 1) {
    await page.getByLabel("Email").fill(user.email).catch(() => {});
    await page.getByLabel("Password").fill(user.password).catch(() => {});
    await page.getByTestId("login-submit").click().catch(() => {});
    await page.waitForURL(/\/app\//, { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1200);
  }
  await page.waitForURL(/\/app\//, { timeout: 20000 });
  return page.url();
}

/**
 * The access token is memory-only, so it cannot be read from storage. Sniff it off the wire:
 * every gateway call the SPA makes carries it in the Authorization header.
 * Install BEFORE navigating; read `.value` after.
 */
export function sniffToken(page) {
  const box = { value: null, history: [] };
  page.on("request", (req) => {
    const auth = req.headers()["authorization"];
    if (auth && auth.startsWith("Bearer ey")) {
      box.value = auth.slice(7);
      box.history.push({ url: req.url(), token: auth.slice(7) });
    }
  });
  return box;
}

export async function switcherLabel(page) {
  const btn = page.getByRole("button", { name: "Switch branch" });
  await btn.waitFor({ state: "visible", timeout: 20000 });
  return (await btn.innerText()).trim();
}

/**
 * Select a branch from the switcher.
 *
 * Two things here were measured, not assumed, and both cost a wrong verdict once:
 *
 * 1. `locator.click()` on the Radix `DropdownMenuItem` fires no request at all — the POST never
 *    leaves the page. A real `mouse.click()` at the item's centre does. Verified by counting
 *    `page.on("request")` hits for `/auth/switch-branch`: 0 with the locator click, 1 with the
 *    mouse. A harness that used the locator click would report "switching does nothing".
 * 2. The round trip takes several seconds (the mutation, then `queryClient.clear()` and the
 *    refetch storm behind it). A 3.5s settle read the OLD label and would have been recorded as
 *    "the switch did not take". So this waits for the label to actually change, and says so if
 *    it never does, rather than sampling once.
 */
export async function pickBranch(page, name, { timeout = 45000 } = {}) {
  const btn = page.getByRole("button", { name: "Switch branch" });
  const before = (await btn.innerText()).trim();
  await btn.click();
  await page.waitForTimeout(700);
  const item = page.getByRole("menuitem").filter({ hasText: name.replace(/^.*—\s*/, "") }).first();
  const box = await item.boundingBox();
  if (!box) throw new Error(`branch menu item "${name}" has no box — dropdown did not open`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    const now = (await btn.innerText().catch(() => before)).trim();
    if (now !== before) return now;
  }
  throw new Error(`branch label never changed from "${before}" after selecting "${name}"`);
}

export async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }).catch(() => {});
  console.log(`  shot: ${name}.png`);
}
