/*
 * S1 RE-OPEN 07 — the probes the claim never ran.
 *
 *  A. WRONG PERSONA  — cashier / waiter / kitchen on /app/menu/routing. Is the screen in their
 *     sidebar? Does it deny cleanly, or does it show a board of live selects?
 *  B. CROSS-TENANT   — the Control Bistro owner PUTs a route onto a Floating Terrace category
 *     and item id. Must not write.
 *  C. CROSS-BRANCH   — the Terrace owner (JWT branch = HQ) PUTs a route naming ANOTHER branch.
 *     Must not write, or one branch re-routes another building's kitchen.
 *  D. FOREIGN STATION — route a Terrace category to a station id from another branch.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, apiSend, apiGet, log, OUT } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const HQ = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
const ROOFTOP = "c2d74ade-7ff8-4167-8cd0-131bfbdf4fba";
const DRINKS_CAT = "6cc887fb-2453-449b-9144-259d8d3a9281";
const PINA_ITEM = "0fc28f38-8170-47fb-b0c6-e96f68c5423f";
const BAR_STATION = "789ce266-5808-48ec-a39a-9c7755961b44";

const browser = await newBrowser();
const out = {};

try {
  // ── A. wrong persona ─────────────────────────────────────────────────────────
  out.personas = {};
  for (const key of ["cashier", "waiter", "kitchen", "manager"]) {
    const p = await newPage(browser);
    try {
      await login(p, PEOPLE[key]);
      const inSidebar = await p.locator('a[href="/app/menu/routing"]').count();
      const t = await go(p, "/app/menu/routing", { waitMs: 6000, allowTrouble: true });
      const info = await p.evaluate(() => {
        const txt = document.body.innerText || "";
        const sels = Array.from(document.querySelectorAll('[data-testid="category-station-select"], [data-testid="item-station-select"]'));
        return {
          h1: document.querySelector("h1")?.textContent?.trim() ?? null,
          selects: sels.length,
          enabledSelects: sels.filter((s) => !s.disabled).length,
          denied: /Access denied|do not have permission|not authori/i.test(txt),
          alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
          excerpt: txt.replace(/\s+/g, " ").slice(0, 260),
        };
      });
      // and can they WRITE over the API regardless of what the screen shows?
      const write = await apiSend(p, "PUT", `/api/v1/pos/menu/categories/${DRINKS_CAT}/station?branchId=${HQ}`, { stationId: BAR_STATION });
      out.personas[key] = { inSidebar, trouble: t, ...info, apiWriteStatus: write.status, apiWriteBody: JSON.stringify(write.body).slice(0, 200) };
      log(`\n${key}:`, JSON.stringify(out.personas[key], null, 1));
      await shot(p, `07a-${key}`);
    } catch (e) {
      out.personas[key] = { error: e.message };
      log(`${key} FAILED:`, e.message);
    }
    await p.close();
  }

  // ── B. cross-tenant ──────────────────────────────────────────────────────────
  const cp = await newPage(browser);
  await login(cp, PEOPLE.controlOwner);
  const ctlRead = await apiGet(cp, `/api/v1/pos/menu/routing?branchId=${HQ}`);
  const ctlCat = await apiSend(cp, "PUT", `/api/v1/pos/menu/categories/${DRINKS_CAT}/station?branchId=${HQ}`, { stationId: BAR_STATION });
  const ctlItem = await apiSend(cp, "PUT", `/api/v1/pos/menu/items/${PINA_ITEM}/station?branchId=${HQ}`, { stationId: BAR_STATION });
  out.crossTenant = {
    readTerraceRouting: { status: ctlRead.status, body: JSON.stringify(ctlRead.body).slice(0, 250) },
    writeTerraceCategory: { status: ctlCat.status, body: JSON.stringify(ctlCat.body).slice(0, 250) },
    writeTerraceItem: { status: ctlItem.status, body: JSON.stringify(ctlItem.body).slice(0, 250) },
  };
  log("\nCROSS-TENANT:", JSON.stringify(out.crossTenant, null, 1));
  await cp.close();

  // ── C + D. cross-branch, as the Terrace owner ────────────────────────────────
  const op = await newPage(browser);
  await login(op, PEOPLE.owner);
  const rooftopRead = await apiGet(op, `/api/v1/pos/menu/routing?branchId=${ROOFTOP}`);
  const rooftopCat = await apiSend(op, "PUT", `/api/v1/pos/menu/categories/${DRINKS_CAT}/station?branchId=${ROOFTOP}`, { stationId: BAR_STATION });
  const rooftopItem = await apiSend(op, "PUT", `/api/v1/pos/menu/items/${PINA_ITEM}/station?branchId=${ROOFTOP}`, { stationId: BAR_STATION });
  out.crossBranch = {
    readRooftopRouting: { status: rooftopRead.status, body: JSON.stringify(rooftopRead.body).slice(0, 250) },
    writeRooftopCategory: { status: rooftopCat.status, body: JSON.stringify(rooftopCat.body).slice(0, 250) },
    writeRooftopItem: { status: rooftopItem.status, body: JSON.stringify(rooftopItem.body).slice(0, 250) },
  };
  log("\nCROSS-BRANCH:", JSON.stringify(out.crossBranch, null, 1));

  // did HQ's own routing survive all of that?
  const after = await apiGet(op, `/api/v1/pos/menu/routing?branchId=${HQ}`);
  const d = after.body?.data ?? after.body;
  const drinks = (d?.categories ?? []).find((c) => c.categoryId === DRINKS_CAT);
  const pina = (d?.items ?? []).find((i) => i.itemId === PINA_ITEM);
  out.hqAfter = { drinks, pina };
  log("\nHQ AFTER:", JSON.stringify(out.hqAfter, null, 1));
  await op.close();

  writeFileSync(`${OUT}/07-adversarial.json`, JSON.stringify(out, null, 2));
} catch (e) {
  console.error("FAILED:", e.message);
  writeFileSync(`${OUT}/07-adversarial.json`, JSON.stringify({ ...out, error: e.message }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
