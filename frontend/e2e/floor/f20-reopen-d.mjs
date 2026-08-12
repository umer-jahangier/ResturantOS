/*
 * F20 re-open, part D — the day-end screens a cash tip now flows into.
 *
 * A cash tip is physically in the drawer (closeTill counts it). Does the OWNER's Takings screen,
 * which reconciles the drawer against the day's tenders, account for it — or does the tip appear
 * as an unexplained gap between the tender line and the till's expected cash?
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, log } from "../shift/lib.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F20/reopen");
mkdirSync(OUT, { recursive: true });
const R = {};
const rec = (k, v) => { R[k] = v; log(`  [${k}]`, JSON.stringify(v)); };

const BRANCH = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
async function signIn(page, who, n = 3) {
  for (let i = 1; ; i += 1) { try { return await login(page, who); } catch (e) { if (i >= n) throw e; await page.waitForTimeout(4000); } }
}
const clean = (page) => page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((n) => n.remove()));

const browser = await newBrowser();
const own = await newPage(browser);
await signIn(own, PEOPLE.owner);

const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
const api = await apiGet(own, `/api/v1/pos/daily-takings?branchId=${BRANCH}&businessDate=${today}`);
rec("takings-api", { status: api.status, body: api.body?.data ?? api.body });

const t = await go(own, "/app/finance/takings", { waitMs: 8000, allowTrouble: true });
await clean(own);
rec("takings-screen-trouble", t);
// the screen may default to another date; nudge it to today if there is a date input
const dateInput = own.locator('input[type="date"]');
if (await dateInput.count()) {
  await dateInput.first().fill(today);
  await own.waitForTimeout(4000);
  await clean(own);
}
const text = await own.evaluate(() => (document.body.innerText || "").replace(/\n+/g, " | "));
rec("takings-screen-text", { text: text.slice(0, 3000) });
rec("takings-mentions-tip", { anyTipWord: /\btip/i.test(text) });
await own.screenshot({ path: `${OUT}/r15-takings.png`, fullPage: true });

writeFileSync(`${OUT}/reopen-d.json`, JSON.stringify(R, null, 2));
await browser.close();
