/*
 * DIAGNOSIS ONLY — branch management & per-branch staff.
 * Signs in as OWNER (the persona who would actually do this job), asserts preconditions,
 * and records what is reachable. Writes screenshots + a JSON transcript.
 *
 * node e2e/diag/branches-users.mjs
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/branches-users";
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });

const OWNER = {
  slug: "floating-terrace",
  email: "owner@terrace.local",
  password: "Terrace#Owner1",
  totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
};

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpNow(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[o] & 0x7f) << 24) | ((hmac[o + 1] & 0xff) << 16) | ((hmac[o + 2] & 0xff) << 8) | (hmac[o + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

const log = [];
function rec(k, v) { log.push({ k, v }); console.log(`[${k}]`, typeof v === "string" ? v.slice(0, 400) : JSON.stringify(v).slice(0, 600)); }

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log("  shot ->", name + ".png");
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(OWNER.slug);
  await page.locator('input[name="email"], input#email').first().fill(OWNER.email);
  await page.locator('input[name="password"], input#password').first().fill(OWNER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    await totp.first().fill(totpNow(OWNER.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(5000);
  }
  return !page.url().includes("/login");
}

/** Visit and report honestly: error state vs empty vs content. Retries once on [role=alert]. */
async function visit(page, route, name, { retry = true } = {}) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  let body = await page.locator("body").innerText().catch(() => "");
  const alerts = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
  const is404 = /404|This page could not be found|Not Found/i.test(body);
  const denied = /Access denied|You do not have permission|don't have permission/i.test(body);
  const errored = alerts.length > 0 || /Couldn'?t load|Something went wrong|Failed to/i.test(body);
  if (errored && retry) {
    console.log(`  ! ${name} showed an error state — RETRYING`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    body = await page.locator("body").innerText().catch(() => "");
  }
  const alerts2 = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
  rec(`route:${name}`, { route, url: page.url(), is404, denied, alerts: alerts2, textHead: body.slice(0, 1400) });
  await shot(page, name);
  return { body, is404, denied, alerts: alerts2 };
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  const netFails = [];
  page.on("response", async (r) => {
    if (r.status() >= 400 && r.url().includes("/api/")) netFails.push(`${r.status()} ${r.request().method()} ${r.url()}`);
  });
  page.on("pageerror", (e) => rec("pageerror", String(e).slice(0, 300)));

  if (!(await login(page))) {
    rec("FATAL", "owner login failed, url=" + page.url());
    await shot(page, "login-FAILED");
    await browser.close();
    writeFileSync(`${OUT}/transcript.json`, JSON.stringify(log, null, 2));
    return;
  }
  rec("login", "signed in as owner, url=" + page.url());

  // Grab the token for API probing.
  const token = await page.evaluate(() => {
    const keys = Object.keys(localStorage);
    const out = {};
    for (const k of keys) out[k] = localStorage.getItem(k)?.slice(0, 3000);
    return out;
  });
  writeFileSync(`${OUT}/localstorage.json`, JSON.stringify(token, null, 2));
  const cookies = await ctx.cookies();
  writeFileSync(`${OUT}/cookies.json`, JSON.stringify(cookies, null, 2));
  rec("storage-keys", Object.keys(token));
  rec("cookie-names", cookies.map((c) => c.name));

  // ---- What the sidebar actually offers -------------------------------------------------
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const navLinks = await page.locator("nav a, aside a").evaluateAll((els) =>
    els.map((e) => `${e.textContent?.trim()} -> ${e.getAttribute("href")}`),
  );
  rec("sidebar-links", navLinks);
  await shot(page, "00-dashboard-sidebar");

  // ---- (a) Is there ANY branches screen? ------------------------------------------------
  for (const r of ["/app/branches", "/app/settings/branches", "/app/branch", "/app/locations", "/app/settings/general"]) {
    const res = await visit(page, r, `01-probe${r.replace(/\//g, "_")}`, { retry: false });
    rec("branch-route-probe", { route: r, is404: res.is404 });
  }

  // ---- Settings -------------------------------------------------------------------------
  const settings = await visit(page, "/app/settings", "02-settings");
  const inputs = await page.locator("input, select, textarea").evaluateAll((els) =>
    els.map((e) => ({ tag: e.tagName, name: e.getAttribute("name"), type: e.getAttribute("type"), value: e.value, disabled: e.disabled })),
  );
  rec("settings-inputs", inputs);
  const buttons = await page.locator("button").allInnerTexts();
  rec("settings-buttons", buttons);

  // ---- Users ----------------------------------------------------------------------------
  await visit(page, "/app/users", "03-users");
  const userRows = await page.locator("table tbody tr, [data-testid*='user']").allInnerTexts().catch(() => []);
  rec("user-rows", userRows.slice(0, 40));
  const userButtons = await page.locator("button").allInnerTexts();
  rec("users-buttons", userButtons);
  // any branch filter?
  const selects = await page.locator("select, [role='combobox']").allInnerTexts().catch(() => []);
  rec("users-filters", selects);

  rec("api-4xx-so-far", netFails);
  writeFileSync(`${OUT}/transcript.json`, JSON.stringify(log, null, 2));
  await browser.close();
}

main();
