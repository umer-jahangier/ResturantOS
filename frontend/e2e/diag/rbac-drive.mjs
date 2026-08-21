/*
 * DIAGNOSIS ONLY — drive the ONLY RBAC surface that exists, as OWNER.
 *
 * Answers, by clicking:
 *   (b) is there a permission-ticking catalogue anywhere in the role flow?
 *   (c) does any screen say what a permission MEANS?
 *   (d) is a role assignment scoped to a branch?
 *   (g) is there a clone / edit / deactivate control for a ROLE (not a user)?
 *
 * Also re-checks the 24px dialog regression: every dialog's rendered width is measured.
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
async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(OWNER.slug);
  await page.locator('input[name="email"], input#email').first().fill(OWNER.email);
  await page.locator('input[name="password"], input#password').first().fill(OWNER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  const t = page.locator('input[name="totpCode"], input#totpCode');
  if (await t.count()) {
    await t.first().fill(totpNow(OWNER.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4500);
  }
  return !page.url().includes("/login");
}

async function dialogInfo(page) {
  const d = page.locator('[role="dialog"]');
  if (!(await d.count())) return { present: false };
  const box = await d.first().boundingBox();
  const text = await d.first().innerText();
  const inputs = await d.first().locator("input, select, textarea").count();
  const checkboxes = await d.first().locator('input[type="checkbox"]').count();
  return { present: true, width: box?.width, height: box?.height, checkboxes, inputs, text };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  const findings = {};

  if (!(await login(page))) {
    console.log("LOGIN FAILED", page.url());
    process.exit(1);
  }

  // --- what the roles catalogue API actually hands the UI, fetched by the browser itself ---
  const catalogs = await page.evaluate(async () => {
    const get = async (p) => {
      try {
        const r = await fetch(p, { credentials: "include" });
        return { status: r.status, body: await r.text() };
      } catch (e) {
        return { status: "ERR", body: String(e) };
      }
    };
    return {
      roles: await get("/api/proxy/api/v1/roles"),
      permissions: await get("/api/proxy/api/v1/permissions"),
    };
  });
  findings.catalogs = catalogs;
  console.log("GET /api/v1/roles       →", catalogs.roles.status);
  console.log("GET /api/v1/permissions →", catalogs.permissions.status);

  await page.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);

  // --- (g) is there ANY role-level control on this screen? ---
  const bodyText = await page.locator("body").innerText();
  findings.usersPageMentions = {
    createRole: /create (a )?role|new role|add role/i.test(bodyText),
    cloneRole: /clone|duplicate/i.test(bodyText),
    permissionWord: /permission/i.test(bodyText),
    feature: /feature/i.test(bodyText),
  };
  const buttons = await page.locator("button").allInnerTexts();
  findings.usersPageButtons = [...new Set(buttons.map((b) => b.trim()).filter(Boolean))];
  console.log("\nBUTTONS ON /app/users:", JSON.stringify(findings.usersPageButtons));

  // --- open a user, look at the detail panel ---
  const row = page.locator('button, [role="button"], tr').filter({ hasText: "manager@terrace" });
  if (await row.count()) {
    await row.first().click();
    await page.waitForTimeout(3500);
  }
  const panel = await page.locator("body").innerText();
  findings.detailPanelText = panel.slice(panel.indexOf("Users"), panel.indexOf("Users") + 3000);
  await page.screenshot({ path: `${OUT}/user-detail-panel.png`, fullPage: true });

  // does the detail panel name any permission code?
  findings.detailShowsPermissionCodes = /rbac\.|pos\.|finance\.|inventory\./.test(panel);
  console.log("detail panel names permission codes:", findings.detailShowsPermissionCodes);

  // --- (d) the assign-role dialog ---
  const assignBtn = page.locator("button").filter({ hasText: /assign|change role|role/i });
  console.log("role-ish buttons:", await assignBtn.allInnerTexts());
  if (await assignBtn.count()) {
    await assignBtn.first().click();
    await page.waitForTimeout(2500);
    findings.assignRoleDialog = await dialogInfo(page);
    await page.screenshot({ path: `${OUT}/assign-role-dialog.png`, fullPage: true });
    console.log(
      "\nASSIGN-ROLE DIALOG width=",
      findings.assignRoleDialog.width,
      "checkboxes=",
      findings.assignRoleDialog.checkboxes,
    );
    console.log(findings.assignRoleDialog.text);
    // what does the role <select> offer, and does anything explain a role?
    const opts = await page.locator('[role="dialog"] select option').allInnerTexts();
    findings.assignRoleOptions = opts;
    console.log("ROLE OPTIONS:", JSON.stringify(opts));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);
  }

  // --- the Add user dialog: is a role composed here? ---
  const addBtn = page.locator("button").filter({ hasText: /add user/i });
  if (await addBtn.count()) {
    await addBtn.first().click();
    await page.waitForTimeout(2500);
    findings.addUserDialog = await dialogInfo(page);
    await page.screenshot({ path: `${OUT}/add-user-dialog.png`, fullPage: true });
    console.log(
      "\nADD-USER DIALOG width=",
      findings.addUserDialog.width,
      "checkboxes=",
      findings.addUserDialog.checkboxes,
    );
    console.log(findings.addUserDialog.text);
    const opts = await page.locator('[role="dialog"] select option').allInnerTexts();
    findings.addUserOptions = opts;
    console.log("SELECT OPTIONS:", JSON.stringify(opts));
    await page.keyboard.press("Escape");
  }

  writeFileSync(`${OUT}/drive-findings.json`, JSON.stringify(findings, null, 2));
  await browser.close();
  console.log("\nevidence →", OUT);
}
main();
