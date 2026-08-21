/* Independent verification harness for the finance/accounting audit. DIAGNOSTIC ONLY. */
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const BASE = "http://localhost:3000";
export const GW = "http://localhost:8080";
export const OUT = resolve(
  "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/finance-verify",
);

export const PERSONAS = {
  accountant: { slug: "floating-terrace", email: "accountant@terrace.local", password: "Terrace#Accountant1", totpSecret: "2XPUJEA7F6YYOV4P7ME5OH6PUBJWTV5C" },
  owner: { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" },
  admin: { slug: "floating-terrace", email: "admin@terrace.local", password: "Terrace#Admin1", totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS" },
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
};

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totpNow(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[o] & 0x7f) << 24) | ((hmac[o + 1] & 0xff) << 16) | ((hmac[o + 2] & 0xff) << 8) | (hmac[o + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export async function login(page, p) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await slug.count()) await slug.first().fill(p.slug);
    await page.locator('input[name="email"], input#email').first().fill(p.email);
    await page.locator('input[name="password"], input#password').first().fill(p.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(3500);
    const totp = page.locator('input[name="totpCode"], input#totpCode');
    if ((await totp.count()) && p.totpSecret) {
      await totp.first().fill(totpNow(p.totpSecret));
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(5000);
    }
    if (!page.url().includes("/login")) return true;
    const body = await page.locator("body").innerText().catch(() => "");
    console.log(`  login attempt ${attempt} failed, url=${page.url()} body=${body.slice(0, 200).replace(/\n/g, " | ")}`);
    await page.waitForTimeout(6000);
  }
  return false;
}

/** Assert we are actually signed in and on the expected page before observing anything. */
export async function assertOn(page, route) {
  const u = page.url();
  if (u.includes("/login")) throw new Error(`SESSION LOST: expected ${route}, on ${u}`);
  return true;
}

export async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

export function save(name, text) {
  const file = `${OUT}/${name}`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

/** Visit with retry — a screenshot of a transient error is the trap this audit exists for. */
export async function visit(page, route, { tries = 3, settle = 4500 } = {}) {
  let last = null;
  for (let i = 1; i <= tries; i++) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(settle);
    const url = page.url();
    if (url.includes("/login")) { last = { url, sessionLost: true, body: "", alerts: [], denied: false, errored: true, attempt: i }; await page.waitForTimeout(2000); continue; }
    const body = await page.locator("body").innerText().catch(() => "");
    const alerts = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
    const denied = /Access denied|You do not have permission|do not have access|not authorized/i.test(body);
    const errored =
      /Couldn't load|Could not load|Failed to load|Something went wrong|Unable to load|Try again/i.test(body) ||
      alerts.some((a) => /error|failed|couldn't|could not|unable/i.test(a));
    last = { body, alerts, denied, errored, attempt: i, url, sessionLost: false };
    if (!errored && !denied) return last;
    await page.waitForTimeout(3000);
  }
  return last;
}

/** Read the in-page access token the app is actually holding right now. */
export async function pageToken(page) {
  return page.evaluate(() => {
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        const v = store.getItem(k);
        if (!v) continue;
        if (/^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(v)) return { key: k, token: v };
        try {
          const o = JSON.parse(v);
          for (const kk of ["accessToken", "access_token", "token"]) {
            if (typeof o?.[kk] === "string" && o[kk].startsWith("ey")) return { key: `${k}.${kk}`, token: o[kk] };
            if (typeof o?.state?.[kk] === "string" && o.state[kk].startsWith("ey")) return { key: `${k}.state.${kk}`, token: o.state[kk] };
          }
        } catch { /* not json */ }
      }
    }
    return null;
  });
}

export function decodeJwt(t) {
  try { return JSON.parse(Buffer.from(t.split(".")[1], "base64").toString("utf8")); } catch { return null; }
}

/** Scan the CURRENT page for any export/download/print affordance. */
export async function scanExports(page) {
  return page.evaluate(() => {
    const hits = [];
    const nodes = document.querySelectorAll("button, a, [role=button], [role=menuitem], input[type=button]");
    for (const n of nodes) {
      const t = (n.innerText || n.textContent || "").trim();
      const aria = n.getAttribute("aria-label") || "";
      const href = n.getAttribute("href") || "";
      const dl = n.hasAttribute("download");
      const blob = `${t} ${aria} ${href}`;
      if (dl || /export|download|\.csv|csv|xlsx|excel|\bpdf\b|print/i.test(blob)) {
        hits.push({ text: t.slice(0, 60), aria, href: href.slice(0, 80), download: dl });
      }
    }
    return hits;
  });
}
