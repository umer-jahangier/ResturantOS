/*
 * PROBE I —
 *  (1) RECALL via the arrow-key path (the only remaining way to aim F at a PREPARING
 *      fragment that has no position number). This is the last legal route to a recall.
 *  (2) /app/kitchen index + the station picker: which stations does the KDS actually offer,
 *      versus which stations an admin created in /app/stations.
 */
import { launch, newPage, login, probe, shot, BRANCH, GW } from "./skpx-lib.mjs";

async function tickets(page, token) {
  return page.evaluate(async ([gw, br, tok]) => {
    const res = await fetch(`${gw}/api/v1/kitchen/kds/tickets?branchId=${br}&size=200&page=0`, { headers: { Authorization: `Bearer ${tok}` } });
    const j = await res.json();
    const rows = Array.isArray(j) ? j : (j.content ?? j.data ?? []);
    return rows.map((t) => ({ id: t.id, ord: t.orderNo, st: t.status, items: (t.items || []).map((i) => ({ id: i.id, name: i.menuItemName ?? i.name, st: i.status })) }));
  }, [GW, BRANCH, token]);
}
const focusedKeyOf = (page) => page.evaluate(() => {
  const f = document.querySelector('[data-testid^="kds-fragment-"][data-focused="true"]')
    ?? [...document.querySelectorAll('[data-testid^="kds-fragment-"]')].find((n) => n.matches(":focus-within") || n.querySelector(":focus"));
  return f ? f.getAttribute("data-testid") : null;
});

async function main() {
  const browser = await launch();
  const { page } = await newPage(browser);
  let TOKEN = null;
  page.on("request", (r) => { const a = r.headers()["authorization"]; if (a?.startsWith("Bearer ") && !TOKEN) TOKEN = a.slice(7); });
  if (!(await login(page, "kitchen"))) process.exit(1);
  await probe(page, "/app/kitchen/DEFAULT", { who: "kitchen", wait: 7000 });

  // ---------- (1) arrow-key recall ----------
  const all = await tickets(page, TOKEN);
  const prep = all.find((x) => x.items.length === 1 && x.items[0].st === "PREPARING");
  console.log(`\n=== (1) recall via arrow keys; target = ${prep?.ord} item=${prep?.items[0].st}`);
  if (prep) {
    // walk to the page holding it
    for (let i = 0; i < 6; i++) { await page.keyboard.press("PageUp"); await page.waitForTimeout(300); }
    let onPage = false;
    for (let g = 0; g < 6 && !onPage; g++) {
      onPage = await page.evaluate((tid) => !![...document.querySelectorAll('[data-testid^="kds-fragment-"]')]
        .find((n) => n.getAttribute("data-testid").endsWith(`-${tid}`)), prep.id);
      if (!onPage) { await page.keyboard.press("PageDown"); await page.waitForTimeout(1300); }
    }
    console.log(`  found on page: ${await page.evaluate(() => document.querySelector('[data-testid="kds-page-indicator"]')?.innerText.trim())}`);
    await page.locator("body").click({ position: { x: 3, y: 3 } }).catch(() => { });
    let landed = false;
    for (let i = 0; i < 20; i++) {
      const k = await focusedKeyOf(page);
      if (k && k.endsWith(`-${prep.id}`)) { landed = true; console.log(`  ArrowDown x${i}: focus is on the target (${k})`); break; }
      await page.keyboard.press("ArrowDown"); await page.waitForTimeout(280);
    }
    if (!landed) console.log("  !! could not confirm focus landed on the target via arrow keys");
    await shot(page, "skpx-i1-arrow-focus");
    await page.keyboard.press("f"); await page.waitForTimeout(5000);
    const afterF = (await tickets(page, TOKEN)).find((x) => x.id === prep.id);
    console.log(`  after F: ticket=${afterF?.st} item=${afterF?.items[0]?.st}`);
    await page.keyboard.press("r"); await page.waitForTimeout(5500);
    const afterR = (await tickets(page, TOKEN)).find((x) => x.id === prep.id);
    const err = await page.evaluate(() => document.querySelector('[data-testid="kds-bump-error"]')?.innerText.trim() ?? null);
    console.log(`  after R: ticket=${afterR?.st} item=${afterR?.items[0]?.st}  err=${JSON.stringify(err)}`);
    console.log(`  >>> RECALL PULLED IT BACK: ${afterF?.items[0]?.st === "READY" && afterR?.items[0]?.st !== "READY"}`);
    await shot(page, "skpx-i2-after-arrow-recall");
  }

  // ---------- (2) the station index + picker ----------
  console.log(`\n=== (2) /app/kitchen index and the station switcher ===`);
  const idx = await probe(page, "/app/kitchen", { who: "kitchen", wait: 6000 });
  console.log(`  heads=${JSON.stringify(idx.heads)} denied=${idx.denied} 404=${idx.is404}`);
  console.log("  body:", idx.text.replace(/\s+/g, " ").slice(0, 700));
  await shot(page, "skpx-i3-kitchen-index");
  const links = await page.evaluate(() => [...document.querySelectorAll('a[href^="/app/kitchen/"]')].map((a) => `${a.getAttribute("href")} :: ${a.innerText.trim().replace(/\s+/g, " ")}`));
  console.log("  station links offered:", JSON.stringify(links));

  await probe(page, "/app/kitchen/DEFAULT", { who: "kitchen", wait: 6000 });
  const picker = await page.evaluate(() => {
    const s = document.querySelector('[data-testid="kds-station-switcher"]');
    if (!s) return null;
    return { tag: s.tagName, options: [...s.querySelectorAll("option")].map((o) => `${o.value}|${o.innerText.trim()}`) };
  });
  console.log("  station switcher:", JSON.stringify(picker));
  await shot(page, "skpx-i4-station-switcher");

  // what the two services each think exist
  const kdsSt = await page.evaluate(async ([gw, br, tok]) => {
    const r = await fetch(`${gw}/api/v1/kitchen/kds/stations?branchId=${br}`, { headers: { Authorization: `Bearer ${tok}` } });
    const j = await r.json();
    const rows = Array.isArray(j) ? j : (j.content ?? j.data ?? []);
    return rows.map((s) => `${s.code}|${s.name}|active=${s.active}|src=${s.sourceStationId}`);
  }, [GW, BRANCH, TOKEN]);
  console.log("  kitchen-service stations:", JSON.stringify(kdsSt));

  // a station that exists in pos but not in kds — type the URL directly
  for (const code of ["BAR", "DGB28334", "NOPE123"]) {
    const b = await probe(page, `/app/kitchen/${code}`, { who: "kitchen", wait: 5500 });
    const cards = await page.evaluate(() => document.querySelectorAll('[data-testid="kds-ticket-card"]').length);
    const conn = await page.evaluate(() => document.querySelector('[data-testid="kds-connection"]')?.innerText.trim());
    console.log(`  /app/kitchen/${code}: heads=${JSON.stringify(b.heads)} cards=${cards} conn="${conn}" 404=${b.is404} failed=${b.failed}`);
    await shot(page, `skpx-i5-kitchen-${code}`);
  }

  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
