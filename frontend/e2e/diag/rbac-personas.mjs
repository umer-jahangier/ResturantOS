/*
 * DIAGNOSIS ONLY — two personas, two questions.
 *
 * 1. SuperAdmin → /platform/tenants/{id}: does the per-module FEATURE MATRIX actually toggle,
 *    and is it per-tenant, per-role or per-user? (capability e)
 * 2. TENANT_ADMIN (admin@terrace.local, the persona the owner calls "Admin") → /app/users:
 *    can THEY compose a role? Does the role picker differ from OWNER's?
 *
 * The owner's complaint names the ADMIN, and the previous audits all drove the OWNER.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(
  "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/rbac-role-builder",
);
const BASE = "http://localhost:3000";

function base32Decode(input) {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0,
    v = 0;
  const out = [];
  for (const c of input.replace(/=+$/, "").toUpperCase()) {
    const i = a.indexOf(c);
    if (i === -1) continue;
    v = (v << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((v >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totpNow(s) {
  const c = Math.floor(Date.now() / 1000 / 30);
  const b = Buffer.alloc(8);
  b.writeUInt32BE(Math.floor(c / 2 ** 32), 0);
  b.writeUInt32BE(c >>> 0, 4);
  const h = createHmac("sha1", base32Decode(s)).update(b).digest();
  const o = h[h.length - 1] & 0x0f;
  const code =
    ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

async function login(page, { slug, email, password, totpSecret }) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill(slug ?? "");
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3500);
  const t = page.locator('input[name="totpCode"], input#totpCode');
  if ((await t.count()) && totpSecret) {
    await t.first().fill(totpNow(totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4500);
  }
  return !page.url().includes("/login");
}

async function run(browser, label, creds, fn) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  if (!(await login(page, creds))) {
    console.log(`!! ${label} LOGIN FAILED — ${page.url()}`);
    console.log((await page.locator("body").innerText()).slice(0, 400));
    await ctx.close();
    return null;
  }
  console.log(`\n########## ${label} signed in → ${page.url()}`);
  const r = await fn(page);
  await ctx.close();
  return r;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const findings = {};

  // ---------- 1. SuperAdmin: the feature matrix ----------
  findings.superadmin = await run(
    browser,
    "SUPERADMIN",
    { slug: "", email: "superadmin@softxlogic.com", password: "Test@123!" },
    async (page) => {
      await page.goto(`${BASE}/platform/tenants`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4500);
      let body = await page.locator("body").innerText();
      if (/404|could not be found/i.test(body)) {
        await page.screenshot({ path: `${OUT}/platform-tenants-404.png`, fullPage: true });
        return { tenantsList: "404", body: body.slice(0, 500) };
      }
      await page.screenshot({ path: `${OUT}/platform-tenants.png`, fullPage: true });

      // open Floating Terrace
      const link = page.locator("a, button, tr").filter({ hasText: /Floating Terrace/i });
      const out = { tenantsListButtons: (await page.locator("button").allInnerTexts()).slice(0, 20) };
      if (await link.count()) {
        await link.first().click();
        await page.waitForTimeout(5000);
      }
      body = await page.locator("body").innerText();
      const alerts = await page.locator('[role="alert"]').allInnerTexts();
      if (alerts.filter(Boolean).length) {
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(5000);
        body = await page.locator("body").innerText();
        out.retried = true;
      }
      await page.screenshot({ path: `${OUT}/platform-tenant-detail.png`, fullPage: true });
      out.url = page.url();
      out.detailBody = body.slice(0, 3000);
      out.switches = await page.locator('[role="switch"], input[type="checkbox"]').count();

      // Actually flip one and see whether it persists.
      const sw = page.locator('[role="switch"]');
      if (await sw.count()) {
        const first = sw.first();
        const before = await first.getAttribute("aria-checked");
        const labelRow = await first
          .evaluate((el) => el.closest("li,tr,div")?.innerText?.slice(0, 120) ?? "")
          .catch(() => "");
        await first.click();
        await page.waitForTimeout(3500);
        const after = await first.getAttribute("aria-checked");
        out.toggleTest = { row: labelRow, before, after, changed: before !== after };
        await page.screenshot({ path: `${OUT}/platform-feature-toggled.png`, fullPage: true });
        // put it back
        if (before !== after) {
          await first.click();
          await page.waitForTimeout(3000);
        }
      }
      return out;
    },
  );

  // ---------- 2. TENANT_ADMIN: the persona the owner means by "Admin" ----------
  findings.tenantAdmin = await run(
    browser,
    "TENANT_ADMIN",
    {
      slug: "floating-terrace",
      email: "admin@terrace.local",
      password: "Terrace#Admin1",
      totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS",
    },
    async (page) => {
      const out = {};
      for (const route of ["/app/users", "/app/settings", "/app/roles"]) {
        await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(4500);
        const body = await page.locator("body").innerText();
        out[route] = {
          is404: /404|could not be found/i.test(body),
          denied: /Access denied|do not have permission/i.test(body),
        };
        await page.screenshot({
          path: `${OUT}/admin${route.replace(/\//g, "_")}.png`,
          fullPage: true,
        });
      }
      // the role picker as TENANT_ADMIN — does the ceiling hide OWNER?
      await page.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4500);
      const row = page.locator("button").filter({ hasText: "manager@terrace" });
      if (await row.count()) {
        await row.first().click();
        await page.waitForTimeout(3000);
      }
      const assign = page.locator("button").filter({ hasText: /assign role/i });
      out.hasAssignButton = (await assign.count()) > 0;
      if (out.hasAssignButton) {
        await assign.first().click();
        await page.waitForTimeout(2500);
        out.dialogWidth = (await page.locator('[role="dialog"]').first().boundingBox())?.width;
        out.roleOptions = await page.locator('[role="dialog"] select option').allInnerTexts();
        out.checkboxes = await page.locator('[role="dialog"] input[type="checkbox"]').count();
        out.dialogText = await page.locator('[role="dialog"]').first().innerText();
        await page.screenshot({ path: `${OUT}/admin-assign-role-dialog.png`, fullPage: true });
      }
      // can the admin reach the platform feature matrix?
      await page.goto(`${BASE}/platform/tenants`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);
      const pb = await page.locator("body").innerText();
      out.platformReach = {
        url: page.url(),
        is404: /404|could not be found/i.test(pb),
        denied: /Access denied|do not have permission|sign in/i.test(pb),
        first200: pb.slice(0, 200),
      };
      await page.screenshot({ path: `${OUT}/admin-platform-attempt.png`, fullPage: true });
      return out;
    },
  );

  writeFileSync(`${OUT}/persona-findings.json`, JSON.stringify(findings, null, 2));
  console.log("\n\n=========== SUMMARY ===========");
  console.log(JSON.stringify(findings, null, 2).slice(0, 6000));
  await browser.close();
}
main();
