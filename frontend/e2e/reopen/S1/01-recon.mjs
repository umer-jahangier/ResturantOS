/* S1 re-open, step 1: reach the screen the way an owner does, and photograph the truth. */
import { newBrowser, newPage, login, PEOPLE, go, shot, log, saveState, writeJson, apiGet } from "./lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);

try {
  await login(page, PEOPLE.owner);

  // 1. Dashboard, then find the sidebar entry and CLICK it (never type the URL).
  await go(page, "/app/dashboard");
  const link = page.locator('a[href="/app/menu/routing"]').first();
  const linkCount = await page.locator('a[href="/app/menu/routing"]').count();
  const linkText = linkCount ? (await link.innerText()).trim() : null;
  log(`  sidebar entries pointing at /app/menu/routing: ${linkCount} — text ${JSON.stringify(linkText)}`);
  await shot(page, "01a-dashboard-sidebar");

  if (!linkCount) throw new Error("no sidebar link to /app/menu/routing");
  await link.click();
  await page.waitForTimeout(4000);

  const trouble = await go(page, page.url().replace("http://localhost:3000", ""), { waitMs: 3500 });
  const landed = await page.evaluate(() => {
    const h1 = document.querySelector("h1");
    const rows = Array.from(document.querySelectorAll('[data-testid="routing-item"]')).map((n) => ({
      name: n.getAttribute("data-item-name"),
      eff: n.getAttribute("data-effective-station"),
      src: n.getAttribute("data-route-source"),
    }));
    const cats = Array.from(document.querySelectorAll('[data-testid="routing-category"]')).map((n) => ({
      name: n.getAttribute("data-category-name"),
      select: n.querySelector('[data-testid="category-station-select"]')?.value ?? null,
      selectText:
        n.querySelector('[data-testid="category-station-select"]')?.selectedOptions?.[0]?.text ?? null,
    }));
    return {
      url: location.href,
      h1: h1 ? h1.textContent.trim() : null,
      summary: document.querySelector('[data-testid="routing-summary"]')?.textContent?.trim() ?? null,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
      catCount: cats.length,
      rowCount: rows.length,
      cats,
      rows,
    };
  });
  await shot(page, "01b-routing-page");
  log(`  url=${landed.url} h1=${JSON.stringify(landed.h1)} cats=${landed.catCount} rows=${landed.rowCount}`);
  log(`  summary: ${landed.summary}`);
  log(`  alerts: ${JSON.stringify(landed.alerts)} trouble=${JSON.stringify(trouble.bad)}`);

  // 2. The same truth over the wire, so DOM and API can be compared.
  const me = await apiGet(page, "/api/v1/auth/me");
  const branchId = me.body?.data?.branchId ?? me.body?.branchId ?? null;
  const tenantId = me.body?.data?.tenantId ?? me.body?.tenantId ?? null;
  log(`  branchId=${branchId} tenantId=${tenantId}`);

  const routing = await apiGet(page, `/api/v1/pos/menu/routing?branchId=${branchId}`);
  const stations = await apiGet(page, `/api/v1/pos/stations?branchId=${branchId}`);
  const branches = await apiGet(page, "/api/v1/branches");

  const r = routing.body?.data ?? routing.body;
  const st = stations.body?.data ?? stations.body;
  const stationList = (Array.isArray(st) ? st : (st?.content ?? [])).map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    type: s.type ?? s.stationType,
    active: s.active,
  }));
  const branchList = (branches.body?.data ?? branches.body ?? []).map?.((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
  })) ?? [];

  log(`  API routing status=${routing.status} categories=${r?.categories?.length} items=${r?.items?.length}`);
  log(`  stations(${stationList.length}): ${stationList.map((s) => s.code + (s.active === false ? "(inactive)" : "")).join(", ")}`);
  log(`  branches: ${JSON.stringify(branchList)}`);

  // Items with NO category — invisible on a category-first board.
  const orphans = (r?.items ?? []).filter((i) => !i.categoryId);
  log(`  items with no category: ${orphans.length}`);

  writeJson("01-recon.json", {
    landed,
    trouble,
    branchId,
    tenantId,
    stations: stationList,
    branches: branchList,
    apiCategories: r?.categories ?? [],
    apiItems: r?.items ?? [],
    orphanItems: orphans,
    domRowCount: landed.rowCount,
    apiActiveItemCount: (r?.items ?? []).filter((i) => i.active).length,
    apiItemCount: (r?.items ?? []).length,
  });
  saveState({ branchId, tenantId, stations: stationList, branches: branchList });
  log("  ✓ recon written");
} finally {
  await browser.close();
}
