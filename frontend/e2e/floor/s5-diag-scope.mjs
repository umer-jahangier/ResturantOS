/*
 * Does a data screen actually follow the branch switch, or only its label?
 *
 * Creates a brand-new branch (which therefore has zero orders by construction), switches to it,
 * and records EVERY gateway request the takings and order screens make, with the branch claim in
 * the bearer they carried. A figure that is identical on a 30-second-old branch and on HQ is the
 * screen reading something other than the branch.
 */
import { newBrowser, newPage, login, PEOPLE, go } from "../shift/lib.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S5");
mkdirSync(OUT, { recursive: true });
const STAMP = String(Date.now()).slice(-5);
const NAME = `Scope Probe ${STAMP}`;

function claim(tok) {
  try {
    return JSON.parse(Buffer.from(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()).branch_id;
  } catch {
    return null;
  }
}

const browser = await newBrowser();
const page = await newPage(browser);
let calls = [];
page.on("request", (req) => {
  const u = req.url();
  if (!u.includes("localhost:8080")) return;
  const auth = req.headers()["authorization"];
  calls.push({ m: req.method(), u: u.replace("http://localhost:8080", ""), branchInToken: auth ? claim(auth.slice(7)) : null });
});

for (let i = 1; ; i++) {
  try {
    await login(page, PEOPLE.owner);
    break;
  } catch (e) {
    if (i >= 4) throw e;
    await page.waitForTimeout(20000);
  }
}

const report = {};
async function snapshot(label, route) {
  calls = [];
  await go(page, route, { waitMs: 6000, allowTrouble: true });
  const text = await page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    return (main.innerText || "").slice(0, 900);
  });
  report[label] = {
    route,
    calls: calls.filter((c) => !/features|branches\/mine|refresh/.test(c.u)),
    text: text.replace(/\n+/g, " | "),
  };
  console.log(`\n=== ${label} (${route})`);
  for (const c of report[label].calls) console.log(`   ${c.m} ${c.u}  [token branch ${c.branchInToken}]`);
  console.log(`   TEXT: ${report[label].text.slice(0, 420)}`);
}

await snapshot("HQ-takings", "/app/finance/takings");
await snapshot("HQ-orders", "/app/pos");

// Create a branch with no history whatsoever, and move onto it.
await go(page, "/app/branches", { waitMs: 4000 });
await page.getByTestId("add-branch").click();
await page.waitForTimeout(600);
await page.getByTestId("branch-name-input").fill(NAME);
await page.getByTestId("branch-form-submit").click();
await page.waitForTimeout(4000);
const trigger = page.locator('button[aria-label="Switch branch"]');
await trigger.first().click();
await page.waitForTimeout(600);
await page.locator(`[role="menuitem"]:has-text("${NAME}")`).first().click();
await page.waitForTimeout(4500);
console.log("\nswitched to", (await trigger.first().textContent())?.trim());

await snapshot("NEW-takings", "/app/finance/takings");
await snapshot("NEW-orders", "/app/pos");

writeFileSync(resolve(OUT, "scope-diag.json"), JSON.stringify(report, null, 2));
console.log("\nwrote scope-diag.json;  probe branch:", NAME);
await browser.close();
