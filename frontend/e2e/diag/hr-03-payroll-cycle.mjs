/* Pass 3: THE question — can an owner complete a full payroll cycle from screens? */
import { newBrowser, ctxPage, login, visit, shot, PERSONAS } from "./hr-lib.mjs";

const browser = await newBrowser();
const { page } = await ctxPage(browser);
page.on("response", async (r) => {
  const u = r.url();
  if (u.includes("/api/v1/hr/") && r.request().method() !== "GET") {
    let body = "";
    try { body = (await r.text()).slice(0, 400); } catch {}
    console.log(`    NET ${r.request().method()} ${u.replace("http://localhost:3000","")} -> ${r.status()} ${body}`);
  }
  if (u.includes("/api/v1/hr/") && r.status() >= 400) {
    console.log(`    NET-ERR GET ${u.replace("http://localhost:3000","")} -> ${r.status()}`);
  }
});
await login(page, PERSONAS.owner);

// ---------- Step 1: the tax table for the CURRENT fiscal year ----------
console.log("\n########## STEP 1: tax table FY2027 ##########");
await visit(page, "/app/hr/settings/tax");
let body = await page.locator("body").innerText();
console.log("banner:", body.match(/Payroll cannot run yet[^\n]*/)?.[0] ?? "(none)");

// Pakistan FY2026-27 salaried slabs, in rupees of ANNUAL taxable income.
const BANDS = [
  { from: "0",       to: "600000",  fixed: "0",      rate: "0" },
  { from: "600000",  to: "1200000", fixed: "0",      rate: "1" },
  { from: "1200000", to: "2200000", fixed: "6000",   rate: "11" },
  { from: "2200000", to: "3200000", fixed: "116000", rate: "23" },
  { from: "3200000", to: "4100000", fixed: "346000", rate: "30" },
  { from: "4100000", to: "",        fixed: "616000", rate: "35" },
];

const addBand = page.getByRole("button", { name: /Add band/i });
for (let i = 1; i < BANDS.length; i++) await addBand.click();
await page.waitForTimeout(500);

const rows = page.locator("tbody tr, table tr").filter({ has: page.locator("input") });
console.log("band rows on screen:", await rows.count());
for (let i = 0; i < BANDS.length; i++) {
  const r = rows.nth(i);
  const inputs = r.locator("input");
  const n = await inputs.count();
  if (n < 4) { console.log(`  !! band row ${i} has ${n} inputs`); continue; }
  await inputs.nth(0).fill(BANDS[i].from);
  await inputs.nth(1).fill(BANDS[i].to);
  await inputs.nth(2).fill(BANDS[i].fixed);
  await inputs.nth(3).fill(BANDS[i].rate);
}
// EOBI / surcharge
async function setByLabel(label, value) {
  const el = page.getByLabel(new RegExp(label, "i"));
  if ((await el.count()) === 0) { console.log(`  !! no field labelled ${label}`); return; }
  await el.first().fill(value);
}
await setByLabel("Surcharge starts above", "10000000");
await setByLabel("Surcharge rate", "9");
await setByLabel("EOBI employer", "5");
await setByLabel("EOBI employee", "1");
await setByLabel("EOBI wage base", "37000");
const inForce = page.getByLabel(/In force/i);
if (await inForce.count()) await inForce.first().check().catch(() => {});
else await page.locator('input[type="checkbox"]').last().check().catch(() => {});
await shot(page, "03-tax-filled");
await page.getByRole("button", { name: /Save FY2027/i }).click();
await page.waitForTimeout(3500);
body = await page.locator("body").innerText();
console.log("after save, banner:", body.match(/Payroll cannot run yet[^\n]*/)?.[0] ?? "(gone)");
console.log("errors on screen:", (await page.locator('[role="alert"]').allInnerTexts()).filter(Boolean).join(" | "));
await shot(page, "03-tax-saved");

// ---------- Step 2: calculate the run ----------
console.log("\n########## STEP 2: calculate ##########");
await visit(page, "/app/hr/payroll");
await shot(page, "03-payroll-before");
const calc = page.getByRole("button", { name: /^Calculate$/ });
console.log("Calculate buttons:", await calc.count());
if (await calc.count()) {
  await calc.first().click();
  await page.waitForTimeout(5000);
}
body = await page.locator("body").innerText();
console.log("payroll list now:\n", body.split("\n").filter((l) => /DRAFT|CALCULATED|APPROVED|PAID|gross|net/i.test(l)).join("\n"));
await shot(page, "03-payroll-after-calculate");

// expand the first run to see payslips
await page.locator("button").filter({ hasText: /\d+\/\d{4}/ }).first().click();
await page.waitForTimeout(3000);
console.log("\n--- expanded run ---");
console.log((await page.locator("body").innerText()).split("\n").slice(-40).join("\n"));
await shot(page, "03-payslips");

// ---------- Step 3: approve ----------
console.log("\n########## STEP 3: approve ##########");
const approve = page.getByRole("button", { name: /^Approve$/ });
console.log("Approve buttons:", await approve.count());
if (await approve.count()) {
  await approve.first().click();
  await page.waitForTimeout(5000);
  console.log("after approve:", (await page.locator("body").innerText()).match(/(DRAFT|CALCULATED|APPROVED|PAID)/g)?.join(",") ?? "?");
  const stepUp = await page.locator("body").innerText();
  if (/verification|step.?up|authenticator|TOTP/i.test(stepUp)) console.log("!! STEP-UP NOTICE:", stepUp.match(/[^\n]*(verification|step.?up|authenticator|code)[^\n]*/i)?.[0]);
}
await shot(page, "03-after-approve");

// ---------- Step 4: pay ----------
console.log("\n########## STEP 4: mark paid ##########");
const pay = page.getByRole("button", { name: /Mark paid/i });
console.log("Mark-paid buttons:", await pay.count());
if (await pay.count()) {
  await pay.first().click();
  await page.waitForTimeout(5000);
}
console.log("final list:\n", (await page.locator("body").innerText()).split("\n").filter((l) => /\d\/\d{4}/.test(l)).join("\n"));
await shot(page, "03-after-pay");

await browser.close();
