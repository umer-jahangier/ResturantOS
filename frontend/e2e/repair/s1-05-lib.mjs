// Shared instrument for the S1-05 repair ("cash is typed in paisa").
//
// The BEFORE probe and the AFTER proof both import this file, so a reviewer comparing them is
// comparing the same instrument rather than two different ones. Nothing here asserts — the
// probes decide what a reading means.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

export const REPO = "/Users/muhammadumer/Documents/Projects/ResturantOS";
export const SHOTS = `${REPO}/.planning/audits/repair/S1-05`;
export const BASE = "http://localhost:3000";
export const API = "http://localhost:8080";

export const CASHIER = {
  slug: "floating-terrace",
  email: "cashier@terrace.local",
  password: "Terrace#Cashier1",
};

/**
 * The bill the register names: Rs 3,456.80.
 *
 * 2 x Chicken Karahi (Rs 1,450.00) + 1 x Butter Naan (Rs 80.00) = subtotal Rs 2,980.00, all at
 * 16% -> tax Rs 476.80 -> total Rs 3,456.80 exactly. Chosen so the numbers in DONE MEANS
 * (tendered 400000, change 54320) are reachable without any rounding slack to hide behind.
 */
export const BILL = [
  { name: "Chicken Karahi", taps: 2 },
  { name: "Butter Naan", taps: 1 },
];
export const EXPECTED_TOTAL_PAISA = 345680;

export function shotDir() {
  mkdirSync(SHOTS, { recursive: true });
  return SHOTS;
}

export async function shot(page, name, { fullPage = false } = {}) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
  console.log(`    shot: ${name}.png`);
}

export function totp(email) {
  const out = execFileSync("python3", [`${REPO}/scripts/generate_totp.py`, email], {
    cwd: REPO,
    encoding: "utf8",
  });
  return out.match(/TOTP code:\s*(\d{6})/)[1];
}

export async function login(page, who = CASHIER) {
  // A 503 on the login POST is a service being restarted by another agent on this shared stack,
  // not a bad credential — and a run that dies there would be reported as a broken fix. Retry,
  // and SAY when a retry happened so nobody mistakes a flap for a pass.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.goto(`${BASE}/login?tenant=${who.slug}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await slug.count()) await slug.first().fill(who.slug);
    await page.locator('input[name="email"], input#email').first().fill(who.email);
    await page.locator('input[name="password"], input#password').first().fill(who.password);
    await page.locator('button[type="submit"]').first().click();
    const landed = await page
      .waitForURL(/\/app\//, { timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    if (landed) {
      await page.waitForTimeout(1500);
      return page.url();
    }
    const why = await page.locator("body").innerText().catch(() => "");
    console.log(
      `    [retry ${attempt + 1}/10] sign-in did not land: ${why.replace(/\s+/g, " ").slice(0, 120)}`,
    );
    await new Promise((r) => setTimeout(r, 12_000));
  }
  throw new Error(`could not sign in as ${who.email} after 10 attempts`);
}

/**
 * A cash tender is REFUSED server-side without an open drawer (PaymentServiceImpl, D-30), so the
 * proof has to open one the way a cashier does — through the till bar — or the whole run dies on
 * a 409 that has nothing to do with this gap.
 */
export async function ensureTillOpen(page) {
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const openBtn = page.getByTestId("open-till-button");
  if (!(await openBtn.isVisible().catch(() => false))) {
    console.log("    till: already open");
    return false;
  }
  await openBtn.click();
  await page.getByTestId("open-till-panel").waitFor({ timeout: 8000 });
  await page.locator('[data-testid="open-till-panel"] input[type="number"]').fill("5000.00");
  await page.getByTestId("open-till-confirm-button").click();
  await page.waitForTimeout(2500);
  console.log("    till: opened with a Rs 5,000.00 float");
  return true;
}

/** Taps the named menu tiles the given number of times. Fails loudly if a tile is missing. */
export async function ringBill(page, bill = BILL) {
  // The grid being absent is ambiguous — an empty menu and a 503'd menu read look identical on
  // screen, and this audit has already scored a service restart as a missing feature once.
  // Reload until it is there, and report each reload.
  let grid = false;
  for (let attempt = 0; attempt < 8 && !grid; attempt += 1) {
    await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    grid = await page
      .getByTestId("menu-grid")
      .waitFor({ timeout: 12000 })
      .then(() => true)
      .catch(() => false);
    if (!grid) console.log(`    [retry ${attempt + 1}/8] the menu grid did not render — reloading`);
  }
  if (!grid) throw new Error("the POS menu grid never rendered — pos-service is not answering");
  for (const line of bill) {
    const tile = page
      .locator('[data-testid="menu-grid"] button[aria-pressed]')
      .filter({ hasText: line.name })
      .first();
    await tile.waitFor({ timeout: 15000 });
    for (let i = 0; i < line.taps; i += 1) {
      await tile.click();
      await page.waitForTimeout(350);
    }
  }
  await page.waitForTimeout(700);
}

/** Presses Charge Now and waits for the dedicated charge surface. Returns the order id. */
export async function chargeNow(page) {
  await page.getByTestId("charge-now-button").click();
  await page.waitForURL(/\/app\/pos\/orders\/[0-9a-f-]+\/charge/, { timeout: 30000 });
  await page.waitForTimeout(3000);
  return page.url().match(/orders\/([0-9a-f-]+)\/charge/)[1];
}

/**
 * Everything about the tender row a cashier can actually perceive. Deliberately reads the DOM
 * rather than the source: a class in a .tsx file is not a class in the document, and a label in
 * the source is not the accessible name.
 */
export async function probeTenderRow(page) {
  return page.evaluate(() => {
    const text = (n) => (n?.textContent || "").trim();
    const body = document.body.innerText;
    const inputs = Array.from(document.querySelectorAll("section input, section select")).map(
      (n) => ({
        tag: n.tagName.toLowerCase(),
        type: n.getAttribute("type"),
        ariaLabel: n.getAttribute("aria-label"),
        placeholder: n.getAttribute("placeholder"),
        inputMode: n.getAttribute("inputmode"),
        value: n.value,
        testid: n.getAttribute("data-testid"),
      }),
    );
    const el = (sel) => document.querySelector(sel);
    return {
      inputs,
      mentionsPaisa: /paisa/i.test(body) || inputs.some((i) => /paisa/i.test(i.ariaLabel || "") || /paisa/i.test(i.placeholder || "")),
      hasTenderedField: inputs.some((i) => /tender/i.test(i.ariaLabel || "") || /tender/i.test(i.placeholder || "")),
      hasChangeDue: /change due/i.test(body),
      changeDueText: text(el('[data-testid="change-due-value"]')),
      changeDuePaisa: el('[data-testid="change-due-value"]')?.getAttribute("data-paisa") ?? null,
      denominationKeys: Array.from(document.querySelectorAll('[data-testid^="denom-"]')).map(text),
      remainingText: text(el('[data-testid="remaining-balance-value"]')),
      remainingPaisa: el('[data-testid="remaining-balance-value"]')?.getAttribute("data-paisa") ?? null,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(text).filter(Boolean),
    };
  });
}

/**
 * The browser keeps its access token in memory (api-client injects it from `getSession()`), so a
 * `fetch` from page context would go out unauthenticated. The API read therefore mints its own
 * token as the same cashier — a genuinely independent read of the persisted rows over HTTP,
 * which is the point.
 */
export async function apiToken(who = CASHIER) {
  // Ten agents share this stack and services restart under us; a 503 here is a restarting
  // auth-service, not a failed credential. Retry rather than report a fix as broken.
  let last = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const res = await fetch(`${API}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantSlug: who.slug, email: who.email, password: who.password }),
    });
    const body = await res.json().catch(() => null);
    if (body?.data?.accessToken) return body.data.accessToken;
    last = { status: res.status, body };
    console.log(`    [retry ${attempt + 1}/12] auth answered ${res.status} — waiting 10s`);
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`could not mint a cashier token: ${JSON.stringify(last)}`);
}

export async function fetchPayments(token, orderId) {
  const res = await fetch(`${API}/api/v1/pos/orders/${orderId}/payments`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export async function fetchOrder(token, orderId, branchId) {
  const qs = branchId ? `?branchId=${branchId}` : "";
  const res = await fetch(`${API}/api/v1/pos/orders/${orderId}${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export function branchOf(token) {
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  return claims.branch_id;
}
