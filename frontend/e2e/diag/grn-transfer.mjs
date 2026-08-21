// ATTACK 6: (a) does "Mock receive" actually receive — PO status + real stock movement?
//           (b) the transfer RECEIVE side, which the other agent admits it never verified.
import { chromium, newCtx, login, probe, shot, assertSession, BASE } from "./lib.mjs";

const persona = process.argv[2] ?? "manager";

async function stockOf(page, name) {
  await page.goto(`${BASE}/app/inventory/stock`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await assertSession(page, "stock");
  return page.evaluate((n) => {
    const tr = [...document.querySelectorAll("table tbody tr")].find((r) => r.innerText.startsWith(n));
    return tr ? [...tr.querySelectorAll("td")].map((c) => c.innerText.trim()) : null;
  }, name);
}

async function main() {
  const browser = await chromium.launch();
  const { page } = await newCtx(browser, { width: 390, height: 844 });
  const api = [];
  page.on("response", (r) => { const u = r.url(); if (/\/(purchasing|inventory)\//.test(u) && r.request().method() !== "GET") api.push(`${r.request().method()} ${r.status()} ${u.split("/api/v1")[1]?.split("?")[0]}`); });
  if (!(await login(page, persona))) { console.log("LOGIN FAILED"); process.exit(1); }

  // The PO line is ingredient ba268911 — find its name off the stock screen by matching later.
  const PO = "99a80052-e7fb-41da-b958-fbb437fbb3f2"; // now SENT, line qty 4 KG
  console.log("\n=== MOCK GRN on", PO.slice(0, 8), "(status SENT, 4 KG ordered) ===");

  // snapshot every stock row so we can diff and find which ingredient moved
  const snap = async () => { await page.goto(`${BASE}/app/inventory/stock`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(5000);
    return page.evaluate(() => Object.fromEntries([...document.querySelectorAll("table tbody tr")]
      .map((r) => { const c = [...r.querySelectorAll("td")].map((x) => x.innerText.trim()); return [c[0].split("\n")[0], c[2]]; }))); };
  const beforeAll = await snap();

  await page.goto(`${BASE}/app/purchasing/purchase-orders/${PO}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  const panel = await page.evaluate(() => {
    const t = document.body.innerText;
    const i = t.indexOf("Mock goods receipt");
    return i < 0 ? null : t.slice(i, i + 400).replace(/\n+/g, " | ");
  });
  console.log("  panel:", panel);
  api.length = 0;
  // partial receipt attempt: order is 4 — try to receive 2
  const qty = page.locator('input[type="text"], input[type="number"]').last();
  if (await qty.count()) { await qty.fill("2"); await page.waitForTimeout(500); console.log("  typed partial qty 2"); }
  await page.locator('button:has-text("Mock receive")').first().click();
  await page.waitForTimeout(5000);
  const toast = await page.evaluate(() => [...document.querySelectorAll("[data-sonner-toast],[role=alert]")].map((t) => t.innerText.trim()).join(" ~ "));
  console.log("  toast:", toast, "| api:", JSON.stringify(api));
  await page.goto(`${BASE}/app/purchasing/purchase-orders/${PO}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const after = await page.evaluate(() => document.body.innerText.split("Analytics")[1]?.slice(0, 300).replace(/\n+/g, " | "));
  console.log("  PO after reload:", after);
  await shot(page, "po-after-mock-receive");

  const afterAll = await snap();
  const moved = Object.keys(afterAll).filter((k) => beforeAll[k] !== afterAll[k]);
  console.log("  >>> STOCK ROWS THAT MOVED:", JSON.stringify(moved.map((k) => `${k}: ${beforeAll[k]} -> ${afterAll[k]}`)));

  // ── TRANSFER: ship, then look at the receive side ────────────────────────
  console.log("\n=== TRANSFER ===");
  const { page: dp } = await newCtx(browser, { width: 1440, height: 950 });
  dp.on("response", (r) => { const u = r.url(); if (/\/inventory\//.test(u) && r.request().method() !== "GET") api.push(`${r.request().method()} ${r.status()} ${u.split("/api/v1")[1]?.split("?")[0]}`); });
  if (!(await login(dp, persona))) { console.log("LOGIN FAILED"); process.exit(1); }
  await dp.goto(`${BASE}/app/inventory/stock`, { waitUntil: "domcontentloaded" });
  await dp.waitForTimeout(5000);
  await dp.locator('button:has-text("Transfer")').first().click();
  await dp.waitForTimeout(2000);
  const tabs = await dp.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return { text: d.innerText.slice(0, 500).replace(/\n+/g, " | "),
      dest: [...d.querySelectorAll('select[name="toBranchId"] option')].map((o) => o.innerText.trim()) };
  });
  console.log("  ship tab:", tabs.text);
  console.log("  destination options:", JSON.stringify(tabs.dest));
  await dp.locator('[role="dialog"] button:has-text("Receive")').first().click();
  await dp.waitForTimeout(2500);
  const recv = await dp.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return { size: `${Math.round(d.getBoundingClientRect().width)}x${Math.round(d.getBoundingClientRect().height)}`,
      text: d.innerText.slice(0, 600).replace(/\n+/g, " | "),
      buttons: [...d.querySelectorAll("button")].map((b) => `${b.innerText.trim()}${b.disabled ? "[DIS]" : ""}`) };
  });
  console.log("  RECEIVE tab:", JSON.stringify(recv));
  await shot(dp, "transfer-receive-tab");

  await browser.close();
}
main();
