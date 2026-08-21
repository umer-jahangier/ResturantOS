/*
 * SHIFT STEP 7 — the seams a lunch service actually rubs against.
 *
 *  a. Floor View: did table H1 go occupied while the party sat there, and free after?
 *  b. Printers: is there a configured printer, and did the bill print on tender?
 *  c. The KDS counts: the station picker and the board disagree on three stations — by how
 *     much, and which one is the cook supposed to believe?
 *  d. Tax: is there any screen where a tenant sets a sales-tax rate?
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, apiGet, tokenOf, log } from "./lib.mjs";

const st = loadState();
const browser = await newBrowser();
const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
const tok = await tokenOf(mgr);

// ── a. floor view ─────────────────────────────────────────────────────────────
log("\n=== a. the floor ===");
await go(mgr, "/app/pos", { waitMs: 7000 });
await mgr.getByText("Floor View", { exact: true }).click();
await mgr.waitForTimeout(4000);
await shot(mgr, "07a-floor-view");
const floor = await mgr.evaluate(() => {
  const tiles = Array.from(document.querySelectorAll('[data-testid^="table-"]'));
  return {
    count: tiles.length,
    tiles: tiles.slice(0, 12).map((n) => n.innerText.replace(/\s+/g, " ").trim()),
    h1: tiles.find((n) => /(^|\s)H1(\s|$)/.test(n.innerText))?.innerText.replace(/\s+/g, " ").trim() ?? null,
    legend: document.body.innerText.replace(/\s+/g, " ").slice(0, 500),
  };
});
log("  floor:", JSON.stringify(floor, null, 1));
saveState({ floorView: floor });

await go(mgr, "/app/tables", { waitMs: 6000 });
await shot(mgr, "07b-tables");
const tables = await mgr.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, " ");
  const i = t.indexOf("H1");
  return { h1ctx: i >= 0 ? t.slice(Math.max(0, i - 80), i + 140) : null, head: t.slice(0, 400) };
});
log("  /app/tables:", JSON.stringify(tables, null, 1));
saveState({ tablesScreen: tables });

// ── b. printers ───────────────────────────────────────────────────────────────
log("\n=== b. printers ===");
const t2 = await go(mgr, "/app/settings/printers", { waitMs: 7000, allowTrouble: true });
log("  /app/settings/printers:", JSON.stringify(t2));
await shot(mgr, "07c-printers");
const printers = await mgr.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, " ");
  return {
    heading: document.querySelector("h1")?.textContent?.trim() ?? null,
    rows: Array.from(document.querySelectorAll("tbody tr")).map((r) => r.innerText.replace(/\s+/g, " ").trim()).slice(0, 8),
    buttons: Array.from(document.querySelectorAll("button")).map((b) => b.textContent.trim()).filter(Boolean).slice(0, 14),
    agentState: /NOT_RUNNING|REACHABLE|CONNECTED|No print agent[^.]*\./.exec(t)?.[0] ?? null,
    body: t.slice(0, 1100),
  };
});
log("  printers screen:", JSON.stringify(printers, null, 1));
saveState({ printers });

// did the bill print, or is it still a browser dialog?
await go(mgr, `/app/pos/orders/${st.order1Id}/receipt`, { waitMs: 7000, allowTrouble: true });
await shot(mgr, "07d-receipt");
const receipt = await mgr.evaluate(() => ({
  url: location.href,
  body: document.body.innerText.replace(/\s+/g, " ").slice(0, 1200),
  hasPrinterLine: /No printer configured|browser bill/i.test(document.body.innerText),
}));
log("  receipt:", JSON.stringify(receipt, null, 1));
saveState({ receipt });

// ── c. KDS counts ─────────────────────────────────────────────────────────────
log("\n=== c. the KDS counts ===");
const kds = await newPage(browser);
await login(kds, PEOPLE.kitchen);
const ktok = await tokenOf(kds);
await go(kds, "/app/kitchen", { waitMs: 6000 });
const picker = await kds.evaluate(() =>
  Array.from(document.querySelectorAll('[data-testid^="station-tile-"]')).map((n) => ({
    code: n.getAttribute("data-testid").replace("station-tile-", ""),
    text: n.innerText.replace(/\s+/g, " ").trim(),
  })),
);
for (const s of ["DEFAULT", "PANTRY1", "GRILL"]) {
  await go(kds, `/app/kitchen/${s}`, { waitMs: 5500 });
  const board = await kds.evaluate(() => ({
    count: document.querySelector("[data-testid=kds-ticket-count]")?.textContent?.trim() ?? null,
    cols: ["NEW", "STARTED", "PREPARING", "READY"].reduce((a, c) => {
      const el = document.querySelector(`[data-testid=kds-column-count-${c}]`);
      if (el) a[c] = el.textContent.trim();
      return a;
    }, {}),
    readyToggle: document.querySelector("[data-testid=kds-toggle-ready]")?.getAttribute("aria-pressed") ?? null,
  }));
  const p = picker.find((x) => x.code === s);
  log(`  ${s}: picker="${p?.text}"  board=${JSON.stringify(board)}`);
  saveState({ [`kdsCount_${s}`]: { picker: p?.text, board } });
}

// ── d. tax configuration ──────────────────────────────────────────────────────
log("\n=== d. sales tax configuration ===");
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
const taxRoutes = ["/app/settings/tax", "/app/settings/taxes", "/app/finance/tax", "/app/menu/tax", "/app/settings"];
const taxes = {};
for (const r of taxRoutes) {
  const tt = await go(owner, r, { waitMs: 4500, allowTrouble: true });
  taxes[r] = tt.bad.length ? tt.bad.join(",") : "reachable";
  log(`  ${r}: ${taxes[r]}`);
}
await shot(owner, "07e-settings");
const settingsBody = await owner.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 1200));
log("  /app/settings shows:", settingsBody.slice(0, 700));
saveState({ taxRoutes: taxes, settingsBody });

// and the item editor — does it carry a tax field now?
await go(owner, "/app/menu/items", { waitMs: 7000 });
await shot(owner, "07f-menu-items");
const menuScreen = await owner.evaluate(() => ({
  cols: Array.from(document.querySelectorAll("thead th")).map((n) => n.textContent.trim()),
  count: document.querySelectorAll("tbody tr").length,
  body: document.body.innerText.replace(/\s+/g, " ").slice(0, 500),
}));
log("  menu items screen:", JSON.stringify(menuScreen, null, 1));
const editBtn = owner.locator("tbody tr").first().getByRole("button").first();
if (await editBtn.count()) {
  await editBtn.click();
  await owner.waitForTimeout(1500);
  const menu = await owner.evaluate(() => Array.from(document.querySelectorAll("[role=menuitem]")).map((n) => n.textContent.trim()));
  log("  row action menu:", JSON.stringify(menu));
  const edit = owner.getByRole("menuitem", { name: /edit/i });
  if (await edit.count()) {
    await edit.click();
    await owner.waitForTimeout(2500);
    await shot(owner, "07g-item-editor");
    const fields = await owner.evaluate(() => {
      const d = document.querySelector("[role=dialog]");
      return d ? Array.from(d.querySelectorAll("label")).map((l) => l.textContent.replace(/\s+/g, " ").trim()) : null;
    });
    log("  item editor fields:", JSON.stringify(fields));
    saveState({ itemEditorFields: fields });
  }
}

await browser.close();
log("\nstep 7 done");
