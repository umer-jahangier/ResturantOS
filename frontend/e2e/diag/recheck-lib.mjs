// DIAGNOSIS ONLY — shared helpers for the CRM/loyalty re-check.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

export const BASE = "http://localhost:3000";
export const GW = "http://localhost:8080";
export const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/crm-loyalty-recheck");
mkdirSync(OUT, { recursive: true });

export const PERSONAS = {
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  owner: { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totp: true },
  admin: { slug: "floating-terrace", email: "admin@terrace.local", password: "Terrace#Admin1", totp: true },
  waiter: { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" },
  ctrlManager: { slug: "control-bistro-isolation-test-tenant", email: "manager@control.local", password: "Control#Manager1" },
};

export function makeLog(name) {
  const log = [];
  const say = (...a) => {
    const s = a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
    console.log(s);
    log.push(s);
  };
  const flush = () => writeFileSync(`${OUT}/${name}.txt`, log.join("\n"));
  return { say, flush, log };
}

export function totpFor(email) {
  // Script prints several lines; the code is the 6 digits after "TOTP code:".
  const out = execSync(`python3 ../scripts/generate_totp.py ${email}`).toString();
  const m = out.match(/TOTP code:\s*(\d{6})/);
  if (!m) throw new Error("could not parse TOTP from: " + out);
  return m[1];
}

export async function launch() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  return { browser, ctx };
}

export async function shot(page, name, say) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }).catch(() => {});
  if (say) say("   shot:", `${name}.png`);
}

export async function login(page, p, say) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (p.slug && (await slug.count())) await slug.first().fill(p.slug);
  await page.locator('input[name="email"], input#email').first().fill(p.email);
  await page.locator('input[name="password"], input#password').first().fill(p.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3500);
  if (p.totp) {
    // The real selector used by the product's step-up form (see e2e/shots-owner.mjs).
    const otp = page.locator('input[name="totpCode"], input#totpCode, input[autocomplete="one-time-code"]');
    if (await otp.count()) {
      const code = totpFor(p.email);
      if (say) say(`   TOTP challenge shown; entering ${code}`);
      await otp.first().fill(code);
      const btn = page.locator('button[type="submit"]');
      if (await btn.count()) await btn.first().click();
      await page.waitForTimeout(5000);
    } else if (say) say("   !! expected a TOTP challenge and none appeared");
  }
  await page.waitForTimeout(1500);
  const ok = !page.url().includes("/login");
  if (say) say(`login ${p.email}: ${ok} -> ${page.url()}`);
  return ok;
}

/**
 * Detects an error/denied/bounced state so we never audit a failure screenshot.
 *
 * NOTE: an EMPTY [role=alert] live region is present on every page of this app, so alert
 * COUNT alone is not an error signal — only a non-empty one is. The prior audit's "six routes
 * rendered a [role=alert] transient" was almost certainly this permanent empty region.
 */
export async function statusOf(page) {
  const txt = (await page.locator("body").innerText().catch(() => "")) || "";
  const alertTexts = (await page.locator('[role="alert"]').allInnerTexts().catch(() => []))
    .map((s) => s.trim()).filter(Boolean);
  const denied = /access denied|not authorised|not authorized|don't have permission|do not have permission/i.test(txt);
  const notFound = /this page doesn't exist|404/i.test(txt);
  const failed = /couldn'?t load|failed to load|something went wrong|try again/i.test(txt);
  const bounced = /sign in to restaurantos|your session expired/i.test(txt) || page.url().includes("/login");
  return { txt, alertTexts, denied, notFound, failed, bounced, bad: failed || alertTexts.length > 0 };
}

/**
 * Loads a route, retrying through transient errors AND re-authenticating when the session
 * is evicted mid-run. Without the re-login, every route after an expiry is a screenshot of
 * the sign-in page filed as a product verdict.
 */
export async function goodGoto(page, url, say, persona = null, tries = 3) {
  let st;
  for (let i = 1; i <= tries; i++) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    st = await statusOf(page);
    if (st.bounced && persona) {
      if (say) say(`   !! SESSION EXPIRED at ${url} — re-authenticating and retrying`);
      await login(page, persona, say);
      continue;
    }
    if (!st.bad) {
      if (i > 1 && say) say(`   (recovered on attempt ${i})`);
      return st;
    }
    if (say) say(`   !! attempt ${i}: alerts=${JSON.stringify(st.alertTexts)} failed=${st.failed} — RETRYING`);
    await page.waitForTimeout(2500);
  }
  if (say) say(`   !! ${url} still degraded after ${tries} attempts`);
  return st;
}

export async function buttons(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("button")).map((b) => (b.textContent || "").trim()).filter(Boolean)
  );
}

/** Pulls a live bearer token out of the page so API probes use the SAME session as the UI. */
export async function tokenFrom(page) {
  return page.evaluate(() => {
    const keys = Object.keys(localStorage);
    for (const k of keys) {
      const v = localStorage.getItem(k) || "";
      if (v.startsWith("eyJ")) return v;
      try {
        const o = JSON.parse(v);
        for (const f of ["accessToken", "token", "access_token", "jwt"]) {
          if (o && typeof o[f] === "string" && o[f].startsWith("eyJ")) return o[f];
        }
        if (o && o.state) {
          for (const f of ["accessToken", "token", "access_token"]) {
            if (typeof o.state[f] === "string" && o.state[f].startsWith("eyJ")) return o.state[f];
          }
        }
      } catch {}
    }
    const m = document.cookie.match(/(?:accessToken|access_token|token)=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  });
}
