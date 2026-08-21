/* DAY 2 — step 7: the screens the last walkthrough said did not exist.
 * (a) route a dish to a station, (b) a printer, (c) a role, (d) a branch, (e) a dish photo. */
import { newBrowser, newPage, go, shot, saveState, loadState, finding, apiGet, log, PEOPLE, login } from "./lib.mjs";

const S = loadState();
const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
const out = {};

// ── (a) STATION ROUTING ──────────────────────────────────────────────────────
log("\n=== (a) route a dish to a station ===");
let tr = await go(owner, "/app/menu/routing", { waitMs: 7000 });
log("  trouble:", JSON.stringify(tr.bad));
await shot(owner, "07a-routing");
const routing = await owner.evaluate(() => ({
  summary: document.querySelector("[data-testid=routing-summary]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
  items: Array.from(document.querySelectorAll("[data-testid=routing-item]")).slice(0, 4).map((n) => n.innerText.replace(/\s+/g, " ").trim().slice(0, 160)),
  selects: Array.from(document.querySelectorAll("[data-testid=item-station-select]")).length,
  head: (document.body.innerText || "").replace(/\s+/g, " ").slice(300, 1100),
}));
log("  ROUTING:", JSON.stringify(routing, null, 1).slice(0, 1200));
out.routing = routing;
// re-route the FIRST item to BAR
const sel = owner.locator("[data-testid=item-station-select]").first();
if (await sel.count()) {
  const opts = await sel.locator("option").allTextContents();
  log("  station options:", JSON.stringify(opts));
  const itemName = await owner.evaluate(() => {
    const row = document.querySelector("[data-testid=routing-item]");
    return row ? row.innerText.split("\n")[0].trim() : null;
  });
  const target = opts.find((o) => /Main bar|BAR/i.test(o)) ?? opts[1];
  await sel.selectOption({ label: target });
  await owner.waitForTimeout(3500);
  const status = await owner.evaluate(() => document.querySelector("[data-testid=item-station-status]")?.innerText.replace(/\s+/g, " ").trim() ?? null);
  log(`  routed "${itemName}" -> ${target}; status:`, status);
  await shot(owner, "07b-routing-changed");
  out.routed = { itemName, target, status };
}

// ── (b) PRINTERS ─────────────────────────────────────────────────────────────
log("\n=== (b) configure a printer ===");
tr = await go(owner, "/app/settings/printers", { waitMs: 8000 });
log("  trouble:", JSON.stringify(tr.bad));
await shot(owner, "07c-printers");
const printers = await owner.evaluate(() => ({
  rows: Array.from(document.querySelectorAll("[data-testid=printer-row]")).map((n) => n.innerText.replace(/\s+/g, " ").trim().slice(0, 180)).slice(0, 8),
  agents: Array.from(document.querySelectorAll("[data-testid=print-agent-row]")).map((n) => n.innerText.replace(/\s+/g, " ").trim().slice(0, 180)).slice(0, 6),
  alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.replace(/\s+/g, " ").trim().slice(0, 300)),
  addKitchen: !!document.querySelector("[data-testid=add-kitchen-printer]"),
  addReceipt: !!document.querySelector("[data-testid=add-receipt-printer]"),
  save: !!document.querySelector("[data-testid=save-printers]"),
  failing: document.querySelector("[data-testid=printers-failing]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
}));
log("  PRINTERS:", JSON.stringify(printers, null, 1).slice(0, 1800));
out.printers = printers;
if (printers.addKitchen) {
  await owner.locator("[data-testid=add-kitchen-printer]").click();
  await owner.waitForTimeout(2000);
  await shot(owner, "07d-printer-added");
  const newRow = await owner.evaluate(() => {
    const rs = document.querySelectorAll("[data-testid=printer-row]");
    return rs.length ? rs[rs.length - 1].innerText.replace(/\s+/g, " ").trim().slice(0, 400) : null;
  });
  log("  new printer row:", newRow);
  const inputs = owner.locator("[data-testid=printer-row]").last().locator("input");
  const n = await inputs.count();
  log("  inputs on the new row:", n);
  for (let i = 0; i < n; i++) {
    const ph = await inputs.nth(i).getAttribute("placeholder");
    const type = await inputs.nth(i).getAttribute("type");
    log(`    input ${i}: ph=${ph} type=${type}`);
  }
  if (n) await inputs.first().fill("Day2 Pass Printer");
  await owner.waitForTimeout(600);
  const saveBtn = owner.locator("[data-testid=save-printers]");
  if (await saveBtn.count()) {
    await saveBtn.click();
    await owner.waitForTimeout(4500);
    const saved = await owner.evaluate(() => ({
      blocked: document.querySelector("[data-testid=save-blocked]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
      body: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 500),
    }));
    log("  after save:", JSON.stringify(saved).slice(0, 600));
    out.printerSave = saved;
  }
  await shot(owner, "07e-printer-saved");
}

// ── (c) ROLES ────────────────────────────────────────────────────────────────
log("\n=== (c) create a role by ticking permissions ===");
tr = await go(owner, "/app/roles", { waitMs: 8000 });
log("  trouble:", JSON.stringify(tr.bad));
await shot(owner, "07f-roles");
const roles = await owner.evaluate(() => ({
  btns: Array.from(document.querySelectorAll("button")).map((b) => b.textContent.trim()).filter(Boolean).slice(0, 25),
  checkboxes: document.querySelectorAll('input[type=checkbox], [role=checkbox]').length,
  head: (document.body.innerText || "").replace(/\s+/g, " ").slice(300, 1200),
}));
log("  ROLES:", JSON.stringify(roles, null, 1).slice(0, 1400));
out.roles = roles;
saveState({ newScreens: out });
await browser.close();
