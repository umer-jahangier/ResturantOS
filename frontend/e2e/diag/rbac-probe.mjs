/*
 * DIAGNOSIS ONLY — Admin: roles, permissions and feature gating.
 *
 * Signs in as the OWNER (the only tenant persona holding `rbac.manage`) and asks, for each
 * route, three questions the previous audits did not:
 *   1. did it render at all, or is it a 404 / error / access-denied?
 *   2. is the body an [role="alert"] failure that would photograph as an "empty product"?
 *   3. what is actually on it?
 *
 * Every route gets its body text dumped so a verdict rests on observed text, not on a picture.
 */
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
  totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
};

// Every plausible home for a role builder. If none of these render a screen, there is no screen.
const ROUTES = [
  "/app/users",
  "/app/settings",
  "/app/roles",
  "/app/settings/roles",
  "/app/settings/users",
  "/app/settings/permissions",
  "/app/permissions",
  "/app/settings/features",
  "/app/admin/roles",
  "/settings/appearance",
];

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

function totpNow(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(OWNER.slug);
  await page.locator('input[name="email"], input#email').first().fill(OWNER.email);
  await page.locator('input[name="password"], input#password').first().fill(OWNER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    await totp.first().fill(totpNow(OWNER.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4500);
  }
  return !page.url().includes("/login");
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  const report = [];

  if (!(await login(page))) {
    console.log("LOGIN FAILED — url:", page.url());
    const body = await page.locator("body").innerText();
    console.log(body.slice(0, 800));
    await page.screenshot({ path: `${OUT}/LOGIN-FAILED.png` });
    await browser.close();
    process.exit(1);
  }
  console.log("signed in as OWNER →", page.url());

  // What does the sidebar actually offer? This is the "can an admin FIND it" question.
  const navText = await page
    .locator("nav, aside")
    .first()
    .innerText()
    .catch(() => "(no nav)");
  writeFileSync(`${OUT}/sidebar-nav.txt`, navText);
  console.log("\n=== SIDEBAR ===\n" + navText + "\n");

  for (const route of ROUTES) {
    let status = "?";
    page.once("response", (r) => {
      if (r.url().endsWith(route)) status = r.status();
    });
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);

    const body = await page.locator("body").innerText();
    const alerts = await page.locator('[role="alert"]').allInnerTexts();
    const is404 = /404|could not be found|not be found/i.test(body);
    const denied = /Access denied|do not have permission|Forbidden/i.test(body);
    const slug = route.replace(/\//g, "_").replace(/^_/, "");

    // A page that failed to load is retried once — an error state photographs as an empty product.
    let retried = false;
    if (alerts.length && !is404 && !denied) {
      retried = true;
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);
    }
    const finalBody = await page.locator("body").innerText();
    const finalAlerts = await page.locator('[role="alert"]').allInnerTexts();

    await page.screenshot({ path: `${OUT}/route${slug}.png`, fullPage: true });
    report.push({
      route,
      status,
      is404,
      denied,
      retried,
      alerts: finalAlerts,
      body: finalBody.slice(0, 2500),
    });
    console.log(
      `${route.padEnd(30)} 404=${is404} denied=${denied} alerts=${finalAlerts.length} retried=${retried}`,
    );
  }

  writeFileSync(`${OUT}/route-probe.json`, JSON.stringify(report, null, 2));
  await browser.close();
  console.log("\nevidence →", OUT);
}

main();
