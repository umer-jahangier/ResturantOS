/* Adversarial re-audit: Stations / KDS / POS terminals. DIAGNOSTIC ONLY, namespaced skpx-*. */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const BASE = "http://localhost:3000";
export const GW = "http://localhost:8080";
export const OUT =
  "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/stations-kds-pos";
export const BRANCH = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";

export const PERSONAS = {
  owner: {
    slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1",
    totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
  },
  admin: {
    slug: "floating-terrace", email: "admin@terrace.local", password: "Terrace#Admin1",
    totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS",
  },
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  kitchen: { slug: "floating-terrace", email: "kitchen@terrace.local", password: "Terrace#Kitchen1" },
  waiter: { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" },
};

function b32(input) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0; const out = [];
  for (const c of input.replace(/=+$/, "").toUpperCase()) {
    const i = A.indexOf(c); if (i === -1) continue;
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

export async function launch() {
  return chromium.launch({ headless: true });
}
export async function newPage(browser, { width = 1600, height = 1000 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("    ! pageerror:", String(e).slice(0, 140)));
  return { ctx, page };
}

/** Sign in by persona KEY or by an explicit {email,password,slug,totpSecret} object. */
export async function login(page, who) {
  const p = typeof who === "string" ? PERSONAS[who] : who;
  const label = typeof who === "string" ? who : p.email;
  for (let attempt = 1; attempt <= 4; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1300);
    const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (p.slug && (await slug.count())) await slug.first().fill(p.slug);
    await page.locator('input[name="email"], input#email').first().fill(p.email);
    await page.locator('input[name="password"], input#password').first().fill(p.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(3200);
    const totp = page.locator('input[name="totpCode"], input#totpCode');
    if (await totp.count()) {
      if (!p.totpSecret) throw new Error(`${label} challenged for TOTP but no secret`);
      await totp.first().fill(totpNow(p.totpSecret));
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(4200);
    }
    if (!page.url().includes("/login")) {
      console.log(`  signed in as ${label} (attempt ${attempt}) -> ${page.url()}`);
      return true;
    }
    const body = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 220);
    console.log(`  ! login attempt ${attempt} for ${label} failed: ${body}`);
    await page.waitForTimeout(1800);
  }
  return false;
}

export async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: false });
  console.log(`    [shot] ${name}.png`);
  return file;
}

/** Navigate + structured read, retrying error states so a failure is never filed as emptiness. */
export async function probe(page, route, { retries = 2, wait = 4500, who = null } = {}) {
  let last = null;
  for (let i = 0; i <= retries; i++) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(wait);
    if (page.url().includes("/login")) {
      // ~10 agents share these accounts; refresh rotation logs sessions out mid-sweep.
      // Re-establish and retry rather than reporting a login screen as the feature.
      console.log(`  ! SESSION LOST probing ${route} — re-authenticating`);
      if (!who) throw new Error(`SESSION LOST probing ${route} (no persona to re-auth)`);
      await login(page, who);
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(wait);
    }
    const r = await page.evaluate(() => {
      const body = document.body.innerText || "";
      return {
        url: location.pathname + location.search,
        alerts: [...document.querySelectorAll('[role="alert"]')].map((e) => e.innerText.trim().slice(0, 220)),
        heads: [...document.querySelectorAll("h1,h2")].map((e) => e.innerText.trim()).slice(0, 8),
        is404: /This page doesn.t exist/i.test(body),
        denied: /Access denied|You do not have permission|Forbidden/i.test(body),
        failed: /Couldn.t load|Could not load|Something went wrong|Failed to load/i.test(body),
        text: body,
      };
    });
    last = { ...r, attempt: i + 1 };
    if (!r.failed && r.alerts.length === 0) return last;
    console.log(`  ! ${route} error-ish on attempt ${i + 1}: ${JSON.stringify(r.alerts).slice(0, 200)} — retrying`);
    await page.waitForTimeout(2500);
  }
  console.log(`  !! ${route} STILL error-ish after retries — reported as observed`);
  return last;
}

/** Dump every open dialog: size (24px-dialog trap), labels, fields. */
export async function readDialog(page) {
  return page.evaluate(() => {
    const d = document.querySelector('[role="dialog"], [role="alertdialog"]');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      labels: [...d.querySelectorAll("label")].map((l) => l.innerText.trim().replace(/\s+/g, " ")),
      inputs: [...d.querySelectorAll("input,select,textarea")].map((i) => `${i.tagName}:${i.type || ""}:${i.name || i.id || ""}`),
      combos: [...d.querySelectorAll("[role='combobox'],button[aria-haspopup]")].map((c) => (c.innerText || c.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ")),
      buttons: [...d.querySelectorAll("button")].map((b) => (b.innerText || b.getAttribute("aria-label") || "").trim()).filter(Boolean),
      text: d.innerText.replace(/\s+/g, " ").slice(0, 900),
    };
  });
}

/** Call the gateway through the page's own authenticated session. */
export async function api(page, path, init) {
  return page.evaluate(async ([p, i]) => {
    try {
      const r = await fetch(p, { credentials: "include", ...(i || {}) });
      const t = await r.text();
      let j = null; try { j = JSON.parse(t); } catch {}
      return { status: r.status, body: j ?? t.slice(0, 500) };
    } catch (e) { return { status: -1, body: String(e) }; }
  }, [path, init]);
}
