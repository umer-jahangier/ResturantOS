/**
 * DIAGNOSIS ONLY — the last step of capability (g): the brand-new tenant's
 * administrator signs in with password + authenticator code and lands in the app.
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
const SEC = "X5GVQ443YQURYHFI42VA6H6Y6BGDFYUD"; // shown on the enrolment screen, 55-totp-enrolment.png

mkdirSync(OUT, { recursive: true });
const log = [];
const note = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
const totp = () => execSync(`python3 -c "
import hmac,hashlib,struct,time,base64
s=base64.b32decode('${SEC}'); c=int(time.time())//30
h=hmac.new(s,struct.pack('>Q',c),hashlib.sha1).digest(); o=h[-1]&0xf
print('%06d'%((struct.unpack('>I',h[o:o+4])[0]&0x7fffffff)%1000000))"`).toString().trim();

async function main() {
  const browser = await chromium.launch();
  const q = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  const api = [];
  q.on("response", (r) => { if (r.url().includes("/api/")) api.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); });

  await q.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await q.waitForTimeout(1500);
  const sl = q.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await sl.count()) await sl.first().fill(SLUG);
  await q.locator('input[name="email"], input#email').first().fill(ADMIN);
  await q.locator('input[name="password"], input#password').first().fill(PW);
  const code = totp();
  const otp = q.locator('input[autocomplete="one-time-code"], input[name*="totp" i], input[name*="code" i], input[inputmode="numeric"]').first();
  if (await otp.count()) { await otp.fill(code); note("entered code", code); }
  await q.locator('button[type="submit"]').first().click();
  await q.waitForTimeout(7000);
  note("URL:", q.url());
  const body = (await q.locator("body").innerText()).replace(/\s*\n+\s*/g, " | ");
  note("SCREEN:", body.slice(0, 1400));
  note("REACHED THE APP:", q.url().includes("/app/"));
  await q.screenshot({ path: `${OUT}/57-onboard-landed.png`, fullPage: true });
  note("\nAPI:", JSON.stringify([...new Set(api)], null, 1));
  writeFileSync(`${OUT}/onboard-land-log.txt`, log.join("\n"));
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); writeFileSync(`${OUT}/onboard-land-log.txt`, log.join("\n") + "\nFATAL " + e.message); process.exit(1); });
