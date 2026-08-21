/* Another agent restarted pos-service mid-run. Re-drive the decisive assertion on THIS stack. */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, apiGet, log, writeJson, loadState,
} from "./lib.mjs";

const st = loadState();
const BRANCH = st.branchId;
const out = {};
const browser = await newBrowser();
try {
  const owner = await newPage(browser);
  await login(owner, PEOPLE.owner);
  const r0 = await apiGet(owner, `/api/v1/pos/menu/routing?branchId=${BRANCH}`);
  const items = (r0.body?.data ?? r0.body)?.items ?? [];
  out.routes = ["Pinacolada", "Chicken Karahi", "Mutton Biryani"].map((n) => {
    const i = items.find((x) => x.itemName === n);
    return { name: n, cat: i?.categoryName, eff: i?.effectiveStationCode, src: i?.source };
  });
  log("  routes standing now:", JSON.stringify(out.routes));
  await owner.close();

  const page = await newPage(browser);
  await login(page, PEOPLE.cashier);
  await go(page, "/app/pos", { waitMs: 9000 });
  await page.locator("[data-testid=order-type-dine_in]").click().catch(() => {});
  await page.waitForTimeout(700);
  async function ring(name) {
    const s = page.locator('input[placeholder*="Search" i], input[aria-label*="Search" i]');
    if (await s.count()) {
      await s.first().fill(name);
      await page.waitForTimeout(1600);
    }
    const tile = page.locator('[data-testid="menu-grid"] button[aria-pressed]').filter({ hasText: name }).first();
    await tile.waitFor({ timeout: 15000 });
    await tile.click();
    await page.waitForTimeout(800);
    if (await s.count()) {
      await s.first().fill("");
      await page.waitForTimeout(1100);
    }
  }
  for (const n of ["Pinacolada", "Chicken Karahi", "Mutton Biryani"]) await ring(n);
  await shot(page, "13a-cart");
  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(9000);
  const orderNo = await page.evaluate(() => /ORD-\d{8}-\d{4}/.exec(document.body.innerText || "")?.[0] ?? null);
  out.orderNo = orderNo;
  log("  order:", orderNo);
  await shot(page, "13b-fired");
  await page.close();

  const kds = await newPage(browser);
  await login(kds, PEOPLE.kitchen);
  const t = await apiGet(kds, `/api/v1/kitchen/kds/tickets?branchId=${BRANCH}&status=PENDING,COOKING,READY&size=300`);
  const tb = t.body?.content ?? t.body?.data?.content ?? t.body?.data ?? [];
  out.tickets = (Array.isArray(tb) ? tb : [])
    .filter((x) => (x.orderNo ?? x.orderNumber) === orderNo)
    .map((x) => ({ station: x.stationCode ?? x.station, items: (x.items ?? []).map((i) => `${i.quantity}× ${i.itemName}`) }));
  log("  tickets:", JSON.stringify(out.tickets));

  await go(kds, "/app/kitchen/BAR", { waitMs: 7000 });
  out.barDom = await kds.evaluate((no) => {
    const text = (document.body.innerText || "").replace(/\s+/g, " ");
    const block = text.split(/(?=ORD-\d{8}-\d{4})/).find((b) => b.startsWith(no)) ?? null;
    return { block: block ? block.slice(0, 200) : null, alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()) };
  }, orderNo);
  await shot(kds, "13c-bar");
  log("  BAR board block:", JSON.stringify(out.barDom));

  await go(kds, "/app/kitchen/GRILL", { waitMs: 7000 });
  out.grillDom = await kds.evaluate((no) => {
    const text = (document.body.innerText || "").replace(/\s+/g, " ");
    const block = text.split(/(?=ORD-\d{8}-\d{4})/).find((b) => b.startsWith(no)) ?? null;
    return { block: block ? block.slice(0, 200) : null, alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()) };
  }, orderNo);
  await shot(kds, "13d-grill");
  log("  GRILL board block:", JSON.stringify(out.grillDom));

  const expect = { Pinacolada: "BAR", "Chicken Karahi": "GRILL", "Mutton Biryani": "BAR" };
  out.verdict = Object.entries(expect).map(([n, want]) => {
    const got = out.tickets.find((k) => k.items.some((i) => i.endsWith(`× ${n}`)))?.station ?? "(none)";
    return { n, want, got, ok: got === want };
  });
  for (const v of out.verdict) log(`  ${v.ok ? "OK      " : "MISMATCH"} ${v.n.padEnd(16)} want ${String(v.want).padEnd(6)} got ${v.got}`);
  writeJson("13-reconfirm.json", out);
} finally {
  await browser.close();
}
