/* DIAGNOSIS ONLY — prove the branch switch is lost in the TOKEN, not just the label. */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/branch-management");
mkdirSync(OUT, { recursive: true });
const BASE = "http://localhost:3000";
const P = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };
const HQ = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
const ROOFTOP = "c2d74ade-7ff8-4167-8cd0-131bfbdf4fba";

const log = [];
const rec = (k, v) => { log.push({ k, v }); console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v)); };
const decode = (jwt) => { try { const p = jwt.split(".")[1]; return JSON.parse(Buffer.from(p, "base64url").toString()); } catch { return null; } };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();

const tokens = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!/\/api\/v1\/(auth|branches)/.test(u)) return;
  let body = ""; try { body = await r.text(); } catch { return; }
  const m = body.match(/"accessToken":"([^"]+)"/);
  if (m) {
    const c = decode(m[1]);
    tokens.push({ at: new Date().toISOString(), url: u.replace("http://localhost:8080", ""), status: r.status(), branch_id: c?.branch_id, which: c?.branch_id === HQ ? "HQ" : c?.branch_id === ROOFTOP ? "ROOFTOP" : c?.branch_id });
  }
});

async function label() {
  return page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Switch branch"]');
    const top = document.body.innerText.match(/Floating Terrace[^\n]*/g) || [];
    return { switcher: btn?.innerText?.trim().replace(/\s+/g, " ") ?? null, mentions: [...new Set(top)].slice(0, 5) };
  });
}
/** Ask the app's own cookie-authenticated proxy who we are right now. */
async function whoami() {
  return page.evaluate(async () => {
    const tries = ["/api/v1/auth/me", "/api/v1/users/me", "/api/v1/auth/session"];
    for (const t of tries) {
      try {
        const r = await fetch(t, { credentials: "include" });
        if (r.ok) return { path: t, body: (await r.text()).slice(0, 400) };
      } catch {}
    }
    return null;
  });
}

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
const slug = page.locator('input[name="tenantSlug"], input[id*="tenant" i]').first();
if (await slug.count()) await slug.fill(P.slug).catch(() => {});
await page.locator('input[type="email"], input[name="email"]').first().fill(P.email);
await page.locator('input[type="password"]').first().fill(P.password);
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(3500);
rec("login-tokens", tokens.slice());
rec("label-initial", await label());

// switch
await page.locator('button[aria-label="Switch branch"]').first().click();
await page.waitForTimeout(800);
tokens.length = 0;
await page.locator('[role="menuitem"], [role="menuitemradio"], [role="option"]').filter({ hasText: /Rooftop/i }).first().click();
await page.waitForTimeout(4000);
rec("switch-tokens", tokens.slice());
rec("label-after-switch", await label());

// client-side navigation only (no reload)
tokens.length = 0;
await page.locator('a[href="/app/inventory"]').first().click().catch(async () => {
  await page.locator("nav a", { hasText: "Inventory" }).first().click();
});
await page.waitForTimeout(3000);
rec("label-after-clientnav", await label());
rec("clientnav-tokens", tokens.slice());

// HARD RELOAD
tokens.length = 0;
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(4000);
rec("reload-tokens", tokens.slice());
rec("label-after-reload", await label());
await page.screenshot({ path: resolve(OUT, "sw2-after-reload.png"), fullPage: false });

// what does the shell say the branch is, in the header
rec("header-text", await page.evaluate(() => (document.querySelector("header")?.innerText || "").replace(/\s+/g, " ").slice(0, 200)));

writeFileSync(resolve(OUT, "transcript-switch2.json"), JSON.stringify(log, null, 2));
await browser.close();
