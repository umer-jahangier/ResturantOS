// ATTACK 5: COMPLETE a stock receipt and a physical stock count, then RELOAD and prove the
// numbers moved. Reaching a dialog is not the capability; posting a document is.
import { chromium, newCtx, login, probe, shot, assertSession, BASE } from "./lib.mjs";

const persona = process.argv[2] ?? "manager";
const TARGET = process.argv[3] ?? "Potato";

/** Reads one ingredient's row out of the live stock table. */
async function readRow(page, name) {
  await page.goto(`${BASE}/app/inventory/stock`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await assertSession(page, "stock");
  return page.evaluate((n) => {
    const rows = [...document.querySelectorAll("table tbody tr")];
    const tr = rows.find((r) => r.innerText.startsWith(n));
    const total = (document.body.innerText.match(/Total stock value:\s*([^\n]*)/) || [])[1];
    if (!tr) return { found: false, total, sample: rows.slice(0, 3).map((r) => r.innerText.split("\n")[0]) };
    const cells = [...tr.querySelectorAll("td")].map((c) => c.innerText.trim());
    return { found: true, cells, total };
  }, name);
}

async function pickIngredient(page, name) {
  const trigger = page.locator('[role="dialog"] button:has-text("Select an ingredient")').first();
  await trigger.click();
  await page.waitForTimeout(1200);
  const search = page.locator('[role="dialog"] input[placeholder*="earch"], [cmdk-input], input[role="combobox"]').last();
  if (await search.count()) { await search.click(); await page.keyboard.type(name, { delay: 30 }); await page.waitForTimeout(1800); }
  const opt = page.locator(`[role="option"]:has-text("${name}"), [cmdk-item]:has-text("${name}")`).first();
  if (!(await opt.count())) {
    const all = await page.evaluate(() => [...document.querySelectorAll('[role="option"],[cmdk-item]')].map((o) => o.innerText.trim()).slice(0, 8));
    console.log("     !! no option matched; visible options:", JSON.stringify(all));
    return false;
  }
  await opt.click(); await page.waitForTimeout(1200);
  return true;
}

async function main() {
  const browser = await chromium.launch();
  const { page } = await newCtx(browser, { width: 1440, height: 950 });
  const api = [];
  page.on("response", (r) => { if (/\/inventory\//.test(r.url()) && r.request().method() !== "GET") api.push(`${r.request().method()} ${r.status()} ${r.url().split("/api/v1")[1]?.split("?")[0]}`); });
  if (!(await login(page, persona))) { console.log("LOGIN FAILED"); process.exit(1); }

  const before = await readRow(page, TARGET);
  console.log(`\n=== BASELINE "${TARGET}" ===\n  ${JSON.stringify(before)}`);

  // ── RECEIPT ────────────────────────────────────────────────────────────────
  console.log("\n=== RECORD A STOCK RECEIPT (qty 7 @ Rs 100) ===");
  api.length = 0;
  await page.locator('button:has-text("Receipt")').first().click();
  await page.waitForTimeout(1800);
  if (await pickIngredient(page, TARGET)) {
    await page.locator('[role="dialog"] input[name="lines.0.qty"]').fill("7");
    await page.locator('[role="dialog"] input[name="lines.0.unitCostRupees"]').fill("100.00");
    await page.waitForTimeout(600);
    await shot(page, `receipt-filled-${persona}`);
    const submit = page.locator('[role="dialog"] button:has-text("Record receipt")').first();
    console.log("  submit disabled:", await submit.isDisabled());
    await submit.click();
    await page.waitForTimeout(4000);
    const err = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return { stillOpen: !!d, msg: d ? d.innerText.slice(0, 300).replace(/\n+/g, " | ") : null,
        toast: [...document.querySelectorAll("[data-sonner-toast],[role=alert]")].map((t) => t.innerText.trim()).join(" ~ ") };
    });
    console.log("  after submit:", JSON.stringify(err).slice(0, 500));
    console.log("  api:", JSON.stringify(api));
    await shot(page, `receipt-submitted-${persona}`);
  }
  const afterReceipt = await readRow(page, TARGET);
  console.log("  AFTER RELOAD:", JSON.stringify(afterReceipt));
  console.log("  >>> receipt moved on-hand:", before.cells?.[2], "->", afterReceipt.cells?.[2]);

  // ── COUNT ──────────────────────────────────────────────────────────────────
  console.log("\n=== POST A PHYSICAL STOCK COUNT (set to 42) ===");
  api.length = 0;
  await page.locator('button:has-text("Count")').first().click();
  await page.waitForTimeout(2200);
  const cnt = page.locator(`[role="dialog"] input[aria-label*="Counted quantity for ${TARGET}"]`).first();
  if (!(await cnt.count())) {
    const s = page.locator('[role="dialog"] input[placeholder*="earch"]').first();
    if (await s.count()) { await s.click(); await page.keyboard.type(TARGET, { delay: 30 }); await page.waitForTimeout(1500); }
  }
  const cnt2 = page.locator(`[role="dialog"] input[aria-label*="${TARGET}"]`).first();
  if (await cnt2.count()) {
    await cnt2.fill("42");
    await page.waitForTimeout(800);
    await shot(page, `count-filled-${persona}`);
    const post = page.locator('[role="dialog"] button:has-text("Post count")').first();
    console.log("  post disabled:", await post.isDisabled());
    await post.click();
    await page.waitForTimeout(4500);
    const st = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return { stillOpen: !!d, msg: d ? d.innerText.slice(0, 300).replace(/\n+/g, " | ") : null,
        toast: [...document.querySelectorAll("[data-sonner-toast],[role=alert]")].map((t) => t.innerText.trim()).join(" ~ ") };
    });
    console.log("  after post:", JSON.stringify(st).slice(0, 400));
    console.log("  api:", JSON.stringify(api));
    await shot(page, `count-posted-${persona}`);
  } else { console.log("  !! could not find a counted-quantity input for", TARGET); }

  const afterCount = await readRow(page, TARGET);
  console.log("  AFTER RELOAD:", JSON.stringify(afterCount));
  console.log("  >>> count set on-hand to:", afterCount.cells?.[2], "| last counted:", afterCount.cells?.[6]);
  console.log("  >>> total stock value:", before.total, "->", afterCount.total);

  await browser.close();
}
main();
