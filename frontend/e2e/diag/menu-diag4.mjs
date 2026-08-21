/*
 * DIAGNOSIS part 4:
 *  A) does 86-ing an item propagate to a POS that is ALREADY OPEN (two live browser contexts)?
 *  B) does the item edit dialog round-trip an existing picture (Replace/Remove, not "Upload")?
 *  C) can a recipe be authored end to end and does a plate cost appear?
 *  D) does the POS Terminals screen scope the till's menu, and does the till honour it?
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/menu-management";
const BASE = "http://localhost:3000";
const VICTIM = "Butter Naan";
const PHOTO = "Photo Dish 50585";

const OWNER = { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" };
const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };
const log = []; const say = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
async function shot(p, n) { mkdirSync(OUT, { recursive: true }); await p.screenshot({ path: `${OUT}/${n}.png` }); say("  shot:", n + ".png"); }
function b32(i){const A="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";let b=0,v=0;const o=[];for(const c of i.replace(/=+$/,"").toUpperCase()){const x=A.indexOf(c);if(x<0)continue;v=(v<<5)|x;b+=5;if(b>=8){o.push((v>>>(b-8))&255);b-=8;}}return Buffer.from(o);}
function totp(s){const c=Math.floor(Date.now()/1000/30);const b=Buffer.alloc(8);b.writeUInt32BE(Math.floor(c/2**32),0);b.writeUInt32BE(c>>>0,4);const h=createHmac("sha1",b32(s)).update(b).digest();const o=h[h.length-1]&15;return String((((h[o]&127)<<24)|((h[o+1]&255)<<16)|((h[o+2]&255)<<8)|(h[o+3]&255))%1e6).padStart(6,"0");}
async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug'); if (await s.count()) await s.first().fill(who.slug);
  await page.locator('input[name="email"]').first().fill(who.email);
  await page.locator('input[name="password"]').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(3500);
  const t = page.locator('input[name="totpCode"], input#totpCode');
  if (await t.count() && who.totpSecret) { await t.first().fill(totp(who.totpSecret)); await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(5000); }
  return !page.url().includes("/login");
}

async function main() {
  const browser = await chromium.launch();

  // ---- cashier keeps a POS open the whole time ----
  const cctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const cash = await cctx.newPage();
  if (!(await login(cash, CASHIER))) { say("FATAL cashier login"); await browser.close(); return; }
  await cash.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" }); await cash.waitForTimeout(9000);
  const before = await cash.locator("body").innerText();
  say(`A) cashier POS open. grid contains "${VICTIM}" BEFORE 86 = ` + before.includes(VICTIM));
  await shot(cash, "40-cashier-before-86");

  // ---- owner 86s it ----
  const octx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const own = await octx.newPage();
  if (!(await login(own, OWNER))) { say("FATAL owner login"); await browser.close(); return; }
  await own.goto(`${BASE}/app/menu/items`, { waitUntil: "domcontentloaded" }); await own.waitForTimeout(7000);
  const act = own.getByRole("button", { name: new RegExp(`Actions for ${VICTIM}`) }).first();
  if (await act.count()) {
    await act.click(); await own.waitForTimeout(1000);
    await own.getByRole("menuitem", { name: /Deactivate/i }).first().click(); await own.waitForTimeout(6000);
    say("  owner deactivated " + VICTIM + " — toast: " + JSON.stringify(await own.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])));
    await shot(own, "41-owner-86ed");
  } else say("  ! could not find the actions button for " + VICTIM);

  // ---- does the cashier's OPEN till see it disappear? ----
  for (const wait of [5000, 10000, 20000]) {
    await cash.waitForTimeout(wait);
    const now = await cash.locator("body").innerText();
    say(`  cashier grid still shows "${VICTIM}" after ~${wait / 1000}s (no reload) = ` + now.includes(VICTIM));
    if (!now.includes(VICTIM)) break;
  }
  await shot(cash, "42-cashier-after-86-noreload");
  await cash.reload({ waitUntil: "domcontentloaded" }); await cash.waitForTimeout(9000);
  const afterReload = await cash.locator("body").innerText();
  say(`  cashier grid shows "${VICTIM}" AFTER a manual reload = ` + afterReload.includes(VICTIM));
  await shot(cash, "43-cashier-after-86-reloaded");

  // restore
  await own.reload({ waitUntil: "domcontentloaded" }); await own.waitForTimeout(6000);
  const showInactive = own.locator('input[type="checkbox"]').first();
  if (await showInactive.count()) { await showInactive.check(); await own.waitForTimeout(3000); }
  const act2 = own.getByRole("button", { name: new RegExp(`Actions for ${VICTIM}`) }).first();
  if (await act2.count()) { await act2.click(); await own.waitForTimeout(900); await own.getByRole("menuitem", { name: /Reactivate/i }).first().click(); await own.waitForTimeout(5000); say("  restored " + VICTIM); }

  // ---- B) picture round-trip on edit ----
  await own.goto(`${BASE}/app/menu/items`, { waitUntil: "domcontentloaded" }); await own.waitForTimeout(7000);
  const pact = own.getByRole("button", { name: new RegExp(`Actions for ${PHOTO}`) }).first();
  if (await pact.count()) {
    await pact.click(); await own.waitForTimeout(900);
    await own.getByRole("menuitem", { name: /^Edit$/ }).first().click(); await own.waitForTimeout(4000);
    const d = own.locator('[role="dialog"]').first();
    const txt = await d.innerText();
    say("B) EDIT dialog for an item WITH a picture:\n" + txt.split("\n").map(l => "    " + l).join("\n"));
    say("  shows Replace/Remove (picture round-tripped) = " + /Replace/.test(txt));
    const dimg = await d.locator("img").count();
    say("  <img> preview inside the edit dialog = " + dimg);
    await shot(own, "44-edit-dialog-with-picture");
    await own.keyboard.press("Escape"); await own.waitForTimeout(800);
  }

  // ---- C) recipe authoring end to end ----
  await own.goto(`${BASE}/app/inventory/recipes`, { waitUntil: "domcontentloaded" }); await own.waitForTimeout(8000);
  await shot(own, "45-recipes-page");
  const rb = await own.locator("body").innerText();
  say("C) recipes page mentions plate cost / food cost % / margin = " +
    JSON.stringify({ plateCost: /plate cost/i.test(rb), foodCostPct: /food cost/i.test(rb), margin: /margin/i.test(rb), coverage: /coverage/i.test(rb) }));
  // open Chicken Karahi's recipe detail
  const link = own.getByRole("link", { name: /Chicken Karahi/i }).first();
  const cell = own.getByText("Chicken Karahi", { exact: true }).first();
  if (await link.count()) { await link.click(); }
  else if (await cell.count()) { await cell.click(); }
  await own.waitForTimeout(8000);
  say("  recipe detail URL: " + own.url());
  await shot(own, "46-recipe-detail");
  const rd = await own.locator("body").innerText();
  say("  RECIPE DETAIL:\n" + rd.split("\n").slice(50, 130).map(l => "    " + l).join("\n"));

  // ---- D) POS terminals screen ----
  await own.goto(`${BASE}/app/pos-terminals`, { waitUntil: "domcontentloaded" }); await own.waitForTimeout(4000);
  if ((await own.locator("body").innerText()).includes("404")) {
    await own.goto(`${BASE}/app/terminals`, { waitUntil: "domcontentloaded" }); await own.waitForTimeout(4000);
  }
  say("D) POS terminals URL tried: " + own.url());
  await shot(own, "47-pos-terminals");
  say("  terminals body:\n" + (await own.locator("body").innerText()).split("\n").slice(48, 110).map(l => "    " + l).join("\n"));

  writeFileSync(`${OUT}/RUN-LOG-4.txt`, log.join("\n"));
  await browser.close();
}
main();
