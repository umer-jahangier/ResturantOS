/*
 * DIAGNOSIS ONLY — adversarial re-drive of the "Branch management and per-branch staff" report.
 * Writes nothing to src/. Screenshots -> .planning/audits/diagnosis/branch-management/
 *
 * node e2e/diag/verify-branch-domain.mjs <persona>
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PERSONA = process.argv[2] ?? "owner";
const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/branch-management");
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";

const PEOPLE = {
  owner: {
    slug: "floating-terrace",
    email: "owner@terrace.local",
    password: "Terrace#Owner1",
    totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
  },
  admin: {
    slug: "floating-terrace",
    email: "admin@terrace.local",
    password: "Terrace#Admin1",
    totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS",
  },
  manager: {
    slug: "floating-terrace",
    email: "manager@terrace.local",
    password: "Terrace#Manager1",
    totpSecret: null,
  },
  superadmin: { slug: "", email: "superadmin@softxlogic.com", password: "Test@123!", totpSecret: null },
};

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpNow(secret) {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", key).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[off] & 0x7f) << 24 | (hmac[off + 1] & 0xff) << 16 | (hmac[off + 2] & 0xff) << 8 | (hmac[off + 3] & 0xff)) % 1e6;
  return String(code).padStart(6, "0");
}

const log = [];
function rec(k, v) { log.push({ k, v }); console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v)); }

async function shot(page, name) {
  await page.screenshot({ path: resolve(OUT, `${PERSONA}-${name}.png`), fullPage: true });
}

/** Detect an error/empty state so we never file a mid-failure shot as product truth. */
async function health(page) {
  return page.evaluate(() => {
    const t = document.body.innerText || "";
    return {
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim().slice(0, 160)),
      is404: /This page doesn.?t exist|404/i.test(t),
      denied: /Access denied|You do not have permission|do not have access/i.test(t),
      couldnt: /Couldn.?t load|Something went wrong|Failed to/i.test(t),
      h1: Array.from(document.querySelectorAll("h1,h2")).map((n) => n.innerText.trim()).slice(0, 8),
    };
  });
}

async function gotoStable(page, path, tries = 2) {
  let h;
  for (let i = 0; i < tries; i++) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(1400);
    h = await health(page);
    if (!h.couldnt && h.alerts.length === 0) return h;
    rec("retry", { path, attempt: i + 1, h });
    await page.waitForTimeout(1500);
  }
  return h;
}

const p = PEOPLE[PERSONA];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();

// Record every branch-related network call.
const calls = [];
page.on("response", async (r) => {
  const u = r.url();
  if (/\/api\/v1\/(branches|users)/.test(u)) {
    let body = "";
    try { body = (await r.text()).slice(0, 400); } catch { /* noop */ }
    calls.push({ method: r.request().method(), url: u.replace("http://localhost:8080", ""), status: r.status(), body });
  }
});

// ---- sign in -------------------------------------------------------------
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
if (p.slug) {
  const slugInput = page.locator('input[name="tenantSlug"], input[id*="tenant" i], input[placeholder*="restaurant" i]').first();
  if (await slugInput.count()) await slugInput.fill(p.slug).catch(() => {});
}
await page.locator('input[type="email"], input[name="email"]').first().fill(p.email);
await page.locator('input[type="password"]').first().fill(p.password);
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(2500);

for (let i = 0; p.totpSecret && i < 4 && /\/login/.test(page.url()); i++) {
  const otp = page.locator('input[name="totpCode"], input[autocomplete="one-time-code"], input[inputmode="numeric"]').first();
  if (await otp.count()) {
    await otp.fill("");
    await otp.fill(totpNow(p.totpSecret));
    await page.locator('button[type="submit"]').first().click();
  }
  await page.waitForTimeout(3200);
}
rec("signed-in-url", page.url());
if (/\/login/.test(page.url())) {
  rec("LOGIN-FAILED", await page.locator("body").innerText().then((t) => t.slice(0, 400)));
  await shot(page, "00-login-failed");
  await browser.close();
  writeFileSync(resolve(OUT, `transcript-${PERSONA}.json`), JSON.stringify(log, null, 2));
  process.exit(1);
}

// ---- sidebar dump --------------------------------------------------------
const nav = await page.evaluate(() =>
  Array.from(document.querySelectorAll("nav a, aside a")).map((a) => `${a.textContent.trim()} -> ${a.getAttribute("href")}`)
);
rec("sidebar", nav);

// ---- branch switcher present? -------------------------------------------
const switcher = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="branch-switcher"]');
  const byText = Array.from(document.querySelectorAll("button")).filter((b) =>
    /branch|terrace|rooftop|hq/i.test(b.innerText)
  ).map((b) => b.innerText.trim().replace(/\s+/g, " ").slice(0, 80));
  return { hasTestId: Boolean(el), testIdText: el?.innerText?.trim().replace(/\s+/g, " ") ?? null, candidateButtons: byText };
});
rec("branch-switcher", switcher);
await shot(page, "01-shell");

// ---- route probes --------------------------------------------------------
const PROBES = [
  "/app/branches", "/app/settings/branches", "/app/branch", "/app/locations",
  "/app/settings/general", "/app/settings/branch", "/app/admin/branches",
  "/app/settings/receipt", "/app/settings/printers", "/app/settings/hours",
  "/app/settings/tax", "/platform/branches",
];
for (const r of PROBES) {
  const h = await gotoStable(page, r, 2);
  rec("probe", { route: r, ...h });
}

// ---- settings page -------------------------------------------------------
const sh = await gotoStable(page, "/app/settings", 3);
rec("settings-health", sh);
await shot(page, "02-settings");
const sform = await page.evaluate(() => ({
  inputs: Array.from(document.querySelectorAll("input,select,textarea")).map((i) => ({
    name: i.getAttribute("name"), type: i.getAttribute("type"), value: i.value, readonly: i.readOnly, disabled: i.disabled,
  })),
  buttons: Array.from(document.querySelectorAll("button")).map((b) => b.innerText.trim().replace(/\s+/g, " ")).filter(Boolean),
  bodyText: (document.body.innerText || "").slice(0, 2500),
}));
rec("settings-form", sform);

writeFileSync(resolve(OUT, `transcript-${PERSONA}.json`), JSON.stringify({ log, calls }, null, 2));
await browser.close();
