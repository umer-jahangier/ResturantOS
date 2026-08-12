/*
 * S3 addendum — retiring a role, driven through the BUTTON rather than through curl.
 *
 * <p>The main harness proves create, read, assign, edit and the ceiling. Delete was proved only at
 * the API (409 `ROLE_IN_USE` while held, 204 once free), and an API-proved control with an
 * unclicked button is exactly the "structurally present, behaviourally absent" shape this
 * engagement exists to stop shipping. So this creates a throwaway role in the UI and deletes it in
 * the UI, and asserts the list shrinks back.
 *
 * Run: node e2e/s3-roles-delete.mjs
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/S3");
const OWNER = {
  email: "owner@terrace.local",
  password: "Terrace#Owner1",
  totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
};
const NAME = `Scrap Role ${Date.now().toString().slice(-5)}`;
const failures = [];

function b32(input) {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const c of input.replace(/=+$/, "").toUpperCase()) {
    const i = a.indexOf(c);
    if (i === -1) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(s) {
  const ctr = Math.floor(Date.now() / 1000 / 30);
  const b = Buffer.alloc(8);
  b.writeUInt32BE(Math.floor(ctr / 2 ** 32), 0);
  b.writeUInt32BE(ctr >>> 0, 4);
  const h = createHmac("sha1", b32(s)).update(b).digest();
  const o = h[h.length - 1] & 0x0f;
  const c = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(c % 1_000_000).padStart(6, "0");
}
async function shot(page, name) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log("  shot", `${name}.png`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

for (let attempt = 1; attempt <= 3; attempt++) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill("floating-terrace");
  await page.locator('input[name="email"], input#email').first().fill(OWNER.email);
  await page.locator('input[name="password"], input#password').first().fill(OWNER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(2500);
  const t = page.locator('input[name="totpCode"], input#totpCode');
  if (await t.count()) {
    await t.first().fill(totp(OWNER.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4000);
  }
  if (!page.url().includes("/login")) break;
  if (attempt === 3) failures.push("owner login failed");
  await page.waitForTimeout(2500);
}

await page.goto(`${BASE}/app/roles`, { waitUntil: "domcontentloaded" });
await page.locator('[data-testid="role-list"]').first().waitFor({ state: "visible", timeout: 90_000 });
const before = await page.locator('[data-testid="role-list"] > li').count();

await page.getByRole("button", { name: /new role/i }).first().click();
await page.waitForTimeout(1000);
await page.getByLabel(/role name/i).fill(NAME);
await page.locator('input[id="build-pos.order.view"]').first().scrollIntoViewIfNeeded();
await page.locator('input[id="build-pos.order.view"]').first().check();
await page.getByRole("button", { name: /create role/i }).click();
await page.waitForTimeout(3500);

const midway = await page.locator('[data-testid="role-list"] > li').count();
if (midway !== before + 1) failures.push(`create did not add a row: ${before} → ${midway}`);

await page.getByRole("button", { name: new RegExp(`delete ${NAME}`, "i") }).first().click();
await page.waitForTimeout(1200);
const confirmText = await page.locator("body").innerText();
if (!/Nobody holds this role/i.test(confirmText)) {
  failures.push("the delete confirmation did not say nobody holds the role");
}
await shot(page, "18-delete-confirmation");
await page.getByRole("button", { name: /^delete role$/i }).click();
await page.waitForTimeout(3500);

const after = await page.locator('[data-testid="role-list"] > li').count();
// Scoped to the LIST, not to the body. The success toast reads "Deleted Scrap Role 22247" and
// contains the name, so a body-wide check reported the role as still present while the grid had
// already dropped it — the harness lying about a working product, which is the same class of
// error as a harness lying about a broken one.
const listed = await page.locator('[data-testid="role-list"]').innerText();
if (listed.includes(NAME)) failures.push(`"${NAME}" is still listed after deleting it`);
if (after !== before) failures.push(`the list did not return to its previous size: ${before} → ${after}`);
await shot(page, "19-role-deleted");

console.log(`rows: before=${before} afterCreate=${midway} afterDelete=${after}`);
await browser.close();
if (failures.length) {
  for (const f of failures) console.log("  ✗", f);
  process.exitCode = 1;
} else {
  console.log("Delete driven through the UI: created, refused nothing, removed, list restored.");
}
