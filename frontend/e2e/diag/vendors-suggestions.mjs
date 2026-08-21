// ATTACK 10: capabilities the other agent never mentioned at all — supplier master data,
// vendor price lists, vendor scorecards, and the reorder-point -> suggested-order -> draft-PO loop.
import { chromium, newCtx, login, probe, shot, assertSession, BASE } from "./lib.mjs";

const persona = process.argv[2] ?? "manager";
const stamp = Date.now().toString().slice(-6);

async function dlg(page) {
  return page.evaluate(() => {
    const ds = [...document.querySelectorAll('[role="dialog"]')];
    const d = ds[ds.length - 1];
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return { size: `${Math.round(r.width)}x${Math.round(r.height)}`, title: (d.querySelector("h2,h3")?.innerText || "").trim(),
      labels: [...d.querySelectorAll("label")].map((l) => l.innerText.trim()).filter(Boolean),
      fields: [...d.querySelectorAll("input,textarea,select")].map((i) => i.name || i.getAttribute("aria-label") || i.type),
      buttons: [...d.querySelectorAll("button")].map((b) => `${b.innerText.trim()}${b.disabled ? "[DIS]" : ""}`).filter((t) => t && t !== "[DIS]") };
  });
}

async function main() {
  const browser = await chromium.launch();
  const { page } = await newCtx(browser, { width: 1440, height: 950 });
  const api = [];
  page.on("response", (r) => { const u = r.url(); if (/\/purchasing\//.test(u) && r.request().method() !== "GET") api.push(`${r.request().method()} ${r.status()} ${u.split("/api/v1")[1]?.split("?")[0]}`); });
  if (!(await login(page, persona))) { console.log("LOGIN FAILED"); process.exit(1); }

  // ── VENDOR LIST shape ────────────────────────────────────────────────────
  const v = await probe(page, "/app/purchasing/vendors");
  await assertSession(page, "vendors");
  console.log("\n=== VENDORS ===");
  console.log("  text:", v.text.split("Analytics")[1]?.slice(0, 700).replace(/\n+/g, " | "));
  await shot(page, "vendors-list");

  // ── CREATE a vendor and prove it persists ────────────────────────────────
  console.log("\n=== ADD VENDOR ===");
  await page.locator('button:has-text("Add vendor")').first().click();
  await page.waitForTimeout(2000);
  console.log("  dialog:", JSON.stringify(await dlg(page)));
  const name = `REDTEAM Supplier ${stamp}`;
  for (const [sel, val] of [['input[name="name"]', name], ['input[name="contactEmail"]', `rt${stamp}@x.com`],
                            ['input[name="contactPhone"]', "03001234567"], ['input[name="paymentTermsDays"]', "30"]]) {
    const f = page.locator(`[role="dialog"] ${sel}`);
    if (await f.count()) { await f.first().fill(val); }
  }
  await page.waitForTimeout(500);
  await shot(page, "vendor-form-filled");
  api.length = 0;
  const save = page.locator('[role="dialog"] button').filter({ hasText: /^(Save|Create|Add)/ }).first();
  if (await save.count()) { console.log("  save disabled:", await save.isDisabled()); await save.click(); await page.waitForTimeout(4000); }
  console.log("  api:", JSON.stringify(api));
  const after = await probe(page, "/app/purchasing/vendors");
  console.log("  vendor persisted after reload:", after.text.includes(name), `(looking for "${name}")`);
  await shot(page, "vendors-after-create");

  // ── VENDOR ITEMS / PRICE LIST — the supplier catalogue ───────────────────
  console.log("\n=== VENDOR DETAIL / ITEMS / PRICES ===");
  const edit = page.locator('button:has-text("Edit")').first();
  if (await edit.count()) {
    await edit.click(); await page.waitForTimeout(2000);
    console.log("  Edit dialog:", JSON.stringify(await dlg(page)));
    await page.keyboard.press("Escape"); await page.waitForTimeout(1000);
  }
  const itemBtns = await page.evaluate(() => [...document.querySelectorAll("button,a")]
    .map((b) => b.innerText.trim()).filter((t) => /item|price|catalog|scorecard/i.test(t)).slice(0, 10));
  console.log("  item/price/scorecard controls on vendors page:", JSON.stringify(itemBtns));

  // ── ORDER SUGGESTIONS: the reorder loop ──────────────────────────────────
  console.log("\n=== ORDER SUGGESTIONS ===");
  const s = await probe(page, "/app/purchasing/order-suggestions");
  await assertSession(page, "suggestions");
  console.log("  full text:", s.text.split("Analytics")[1]?.slice(0, 900).replace(/\n+/g, " | "));
  const sd = await page.evaluate(() => {
    const t = document.querySelector("table");
    return { headers: t ? [...t.querySelectorAll("th")].map((x) => x.innerText.trim()) : [],
      rows: t ? [...t.querySelectorAll("tbody tr")].map((r) => r.innerText.replace(/\n/g, " | ")) : [],
      buttons: [...document.querySelectorAll("button")].map((b) => `${b.innerText.trim()}${b.disabled ? "[DIS]" : ""}`).filter((x) => x && !/Collapse|Search|Floating|^F$/.test(x)) };
  });
  console.log("  cols:", JSON.stringify(sd.headers));
  console.log("  rows:", JSON.stringify(sd.rows));
  console.log("  buttons:", JSON.stringify(sd.buttons));
  await shot(page, "order-suggestions");

  api.length = 0;
  const create = page.locator('button:has-text("Create draft orders")').first();
  if ((await create.count()) && !(await create.isDisabled())) {
    console.log("  >>> clicking Create draft orders");
    await create.click(); await page.waitForTimeout(5000);
    const d2 = await dlg(page);
    if (d2) { console.log("  dialog:", JSON.stringify(d2));
      const c = page.locator('[role="dialog"] button').filter({ hasText: /Create|Confirm/ }).first();
      if ((await c.count()) && !(await c.isDisabled())) { await c.click(); await page.waitForTimeout(4000); } }
    const toast = await page.evaluate(() => [...document.querySelectorAll("[data-sonner-toast],[role=alert]")].map((t) => t.innerText.trim()).join(" ~ "));
    console.log("  toast:", toast, "| api:", JSON.stringify(api));
    await shot(page, "suggestions-after-create");
  } else { console.log("  Create draft orders: absent or disabled"); }

  // ── ANALYTICS / SCORECARD ────────────────────────────────────────────────
  console.log("\n=== ANALYTICS / VENDOR SCORECARD ===");
  const a = await probe(page, "/app/purchasing/analytics");
  await assertSession(page, "analytics");
  console.log("  text:", a.text.split("Analytics")[1]?.slice(0, 900).replace(/\n+/g, " | "));
  await shot(page, "analytics");

  await browser.close();
}
main();
