/* S1 RE-OPEN 01 — my own drive: owner signs in, CLICKS the sidebar entry, and I snapshot state. */
import { newBrowser, newPage, login, go, shot, apiGet, PEOPLE, saveState, OUT, log } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.owner);
  const t0 = await go(page, "/app/dashboard", { waitMs: 4000 });
  log("dashboard:", JSON.stringify(t0));

  // Find the sidebar entry and CLICK it — never type the URL.
  const link = page.locator('a[href="/app/menu/routing"]').first();
  const found = await link.count();
  log("sidebar link count:", found);
  if (!found) throw new Error("no sidebar link to /app/menu/routing");
  await shot(page, "01a-sidebar");
  page.__requests.length = 0;
  await link.click();
  await page.waitForTimeout(5000);

  const trouble = await go(page, "/app/menu/routing", { waitMs: 4000 });
  log("routing page after click, url:", page.url());
  log("trouble:", JSON.stringify(trouble));
  await shot(page, "01b-routing");

  const head = await page.evaluate(() => ({
    h1: document.querySelector("h1")?.textContent?.trim() ?? null,
    summary: document.querySelector('[data-testid="routing-summary"]')?.textContent?.trim() ?? null,
    selects: document.querySelectorAll("select").length,
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
  }));
  log("head:", JSON.stringify(head));

  // Read the raw truth from the API so I can compare screen vs server later.
  const me = await apiGet(page, "/api/v1/auth/me");
  const branchId =
    me.body?.data?.branchId ?? me.body?.branchId ?? me.body?.data?.branch?.id ?? null;
  const tenantId = me.body?.data?.tenantId ?? me.body?.tenantId ?? null;
  log("branchId:", branchId, "tenantId:", tenantId);

  const routing = await apiGet(page, `/api/v1/pos/menu/routing?branchId=${branchId}`);
  log("GET routing:", routing.status);
  const d = routing.body?.data ?? routing.body;
  writeFileSync(`${OUT}/01-routing-raw.json`, JSON.stringify(d, null, 2));
  log(
    "categories:",
    (d?.categories ?? []).map((c) => `${c.categoryName}=>${c.stationCode ?? "-"}`).join(", "),
  );
  const items = d?.items ?? [];
  log("items:", items.length);
  for (const i of items.filter((x) => x.effectiveStationCode)) {
    log(`  ${i.itemName} [${i.categoryName}] -> ${i.effectiveStationCode} (${i.routeSource})`);
  }

  const stations = await apiGet(page, `/api/v1/pos/stations?branchId=${branchId}`);
  log("GET stations:", stations.status);
  const sl = stations.body?.data?.content ?? stations.body?.data ?? stations.body?.content ?? [];
  writeFileSync(`${OUT}/01-stations-raw.json`, JSON.stringify(sl, null, 2));
  log("stations:", (Array.isArray(sl) ? sl : []).map((s) => `${s.code}/${s.name}/active=${s.active ?? s.isActive}`).join(", "));

  const branches = await apiGet(page, "/api/v1/branches");
  const bl = branches.body?.data?.content ?? branches.body?.data ?? [];
  log("branches:", JSON.stringify((Array.isArray(bl) ? bl : []).map((b) => ({ id: b.id, name: b.name, code: b.code }))));

  saveState({ branchId, tenantId, branches: Array.isArray(bl) ? bl : [] });
  log("api calls seen:", JSON.stringify(page.__requests.filter((r) => /routing|station/.test(r.u))));
} finally {
  await browser.close();
}
