/**
 * DIAGNOSIS ONLY — final onboarding step: complete TOTP enrolment in the browser
 * and confirm the brand-new tenant administrator reaches a working app.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/superadmin-platform");
const BASE = "http://localhost:3000";
const SLUG = "onboard-test-479550";
const ADMIN = "admin+479550@onboard.local";
const PW = "Onboard#Audit2026";

mkdirSync(OUT, { recursive: true });
const log = [];
const note = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const totp = (sec) => execSync(`python3 -c "
import hmac,hashlib,struct,time,base64
s=base64.b32decode('${sec}'); c=int(time.time())//30
h=hmac.new(s,struct.pack('>Q',c),hashlib.sha1).digest(); o=h[-1]&0xf
print('%06d'%((struct.unpack('>I',h[o:o+4])[0]&0x7fffffff)%1000000))"`).toString().trim();

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const q = await ctx.newPage();
  const api = [];
  q.on("response", (r) => { if (r.url().includes("/api/")) api.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); });

  await q.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await q.waitForTimeout(1500);
  const sl = q.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await sl.count()) await sl.first().fill(SLUG);
  await q.locator('input[name="email"], input#email').first().fill(ADMIN);
  await q.locator('input[name="password"], input#password').first().fill(PW);
  await q.locator('button[type="submit"]').first().click();
  await q.waitForTimeout(5000);

  const gen = q.locator("button", { hasText: /generate my key/i }).first();
  if (await gen.count()) { await gen.click(); await q.waitForTimeout(4000); }
  {
    await q.screenshot({ path: `${OUT}/55-totp-enrolment.png`, fullPage: true });
    const body = await q.locator("body").innerText();
    note("ENROLMENT SCREEN:\n" + body.replace(/\s*\n+\s*/g, " | ").slice(0, 1200));
    const grouped = body.match(/((?:[A-Z2-7]{4}\s+){5,}[A-Z2-7]{4})/);
    const sec = grouped ? grouped[1].replace(/\s+/g, "") : (body.match(/\b([A-Z2-7]{16,64})\b/) || [])[1];
    note("secret shown on screen:", sec ? `${sec.slice(0, 8)}… (${sec.length} chars)` : "NOT FOUND");
    note("QR image present:", await q.locator('img[alt*="QR" i], canvas, svg').count());
    if (sec) {
      const code = totp(sec);
      note("entering code", code);
      const otp = q.locator('input[autocomplete="one-time-code"], input[name*="code" i], input[inputmode="numeric"]').first();
      await otp.fill(code);
      await q.locator('button[type="submit"], button', { hasText: /verify|confirm|enable|finish|activate/i }).first().click();
      await q.waitForTimeout(7000);
      note("URL:", q.url());
      const b2 = (await q.locator("body").innerText()).replace(/\s*\n+\s*/g, " | ");
      note("AFTER VERIFY:", b2.slice(0, 900));
      await q.screenshot({ path: `${OUT}/56-onboard-complete.png`, fullPage: true });
      note("REACHED THE APP:", q.url().includes("/app/"));
    }
  }

  note("\nAPI:", JSON.stringify([...new Set(api)], null, 1));
  writeFileSync(`${OUT}/onboard-totp-log.txt`, log.join("\n"));
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); writeFileSync(`${OUT}/onboard-totp-log.txt`, log.join("\n") + "\nFATAL " + e.message); process.exit(1); });
