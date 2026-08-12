/*
 * S3 RE-OPEN, part 2 — retiring a role through the button.
 *
 * The register's errand ends at "compose and assign", but a catalogue you can only add to is a
 * catalogue that fills with mistakes. Two cases, both driven:
 *
 *   D1  A role somebody HOLDS is refused, and the refusal counts them — driven through the Delete
 *       button, not through curl, because a list that promises a deletion the write path refuses
 *       is the defect.
 *   D2  A role nobody holds is deleted, and the grid loses it.
 *
 * Run: node e2e/reopen/s3-reopen-delete.mjs
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/S3/reopen");
const SLUG = "floating-terrace";
const OWNER = { email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };

const HELD_ROLE = "Floor Captain";      // has holders from part 1 — must refuse
const THROWAWAY = "Reopen Throwaway";   // nobody holds — must delete

const failures = [];
const notes = [];

function b32(i){const a="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let b=0,v=0;const o=[];for(const c of i.replace(/=+$/,"").toUpperCase()){const x=a.indexOf(c);if(x===-1)continue;v=(v<<5)|x;b+=5;if(b>=8){o.push((v>>>(b-8))&0xff);b-=8;}}return Buffer.from(o);}
function totpNow(s){const t=Math.floor(Date.now()/1000/30);const b=Buffer.alloc(8);b.writeUInt32BE(Math.floor(t/2**32),0);b.writeUInt32BE(t>>>0,4);const h=createHmac("sha1",b32(s)).update(b).digest();const o=h[h.length-1]&0x0f;const c=((h[o]&0x7f)<<24)|((h[o+1]&0xff)<<16)|((h[o+2]&0xff)<<8)|(h[o+3]&0xff);return String(c%1000000).padStart(6,"0");}

async function shot(page, name) { mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: `${OUT}/${name}.png` }); console.log("  shot", name); }
async function bodyText(p) { return p.locator("body").innerText(); }

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(SLUG);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(2500);
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    await totp.first().fill(totpNow(who.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4000);
  }
  return !page.url().includes("/login");
}

async function roleCardCount(page) {
  return page.locator('[data-testid="role-list"] > li').count();
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  if (!(await login(page, OWNER))) { failures.push("owner login failed"); await browser.close(); return report(); }

  await page.goto(`${BASE}/app/roles`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const before = await roleCardCount(page);
  notes.push(`role cards before: ${before}`);

  // ── D1: the HELD role refuses, through the button ─────────────────────────────────────────
  const delHeld = page.getByRole("button", { name: new RegExp(`delete ${HELD_ROLE}`, "i") });
  if (!(await delHeld.count())) {
    failures.push(`no Delete control for "${HELD_ROLE}" — cannot drive the in-use refusal`);
  } else {
    await delHeld.first().click();
    await page.waitForTimeout(1400);
    await shot(page, "20-delete-held-confirm");
    const confirm = page.getByRole("button", { name: /^delete$|delete role|yes, delete/i }).last();
    await confirm.click();
    await page.waitForTimeout(3500);
    const t = await bodyText(page);
    const refused = /still assigned to|Move them to another role/i.test(t);
    if (!refused) failures.push(`deleting "${HELD_ROLE}" was NOT refused although people hold it`);
    notes.push(`in-use refusal shown: ${refused}`);
    const m = t.match(/still assigned to (\d+) (person|people)/i);
    notes.push(`refusal counts: ${m ? m[0] : "no count in the message"}`);
    await shot(page, "21-delete-held-refused");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(900);
    // and it is still there
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    if (!(await bodyText(page)).includes(HELD_ROLE)) {
      failures.push(`"${HELD_ROLE}" disappeared after a refused delete`);
    }
  }

  // ── D2: a role nobody holds is deleted ────────────────────────────────────────────────────
  await page.getByRole("button", { name: /new role/i }).first().click();
  await page.waitForTimeout(1200);
  await page.getByLabel(/role name/i).fill(THROWAWAY);
  const box = page.locator('input[id="build-pos.menu.view"]');
  await box.first().scrollIntoViewIfNeeded();
  await box.first().check();
  await page.getByRole("button", { name: /create role/i }).click();
  await page.waitForTimeout(4000);
  const mid = await roleCardCount(page);
  notes.push(`role cards after creating the throwaway: ${mid}`);
  if (mid !== before + 1) failures.push(`the grid did not grow by one on create (${before} → ${mid})`);

  await page.getByRole("button", { name: new RegExp(`delete ${THROWAWAY}`, "i") }).first().click();
  await page.waitForTimeout(1400);
  const dlg = await bodyText(page);
  notes.push(`unheld delete copy: ${/Nobody holds this role/i.test(dlg) ? "names that nobody holds it" : dlg.slice(0, 160).replace(/\n+/g, " | ")}`);
  await shot(page, "22-delete-unheld-confirm");
  await page.getByRole("button", { name: /^delete$|delete role|yes, delete/i }).last().click();
  await page.waitForTimeout(3500);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const after = await roleCardCount(page);
  notes.push(`role cards after deleting it: ${after}`);
  if ((await bodyText(page)).includes(THROWAWAY)) failures.push(`"${THROWAWAY}" is still in the grid after being deleted`);
  if (after !== before) failures.push(`the grid did not return to its original size (${before} → ${mid} → ${after})`);
  await shot(page, "23-deleted");

  await browser.close();
  return report();
}

function report() {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/s3-reopen-delete.json`, JSON.stringify({ at: new Date().toISOString(), failures, notes }, null, 2));
  console.log("\n──── NOTES ────");
  for (const n of notes) console.log(" ·", n);
  if (failures.length) { console.log("\n──── FAILURES ────"); for (const f of failures) console.log(" ✗", f); process.exitCode = 1; }
  else console.log("\nDelete assertions held.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
