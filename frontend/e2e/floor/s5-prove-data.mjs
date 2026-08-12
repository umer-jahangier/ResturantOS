/*
 * S5 — the last clause of DONE MEANS, on its own: does a DATA screen follow the branch switch?
 *
 * Order Management is the screen. A branch created seconds ago has no orders by construction, so
 * "the same list on both branches" and "the right list on each" are distinguishable here in a way
 * they are not on two branches that have both been trading.
 *
 * Run: node e2e/floor/s5-prove-data.mjs
 */
import { newBrowser, newPage, login, PEOPLE, go, pageTrouble } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S5");
mkdirSync(OUT, { recursive: true });
const NAME = `Data Scope ${String(Date.now()).slice(-5)}`;
const log = [];
const note = (k, v) => {
  log.push({ [k]: v });
  console.log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
};

function claim(tok) {
  try {
    return JSON.parse(
      Buffer.from(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    ).branch_id;
  } catch {
    return null;
  }
}

const browser = await newBrowser();
const page = await newPage(browser);
let orderCalls = [];
page.on("request", (req) => {
  const u = req.url();
  if (u.includes("/api/v1/pos/orders")) {
    orderCalls.push({
      u: u.replace("http://localhost:8080", ""),
      tokenBranch: claim((req.headers()["authorization"] || "").slice(7)),
    });
  }
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

async function readOrderManagement(label) {
  orderCalls = [];
  await go(page, "/app/pos", { waitMs: 5000 });
  const tab = page
    .locator('button:has-text("Order Management"), [role="tab"]:has-text("Order Management"), a:has-text("Order Management")')
    .first();
  await tab.click({ timeout: 20000 });
  await page.waitForTimeout(5000);
  const t = await pageTrouble(page);
  const body = await page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    return (main.innerText || "").replace(/\n+/g, " | ").slice(0, 600);
  });
  await page.screenshot({ path: `${OUT}/13-orders-${label}.png` });
  note(`${label} — trouble`, t.bad);
  note(`${label} — GET /pos/orders calls`, orderCalls.slice(0, 3));
  note(`${label} — what the screen says`, body);
  return { body, calls: orderCalls.slice() };
}

const hq = await readOrderManagement("hq");

// A branch with no history at all.
await go(page, "/app/branches", { waitMs: 4000 });
await page.getByTestId("add-branch").click();
await page.waitForTimeout(700);
await page.getByTestId("branch-name-input").fill(NAME);
await page.getByTestId("branch-form-submit").click();
await page.waitForTimeout(4000);
const trigger = page.locator('button[aria-label="Switch branch"]');
await trigger.first().click();
await page.waitForTimeout(600);
await page.locator(`[role="menuitem"]:has-text("${NAME}")`).first().click();
await page.waitForTimeout(4500);
note("switcher now reads", (await trigger.first().textContent())?.trim());

const fresh = await readOrderManagement("new-branch");

note("HQ and the new branch queried different branchIds", {
  hq: hq.calls[0]?.u,
  fresh: fresh.calls[0]?.u,
  different: (hq.calls[0]?.u ?? "a") !== (fresh.calls[0]?.u ?? "b"),
});
note("the two screens say different things", hq.body !== fresh.body);

// Put the tenant back the way it was found.
await go(page, "/app/branches", { waitMs: 3000 });
await trigger.first().click();
await page.waitForTimeout(600);
await page.locator('[role="menuitem"]:has-text("Floating Terrace HQ")').first().click();
await page.waitForTimeout(4000);
await go(page, "/app/branches", { waitMs: 3000 });
await page.getByRole("button", { name: `Actions for ${NAME}` }).click();
await page.waitForTimeout(400);
await page.getByRole("menuitem", { name: "Deactivate" }).click();
await page.waitForTimeout(700);
await page.getByRole("button", { name: "Deactivate branch" }).click();
await page.waitForTimeout(3000);
note("cleaned up", NAME);

writeFileSync(resolve(OUT, "s5-prove-data.json"), JSON.stringify(log, null, 2));
await browser.close();
