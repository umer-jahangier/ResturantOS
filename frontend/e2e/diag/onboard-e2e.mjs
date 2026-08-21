/**
 * DIAGNOSIS ONLY — capability (g): onboard a brand-new restaurant end to end,
 * with NO developer and NO script. SuperAdmin creates the tenant in the console,
 * then the new administrator signs in through the real login form with the
 * temporary password the console handed over. Nothing else is allowed.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/superadmin-platform");
const BASE = "http://localhost:3000";
const STAMP = Date.now().toString().slice(-6);
const BRAND = `Onboard Test ${STAMP}`;
const ADMIN = `admin+${STAMP}@onboard.local`;

mkdirSync(OUT, { recursive: true });
const log = [];
const note = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };

async function main() {
  const browser = await chromium.launch();

  // ---- SuperAdmin provisions ----
  const sa = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const p = await sa.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1500);
  await p.locator('input[name="email"], input#email').first().fill("superadmin@softxlogic.com");
  await p.locator('input[name="password"], input#password').first().fill("Test@123!");
  await p.locator('button[type="submit"]').first().click();
  await p.waitForTimeout(5000);
  await p.locator('nav[aria-label="Platform"] a[href="/platform/tenants"]').click();
  await p.waitForTimeout(3500);
  await p.locator("main button", { hasText: /create tenant/i }).first().click();
  await p.waitForTimeout(1500);
  const d = p.locator('[role="dialog"]').first();
  await d.locator("#brand-name").fill(BRAND);
  await d.locator("#admin-email").fill(ADMIN);
  await d.locator("select#tier").selectOption("GROWTH");
  await d.locator("button", { hasText: /^create tenant$/i }).click();
  await p.waitForTimeout(8000);

  const result = p.locator('[role="dialog"]').first();
  const txt = await result.innerText().catch(() => "");
  note("=== provisioning result dialog ===\n" + txt);
  const pw = (txt.match(/Temporary password\s*\n?\s*(\S+)/) || [])[1];
  const slug = (txt.match(/tenant=([a-z0-9-]+)/) || [])[1] || (txt.match(/^(\S+) provisioned/m) || [])[1];
  note("parsed temp password:", pw, "| slug:", slug);
  await p.screenshot({ path: `${OUT}/50-onboard-provisioned.png`, fullPage: true });

  // ---- The new administrator signs in. Browser only. ----
  note("\n=== the new administrator signs in through the real form ===");
  const t = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const q = await t.newPage();
  const api = [];
  q.on("response", (r) => { if (r.url().includes("/api/")) api.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); });
  await q.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await q.waitForTimeout(1500);
  const sl = q.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await sl.count()) await sl.first().fill(slug);
  await q.locator('input[name="email"], input#email').first().fill(ADMIN);
  await q.locator('input[name="password"], input#password').first().fill(pw);
  await q.locator('button[type="submit"]').first().click();
  await q.waitForTimeout(6000);
  note("URL:", q.url());
  await q.screenshot({ path: `${OUT}/51-onboard-first-login.png`, fullPage: true });
  const body = (await q.locator("body").innerText()).replace(/\s*\n+\s*/g, " | ");
  note("SCREEN:", body.slice(0, 1200));
  note("alerts:", JSON.stringify((await q.locator('[role="alert"]').allInnerTexts()).map(s=>s.trim()).filter(Boolean)));
  note("\nAPI:", JSON.stringify([...new Set(api)], null, 1));

  // Is there a password-change screen the user can actually complete?
  const pwFields = await q.locator('input[type="password"]').count();
  note("password inputs on screen:", pwFields);
  const qr = await q.locator('img[alt*="QR" i], canvas, svg[role="img"]').count();
  note("QR-ish elements (TOTP enrolment):", qr);

  writeFileSync(`${OUT}/onboard-log.txt`, log.join("\n"));
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); writeFileSync(`${OUT}/onboard-log.txt`, log.join("\n") + "\nFATAL " + e.message); process.exit(1); });
