/*
 * FULL SHIFT WALKTHROUGH — shared harness.
 *
 * One restaurant day, driven end to end in real Chromium, switching personas the way a
 * real restaurant does. Every step writes a screenshot and appends to a JSON journal so
 * later steps can pick up the same orders, and so the write-up quotes measurements rather
 * than memories.
 *
 * Deliberate properties:
 *  - Every persona logs in FOR REAL (TOTP included). No token injection: a persona that
 *    cannot reach a screen must fail here the way it fails for the employee.
 *  - `assertNotError()` is called after every navigation. The register was once audited
 *    mid-outage and six routes were scored as "empty" when they were actually broken.
 *  - Every page probe reads computed style where the claim is visual, never the class list.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export const BASE = "http://localhost:3000";
export const API = "http://localhost:8080";
export const OUT = resolve(process.cwd(), "../.planning/audits/shift");
export const STATE = resolve(OUT, "_state.json");

mkdirSync(OUT, { recursive: true });

export const PEOPLE = {
  owner: {
    slug: "floating-terrace",
    email: "owner@terrace.local",
    password: "Terrace#Owner1",
    totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
  },
  manager: {
    slug: "floating-terrace",
    email: "manager@terrace.local",
    password: "Terrace#Manager1",
  },
  cashier: {
    slug: "floating-terrace",
    email: "cashier@terrace.local",
    password: "Terrace#Cashier1",
  },
  kitchen: {
    slug: "floating-terrace",
    email: "kitchen@terrace.local",
    password: "Terrace#Kitchen1",
  },
  accountant: {
    slug: "floating-terrace",
    email: "accountant@terrace.local",
    password: "Terrace#Accountant1",
    totpSecret: "2XPUJEA7F6YYOV4P7ME5OH6PUBJWTV5C",
  },
};

// ─── state journal ────────────────────────────────────────────────────────────
export function loadState() {
  if (!existsSync(STATE)) return {};
  return JSON.parse(readFileSync(STATE, "utf8"));
}
export function saveState(patch) {
  const s = { ...loadState(), ...patch };
  writeFileSync(STATE, JSON.stringify(s, null, 2));
  return s;
}

// ─── findings journal ─────────────────────────────────────────────────────────
const FINDINGS = resolve(OUT, "_findings.jsonl");
export function finding(o) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...o });
  const prev = existsSync(FINDINGS) ? readFileSync(FINDINGS, "utf8") : "";
  writeFileSync(FINDINGS, prev + line + "\n");
  console.log(`  ⚑ [${o.sev ?? "?"}] ${o.id ?? ""} ${o.what}`);
}

// ─── TOTP ─────────────────────────────────────────────────────────────────────
function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0,
    value = 0;
  const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
export function totpNow(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[off] & 0x7f) << 24) |
    ((hmac[off + 1] & 0xff) << 16) |
    ((hmac[off + 2] & 0xff) << 8) |
    (hmac[off + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

// ─── browser ──────────────────────────────────────────────────────────────────
export async function newBrowser() {
  return chromium.launch({ args: ["--disable-dev-shm-usage"] });
}

export async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.__console = [];
  page.__requests = [];
  page.on("console", (m) => {
    if (m.type() === "error") page.__console.push(m.text().slice(0, 300));
  });
  page.on("response", (r) => {
    const u = r.url();
    if (u.startsWith(API)) page.__requests.push({ m: r.request().method(), s: r.status(), u });
  });
  return page;
}

export async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    if (!who.totpSecret) throw new Error(`${who.email} was challenged for TOTP and has no secret`);
    await totp.first().fill(totpNow(who.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4000);
  }
  if (page.url().includes("/login")) {
    throw new Error(`login failed for ${who.email} — still at ${page.url()}`);
  }
  console.log(`  ✓ signed in as ${who.email}`);
  return page;
}

export async function shot(page, name) {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  console.log(`    shot: ${name}.png`);
  return p;
}

/** Never score a screen while it is failing. Returns the error text if the page is broken. */
export async function pageTrouble(page) {
  return page.evaluate(() => {
    const t = document.body.innerText || "";
    const alerts = Array.from(document.querySelectorAll('[role="alert"]'))
      .map((n) => (n.textContent || "").trim())
      .filter(Boolean);
    const bad = [];
    if (/Couldn.t load|Something went wrong|SERVICE_UNAVAILABLE|Failed to fetch/i.test(t))
      bad.push("load-failure text");
    if (/Access denied|You do not have permission/i.test(t)) bad.push("access-denied");
    if (/This page doesn.t exist|404/i.test(t) && t.length < 900) bad.push("404");
    return { bad, alerts, url: location.href };
  });
}

export async function go(page, route, { waitMs = 3000, allowTrouble = false } = {}) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(waitMs);
  const t = await pageTrouble(page);
  if (t.bad.length && !allowTrouble) {
    // Retry once — a mid-failure audit is the trap that cost hours before.
    console.log(`    ! ${route} showed ${t.bad.join(",")}, retrying once`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(waitMs + 1500);
    const t2 = await pageTrouble(page);
    return t2;
  }
  return t;
}

export function money(paisa) {
  const neg = paisa < 0;
  const v = Math.abs(paisa);
  return `${neg ? "-" : ""}Rs ${(v / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The access token lives in an in-memory zustand store (never localStorage), so a probe
 * mints its own by spending the SAME HttpOnly refresh cookie the browser tab holds. That
 * keeps every out-of-band read on exactly the signed-in persona's rights — the only way
 * to tell "the feature is missing" apart from "this persona cannot see it".
 */
export async function tokenOf(page) {
  return page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
}

/** Fetch from INSIDE the page with the persona's own bearer. */
export async function apiGet(page, path, token) {
  const t = token ?? (await tokenOf(page));
  return page.evaluate(
    async ({ p, tok }) => {
      const r = await fetch(`http://localhost:8080${p}`, {
        credentials: "include",
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      let body = null;
      try {
        body = await r.json();
      } catch {
        body = null;
      }
      return { status: r.status, body };
    },
    { p: path, tok: t },
  );
}

export async function apiSend(page, method, path, payload, token) {
  const t = token ?? (await tokenOf(page));
  return page.evaluate(
    async ({ m, p, b, tok }) => {
      const r = await fetch(`http://localhost:8080${p}`, {
        method: m,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body: b === undefined ? undefined : JSON.stringify(b),
      });
      let body = null;
      try {
        body = await r.json();
      } catch {
        body = null;
      }
      return { status: r.status, body };
    },
    { m: method, p: path, b: payload, tok: t },
  );
}

export function log(...a) {
  console.log(...a);
}
