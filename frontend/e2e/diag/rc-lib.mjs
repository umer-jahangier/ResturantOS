/*
 * Red-team recheck lib for "Tenant onboarding and business-model adaptivity".
 * Independent of onboarding-lib.mjs so its OUT dir and its assumptions cannot contaminate mine.
 * DIAGNOSIS ONLY — writes nothing into src/.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const BASE = "http://localhost:3000";
export const GW = "http://localhost:8080";
export const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/onboarding-recheck");
mkdirSync(OUT, { recursive: true });

export const PERSONAS = {
  superadmin: { slug: "", email: "superadmin@softxlogic.com", password: "Test@123!", totp: null },
  owner: {
    slug: "floating-terrace",
    email: "owner@terrace.local",
    password: "Terrace#Owner1",
    totp: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
  },
  admin: {
    slug: "floating-terrace",
    email: "admin@terrace.local",
    password: "Terrace#Admin1",
    totp: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS",
  },
  manager: {
    slug: "floating-terrace",
    email: "manager@terrace.local",
    password: "Terrace#Manager1",
    totp: null,
  },
  cashier: {
    slug: "floating-terrace",
    email: "cashier@terrace.local",
    password: "Terrace#Cashier1",
    totp: null,
  },
};

function b32(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    const i = alphabet.indexOf(ch);
    if (i === -1) continue;
    value = (value << 5) | i;
    bits += 5;
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
  return String(code % 1e6).padStart(6, "0");
}

export async function launch(opts = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const net = [];
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/v1/")) net.push({ m: r.request().method(), s: r.status(), u: u.replace(GW, "") });
  });
  page.on("console", (m) => {
    if (m.type() === "error" && opts.console !== false) console.log("  [console.error]", m.text().slice(0, 160));
  });
  return { browser, ctx, page, net };
}

/** Generic login for any {slug,email,password,totp} record — not only the seeded personas. */
export async function loginAs(page, p, label = "user") {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slugField = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if ((await slugField.count()) && p.slug) await slugField.first().fill(p.slug);
  await page.locator('input[name="email"], input#email').first().fill(p.email);
  await page.locator('input[name="password"], input#password').first().fill(p.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
  const totpField = page.locator('input[name="totpCode"], input#totpCode');
  if (await totpField.count()) {
    if (!p.totp) throw new Error(`${label}: TOTP asked for but no secret available`);
    await totpField.first().fill(totpNow(p.totp));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(6000);
  }
  for (let i = 0; i < 8 && page.url().includes("/login"); i++) await page.waitForTimeout(1500);
  if (page.url().includes("/login")) {
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 400);
    throw new Error(`${label}: still on /login. Body: ${body}`);
  }
  console.log(`  [login] ${label} -> ${page.url()}`);
  return page.url();
}

export const login = (page, key) => loginAs(page, PERSONAS[key], key);

/**
 * Visit, retry on an error state (up to 3 tries), screenshot, and classify honestly.
 * An error state and an empty product look identical in a PNG — so it is classified here.
 */
export async function visit(page, route, name, opts = {}) {
  const go = async () => {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(opts.wait ?? 3500);
    return (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  };
  const bad = /Couldn't load|Could not load|Something went wrong|Unexpected error|Failed to load|Try again|Session expired/i;
  const is404of = (t) => /This page doesn't exist|This page could not be found|Page not found|404/i.test(t);
  let text = await go();
  let tries = 1;
  while (bad.test(text) && !is404of(text) && tries < 3) {
    console.log(`  !! ${route} error state on try ${tries} — retrying`);
    await page.waitForTimeout(3000);
    text = await go();
    tries += 1;
  }
  const is404 = is404of(text);
  const denied = /Access denied|You do not have permission|Not authorised|Not authorized|Forbidden/i.test(text);
  const errored = bad.test(text) && !is404;
  const alerts = await page.locator('[role="alert"]').count();
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: opts.fullPage ?? true });
  console.log(
    `  ${route} :: ${is404 ? "404" : denied ? "ACCESS-DENIED" : errored ? "ERROR-STATE" : "rendered"} alerts=${alerts} tries=${tries}`,
  );
  console.log(`     "${text.slice(0, opts.chars ?? 450)}"`);
  return { text, is404, denied, errored, alerts, tries };
}

export async function api(method, path, token, body) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${GW}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const txt = await r.text();
  let json = null;
  try { json = JSON.parse(txt); } catch { /* not json */ }
  return { status: r.status, text: txt, json };
}

const tok = (j) => j?.accessToken ?? j?.data?.accessToken ?? null;

export async function tokenForRecord(p) {
  const body = { email: p.email, password: p.password };
  if (p.slug) body.tenantSlug = p.slug;
  let r = await api("POST", "/api/v1/auth/login", null, body);
  if (tok(r.json)) return tok(r.json);
  if (p.totp) {
    r = await api("POST", "/api/v1/auth/login", null, { ...body, totpCode: totpNow(p.totp) });
    if (tok(r.json)) return tok(r.json);
  }
  throw new Error(`token: ${r.status} ${r.text.slice(0, 200)}`);
}

export const tokenFor = (key) => tokenForRecord(PERSONAS[key]);
