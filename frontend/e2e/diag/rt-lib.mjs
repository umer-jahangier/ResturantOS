/*
 * RED-TEAM library for the UI/UX system-quality re-audit.
 * Independent of uiq-lib.mjs — written from scratch so I do not inherit its bugs.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const BASE = "http://localhost:3000";
export const OUT = resolve(
  process.cwd(),
  "../.planning/audits/diagnosis/ui-system-quality-redteam",
);

export const PERSONAS = {
  owner: {
    email: "owner@terrace.local",
    password: "Terrace#Owner1",
    totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
  },
  manager: { email: "manager@terrace.local", password: "Terrace#Manager1" },
  cashier: { email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  admin: {
    email: "admin@terrace.local",
    password: "Terrace#Admin1",
    totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS",
  },
  controlOwner: {
    email: "owner@control.local",
    password: "Control#Owner1",
    totpSecret: "77YCNG564SWVW7YPUCJRGDSE6ZSCC3GQ",
  },
};

function b32(input) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const c of input.replace(/=+$/, "").toUpperCase()) {
    const i = A.indexOf(c);
    if (i === -1) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
export function totpNow(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", b32(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const code = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export async function login(page, key, tries = 4) {
  const p = typeof key === "string" ? PERSONAS[key] : key;
  for (let i = 1; i <= tries; i += 1) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1600);
    await page.locator('input[name="email"], input#email').first().fill(p.email);
    await page.locator('input[name="password"], input#password').first().fill(p.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(3200);
    const totp = page.locator('input[name="totpCode"], [data-testid="totp-code"]');
    if (await totp.count()) {
      if (!p.totpSecret) return { ok: false, why: "TOTP demanded, no secret" };
      await totp.first().fill(totpNow(p.totpSecret));
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(4500);
    }
    if (!page.url().includes("/login")) return { ok: true, attempts: i };
    // TOTP is single-use inside its 30s window; wait for the next window.
    await page.waitForTimeout(31000);
  }
  return { ok: false, why: `still on ${page.url()}` };
}

const FAILCOPY = /Couldn.t load|temporarily unavailable|Something went wrong|Try again in a moment|Failed to fetch/i;
const REFUSAL = /Access denied|You do not have permission|not authorized|Forbidden/i;

/** goto + settle, retrying real error states and re-authing if evicted. Reports the retry. */
export async function go(page, route, persona = "owner", { attempts = 3, wait = 3000 } = {}) {
  let last = null;
  for (let i = 1; i <= attempts; i += 1) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(wait);
    if (page.url().includes("/login")) {
      const r = await login(page, persona);
      if (!r.ok) return { ok: false, evicted: true, why: r.why, attempt: i };
      continue;
    }
    const body = await page.locator("body").innerText().catch(() => "");
    last = { attempt: i, url: page.url(), refused: REFUSAL.test(body), failed: FAILCOPY.test(body) };
    if (!last.failed) return { ...last, ok: !last.refused };
  }
  return { ...(last || {}), ok: false };
}

export async function shot(page, name, sub = "") {
  const f = sub ? `${OUT}/${sub}/${name}.png` : `${OUT}/${name}.png`;
  mkdirSync(dirname(f), { recursive: true });
  await page.screenshot({ path: f, fullPage: false });
  return f;
}
export function save(name, data) {
  const f = `${OUT}/${name}`;
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(data, null, 2));
  return f;
}

export async function browser(width = 1440, height = 900) {
  const b = await chromium.launch({ headless: true });
  const ctx = await b.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  return { b, ctx, page };
}

/** Click a trigger by accessible name, tolerating duplicates. */
export async function openDialog(page, triggerText) {
  const t = page.getByRole("button", { name: new RegExp(`^\\s*${triggerText}\\s*$`, "i") }).first();
  if (!(await t.count())) {
    const loose = page.getByRole("button", { name: new RegExp(triggerText, "i") }).first();
    if (!(await loose.count())) return { opened: false, why: "trigger not found" };
    await loose.click();
  } else {
    await t.click();
  }
  await page.waitForTimeout(1400);
  const dlg = page.locator('[data-slot="dialog-content"], [role="dialog"]').first();
  return { opened: (await dlg.count()) > 0, dlg };
}
