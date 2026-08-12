/*
 * F10 — "Every journal entry is described by a UUID" harness.
 *
 * Same discipline as e2e/shift/lib.mjs: every persona logs in for real (TOTP included), every
 * navigation is checked for an error state before anything is scored, and every out-of-band read
 * spends the signed-in persona's OWN refresh cookie so "the feature is missing" cannot be
 * confused with "this persona cannot see it".
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export const BASE = "http://localhost:3000";
export const API = "http://localhost:8080";
export const OUT = resolve(
  "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/F10",
);
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
};

export function loadState() {
  if (!existsSync(STATE)) return {};
  return JSON.parse(readFileSync(STATE, "utf8"));
}
export function saveState(patch) {
  const s = { ...loadState(), ...patch };
  writeFileSync(STATE, JSON.stringify(s, null, 2));
  return s;
}

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

export async function newBrowser() {
  return chromium.launch({ args: ["--disable-dev-shm-usage"] });
}

export async function newPage(browser, viewport = { width: 1440, height: 950 }) {
  const ctx = await browser.newContext({ viewport });
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
  await page.waitForTimeout(2500);

  // Fill, then READ BACK. Typing into the form before React has hydrated leaves the controlled
  // inputs empty, the submit posts nothing, and the screen says "Enter a valid email address" —
  // a harness race that is indistinguishable from a bad credential unless the value is verified.
  const email = page.locator('input[name="email"], input#email').first();
  const password = page.locator('input[name="password"], input#password').first();
  await email.waitFor({ timeout: 20000 });
  for (let i = 0; i < 5; i++) {
    const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await slug.count()) await slug.first().fill(who.slug);
    await email.fill(who.email);
    await password.fill(who.password);
    if ((await email.inputValue()) === who.email && (await password.inputValue()) === who.password) {
      break;
    }
    await page.waitForTimeout(1500);
  }

  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3500);
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    if (!who.totpSecret) throw new Error(`${who.email} was challenged for TOTP and has no secret`);
    // A code minted in the last second of its 30s window is already stale by the time the
    // request lands, and the refusal is indistinguishable from a wrong secret. Wait for a fresh
    // window, then retry with a newly minted code — up to three windows.
    for (let attempt = 0; attempt < 3 && page.url().includes("/login"); attempt++) {
      const secondsIntoWindow = Math.floor(Date.now() / 1000) % 30;
      if (secondsIntoWindow > 24) await page.waitForTimeout((31 - secondsIntoWindow) * 1000);
      await totp.first().fill(totpNow(who.totpSecret));
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(5000);
      if (!page.url().includes("/login")) break;
      console.log(`    TOTP attempt ${attempt + 1} refused — waiting for the next window`);
      await page.waitForTimeout((31 - (Math.floor(Date.now() / 1000) % 30)) * 1000);
    }
  }
  if (page.url().includes("/login")) {
    // Say WHY. "Login failed" that does not name the refusal is the same crime this whole audit
    // is about — a 429 from a rate limiter and a wrong password look identical without this.
    const shown = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll('[role="alert"], .text-destructive'))
          .map((n) => (n.textContent || "").trim())
          .filter(Boolean)
          .join(" | "),
      )
      .catch(() => "");
    const auth = (page.__requests ?? []).filter((r) => /auth/.test(r.u)).slice(-6);
    throw new Error(
      `login failed for ${who.email} — still at ${page.url()}; shown: ${shown || "(nothing)"}; ` +
        `auth calls: ${JSON.stringify(auth)}`,
    );
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
    console.log(`    ! ${route} showed ${t.bad.join(",")}, retrying once`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(waitMs + 1500);
    return pageTrouble(page);
  }
  return t;
}

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

/** Read the journal-entry list the way a user reads it: header labels + per-row cell text. */
export async function readJeTable(page) {
  return page.evaluate(() => {
    const table = document.querySelector("table");
    if (!table) return { headers: [], rows: [], note: "no <table> on screen" };
    const headers = Array.from(table.querySelectorAll("thead th")).map((th) =>
      (th.textContent || "").trim(),
    );
    const rows = Array.from(table.querySelectorAll("tbody tr")).map((tr) =>
      Array.from(tr.querySelectorAll("td")).map((td) => (td.innerText || "").trim()),
    );
    return { headers, rows };
  });
}

export function log(...a) {
  console.log(...a);
}
