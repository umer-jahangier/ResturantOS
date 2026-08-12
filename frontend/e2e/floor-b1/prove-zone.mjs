/*
 * B1 / S0-C, part 3 — is the Time zone field on /app/settings actually load-bearing?
 *
 * "Structurally present, behaviourally absent" is this codebase's signature failure, and a fix
 * that reads a branch's timezone is worthless if the branch's timezone is decoration. So this
 * changes it THROUGH THE PRODUCT'S OWN SCREEN, as the owner, and then asks the cash-up screen
 * what day it is.
 *
 * Asia/Karachi is UTC+5 and America/New_York is UTC-4, so at any instant between 04:00Z and
 * 08:00Z the two branches are on DIFFERENT trading days: Karachi is mid-morning on today,
 * New York is after midnight and still working last night's service. A screen that answers the
 * same day for both is not reading the field.
 *
 *   node e2e/floor-b1/prove-zone.mjs America/New_York     # set it and measure
 *   node e2e/floor-b1/prove-zone.mjs Asia/Karachi         # put it back
 */
import { PEOPLE, newBrowser, newPage, login, go, log, API } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/B1";
mkdirSync(OUT, { recursive: true });
const TZ = process.argv[2] ?? "America/New_York";
const FILE = `${OUT}/prove-zone.json`;
const journal = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {};
const record = (k, v) => {
  journal[k] = v;
  log(`  ${k}: ${JSON.stringify(v)}`);
  writeFileSync(FILE, JSON.stringify(journal, null, 2));
};
const shot = async (p, n) => {
  await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
  log(`    shot: ${n}.png`);
};

const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);

log(`\n=== set the branch Time zone to ${TZ} on /app/settings ===`);
let tr = await go(owner, "/app/settings", { waitMs: 9000 });
record(`settingsTrouble_${TZ}`, tr);
await shot(owner, `60-settings-before-${TZ.replace("/", "-")}`);

const zoneField = owner
  .locator('input[name="timezone"], input#timezone, select[name="timezone"], select#timezone')
  .first();
const found = await zoneField.count();
record(`zoneFieldPresent_${TZ}`, found > 0);
if (!found) {
  record("zoneFieldMissing", await owner.evaluate(() =>
    document.body.innerText.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 60)));
  await browser.close();
  throw new Error("no timezone field on /app/settings — cannot drive this through the product");
}
const before = await zoneField.inputValue();
record(`zoneBefore_${TZ}`, before);
await zoneField.fill("");
await zoneField.fill(TZ);
await owner.waitForTimeout(500);
const save = owner.getByRole("button", { name: /save|update|apply/i }).first();
await save.click();
await owner.waitForTimeout(6000);
await shot(owner, `61-settings-saved-${TZ.replace("/", "-")}`);
record(`saveResult_${TZ}`, await owner.evaluate(() => ({
  alerts: [...document.querySelectorAll('[role="alert"],[role="status"]')].map((n) => n.innerText.trim()),
  fieldNow: document.querySelector('input[name="timezone"],input#timezone')?.value ?? null,
})));

// Read it back over HTTP on the owner's own bearer — the screen agreeing with itself is not proof.
record(`branchReadBack_${TZ}`, await owner.evaluate(async (api) => {
  const r = await fetch(`${api}/api/v1/branches`, { credentials: "include" }).catch(() => null);
  if (!r) return "fetch failed";
  const j = await r.json().catch(() => null);
  const list = j?.data?.content ?? j?.data ?? [];
  return Array.isArray(list) ? list.map((b) => ({ name: b.name, timezone: b.timezone })) : j;
}, API));

await browser.close();
