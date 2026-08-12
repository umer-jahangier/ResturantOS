/*
 * S8 step 4 — the GRILL printer is switched off mid-service.
 *
 * The claim under test is the one the walkthrough said the product could not make: the screen has
 * to report THAT STATION as unable to print. Before this, the agent still read "Connected" (the
 * machine was polling), the unrouted-stations alert stayed silent (the station HAS a printer), and
 * the only record of the failure was a row nobody was looking at.
 */
import { newBrowser, newPage, login, go, shot, apiGet, branchOf, PEOPLE, OUT } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const evidence = {};
const browser = await newBrowser();

// ── 1. A cashier fires a grilled dish while the printer is off ──────────────────────────────
const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);
await go(cash, "/app/pos", { waitMs: 9000, allowTrouble: true });
await cash.locator("[data-testid=order-type-takeaway]").click();
await cash.waitForTimeout(700);

const search = cash.getByLabel(/search menu/i);
if (await search.count()) {
  await search.first().fill("Butter Naan");
  await cash.waitForTimeout(2200);
}
const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 30_000 });
const names = await tiles.allTextContents();
const idx = names.findIndex((n) => /Butter Naan/i.test(n));
if (idx < 0) throw new Error("Butter Naan not on the grid");
await tiles.nth(idx).click();
await cash.waitForTimeout(900);
await cash.locator("[data-testid=send-to-kitchen-button]").click();
await cash.waitForTimeout(9000);
evidence.orderNo = (
  await cash.evaluate(() =>
    Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0]))),
  )
)[0];
console.log("  fired with the GRILL printer down:", evidence.orderNo);
await shot(cash, "04a-fired-with-grill-down");

// ── 2. The owner opens the Printers screen ──────────────────────────────────────────────────
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
const branchId = await branchOf(owner);

// Give the agent time to claim, fail the connection and acknowledge.
let health = null;
for (let i = 0; i < 20; i += 1) {
  const res = await apiGet(owner, `/api/v1/pos/printers/health?branchId=${branchId}`);
  if (res.status !== 200) throw new Error(`health read failed ${res.status}`);
  health = res.body?.data ?? null;
  const grill = (health?.printers ?? []).find((p) => /grill/i.test(p.printerId));
  if (grill?.state === "FAILING") break;
  await owner.waitForTimeout(3000);
}
evidence.health = health;
console.log("  health:", JSON.stringify(health));

await go(owner, "/app/settings/printers", { waitMs: 7000 });
await owner.waitForTimeout(3000);
evidence.screen = await owner.evaluate(() => {
  const failing = document.querySelector('[data-testid="printers-failing"]');
  const rows = Array.from(document.querySelectorAll('[data-testid="printer-row"]')).map((r) => ({
    id: r.getAttribute("data-printer-id"),
    delivery: r.querySelector('[data-testid="printer-delivery"]')?.getAttribute("data-delivery-state") ?? null,
    badge: r.querySelector('[data-testid="printer-delivery"]')?.textContent?.trim() ?? null,
  }));
  const agentBadges = Array.from(document.querySelectorAll('[data-testid="print-agent-row"]'))
    .map((n) => n.getAttribute("data-agent-liveness"))
    .filter((l) => l === "CONNECTED").length;
  return {
    failingRole: failing?.getAttribute("role") ?? null,
    failingText: failing ? failing.innerText.replace(/\s+/g, " ").trim() : null,
    rows,
    connectedAgents: agentBadges,
  };
});
console.log("  screen:", JSON.stringify(evidence.screen, null, 2));
await shot(owner, "04b-grill-cannot-print");

writeFileSync(`${OUT}/04-grill-printer-down.json`, JSON.stringify(evidence, null, 2));
await browser.close();
