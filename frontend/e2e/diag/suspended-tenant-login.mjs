/**
 * DIAGNOSIS ONLY — what does a SUSPENDED tenant's owner actually see?
 * The suspend dialog promises "Every user is locked out immediately."
 * This drives the real login form while the tenant is SUSPENDED.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/superadmin-platform");
const BASE = "http://localhost:3000";
const GW = "http://localhost:8080";
const TID = "166740c9-b761-43d7-90b1-78edcb34e3d5";
const SLUG = "diag-bistro-696318";
const EMAIL = "owner+696318@diag.local";
const PASS = "Diag#Audit2026";
const SECRET = "SS7VZRP2JD5PQDZIU4LJ2CXFSU6GLJRH";

mkdirSync(OUT, { recursive: true });
const log = [];
const note = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };

function totp() {
  return execSync(`python3 -c "
import hmac,hashlib,struct,time,base64
s=base64.b32decode('${SECRET}'); c=int(time.time())//30
h=hmac.new(s,struct.pack('>Q',c),hashlib.sha1).digest(); o=h[-1]&0xf
print('%06d'%((struct.unpack('>I',h[o:o+4])[0]&0x7fffffff)%1000000))"`).toString().trim();
}
async function saToken() {
  const r = await fetch(`${GW}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "superadmin@softxlogic.com", password: "Test@123!" }) });
  return (await r.json()).data.accessToken;
}
async function setStatus(action) {
  const t = await saToken();
  const r = await fetch(`${GW}/api/v1/platform/tenants/${TID}/${action}`, { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: JSON.stringify({ reason: "diagnostic audit of suspension enforcement" }) });
  note(`  ${action} -> HTTP ${r.status}`);
  const s = await fetch(`${GW}/api/v1/platform/tenants/${TID}`, { headers: { Authorization: `Bearer ${t}` } });
  note("  tenant status now:", (await s.json()).data.status);
}

async function main() {
  note("=== SUSPENDING the tenant ===");
  await setStatus("suspend");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  const api = [];
  page.on("response", (r) => { if (r.url().includes("/api/")) api.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); });

  note("\n=== Owner of a SUSPENDED tenant signs in through the real form ===");
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(SLUG);
  await page.locator('input[name="email"], input#email').first().fill(EMAIL);
  await page.locator('input[name="password"], input#password').first().fill(PASS);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/40-suspended-login-step1.png`, fullPage: true });

  // TOTP step if present
  const otp = page.locator('input[name="totpCode"], input#totpCode, input[autocomplete="one-time-code"]');
  if (await otp.count()) {
    const c = totp();
    note("  TOTP challenge shown; entering", c);
    await otp.first().fill(c);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(5000);
  }
  note("URL after sign-in:", page.url());
  await page.screenshot({ path: `${OUT}/41-suspended-after-login.png`, fullPage: true });
  const body = (await page.locator("body").innerText()).replace(/\s*\n+\s*/g, " | ");
  note("VISIBLE TEXT:", body.slice(0, 1500));
  note("mentions 'suspend':", /suspend/i.test(body));
  const alerts = await page.locator('[role="alert"]').allInnerTexts();
  note("alerts:", JSON.stringify(alerts.map((a) => a.trim()).filter(Boolean)));
  note("\nAPI calls:", JSON.stringify([...new Set(api)].slice(0, 25), null, 1));

  await browser.close();
  note("\n=== restoring tenant to ACTIVE ===");
  await setStatus("reactivate");
  writeFileSync(`${OUT}/suspended-login-log.txt`, log.join("\n"));
}
main().catch(async (e) => { console.error("FATAL", e); writeFileSync(`${OUT}/suspended-login-log.txt`, log.join("\n") + "\nFATAL " + e.message); process.exit(1); });
