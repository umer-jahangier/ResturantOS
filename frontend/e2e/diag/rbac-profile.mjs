/* DIAGNOSIS ONLY — the one screen in the product that mentions permissions to a human. */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(
  "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/rbac-role-builder",
);
const BASE = "http://localhost:3000";
const OWNER = {
  slug: "floating-terrace",
  email: "owner@terrace.local",
  password: "Terrace#Owner1",
  secret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
};

function b32(i) {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, v = 0; const o = [];
  for (const c of i.toUpperCase()) {
    const x = a.indexOf(c); if (x === -1) continue;
    v = (v << 5) | x; bits += 5;
    if (bits >= 8) { o.push((v >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(o);
}
function totp(s) {
  const c = Math.floor(Date.now() / 1000 / 30);
  const b = Buffer.alloc(8);
  b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4);
  const h = createHmac("sha1", b32(s)).update(b).digest();
  const o = h[h.length - 1] & 0x0f;
  return String(((((h[o] & 0x7f) << 24) | (h[o+1] << 16) | (h[o+2] << 8) | h[o+3]) >>> 0) % 1e6).padStart(6, "0");
}

const main = async () => {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill(OWNER.slug);
  await page.locator("input#email, input[name=email]").first().fill(OWNER.email);
  await page.locator("input#password, input[name=password]").first().fill(OWNER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  const t = page.locator('input[name="totpCode"], input#totpCode');
  if (await t.count()) {
    await t.first().fill(totp(OWNER.secret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(5000);
  }
  await page.goto(`${BASE}/app/profile`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const body = await page.locator("body").innerText();
  const i = body.indexOf("Permissions");
  const excerpt = body.slice(Math.max(0, i - 500), i + 400);
  console.log("=== /app/profile ===\n" + excerpt);
  console.log("\nnames any permission code:", /rbac\.|pos\.order|finance\./.test(body));
  await page.screenshot({ path: `${OUT}/profile-permissions.png`, fullPage: true });
  writeFileSync(`${OUT}/profile.json`, JSON.stringify({ excerpt, namesCodes: /rbac\.|pos\.order/.test(body) }, null, 2));
  await browser.close();
};
main();
