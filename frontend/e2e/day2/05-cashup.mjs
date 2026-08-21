/* DAY 2 — step 5: CASH UP. Serve and close both checks, then the cashier counts the drawer:
 * does the panel show EXPECTED cash and the VARIANCE before they count, and does it close? */
import { newBrowser, newPage, go, shot, saveState, loadState, finding, apiGet, apiSend, log, BASE, PEOPLE, login } from "./lib.mjs";

const S = loadState();
const NEW = S.newCashier;
const B = S.branchId;
const browser = await newBrowser();
const cash = await newPage(browser);
await cash.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await cash.waitForTimeout(1400);
const sl = cash.locator('input[name="tenantSlug"], input#tenantSlug');
if (await sl.count()) await sl.first().fill(NEW.slug);
await cash.locator('input[name="email"]').first().fill(NEW.email);
await cash.locator('input[name="password"]').first().fill(NEW.newPassword);
await cash.locator('button[type="submit"]').first().click();
await cash.waitForTimeout(6000);

// ── the cashier's view of a PAID check (does the notice name a button they have?) ──
await go(cash, "/app/pos", { waitMs: 7000 });
await cash.getByText("Order Management", { exact: true }).first().click();
await cash.waitForTimeout(4000);
const ORD2 = (S.order2 ?? [])[0];
await cash.locator('input[placeholder*="Search" i], input[type=search]').last().fill(ORD2);
await cash.waitForTimeout(3000);
await cash.locator(`[aria-label^="Open order ${ORD2}"]`).first().click();
await cash.waitForTimeout(3500);
const cashierPaidView = await cash.evaluate(() => {
  const d = document.querySelector("[role=dialog]");
  return {
    notice: document.querySelector("[data-testid=void-blocked-paid-notice]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
    btns: Array.from((d ?? document).querySelectorAll("button")).map((b) => b.textContent.trim()).filter(Boolean),
  };
});
log("  CASHIER on a PAID check:", JSON.stringify(cashierPaidView));
await shot(cash, "05a-cashier-paid-check-notice");

// ── serve + close both checks ────────────────────────────────────────────────
for (const no of [ORD2, S.order1.no]) {
  await go(cash, "/app/pos", { waitMs: 6000 });
  await cash.getByText("Order Management", { exact: true }).first().click();
  await cash.waitForTimeout(3500);
  await cash.locator('input[placeholder*="Search" i], input[type=search]').last().fill(no);
  await cash.waitForTimeout(3000);
  await cash.locator(`[aria-label^="Open order ${no}"]`).first().click();
  await cash.waitForTimeout(3000);
  for (let i = 0; i < 8; i++) {
    const ms = cash.locator("[role=dialog] button").filter({ hasText: /^Mark Served$/ });
    if (!(await ms.count())) break;
    await ms.first().click();
    await cash.waitForTimeout(1800);
  }
  await cash.waitForTimeout(1500);
  const st = await cash.evaluate(() => (document.querySelector("[role=dialog]")?.innerText ?? "").replace(/\s+/g, " ").slice(0, 300));
  log(`  ${no} after serving:`, st.slice(0, 220));
  const charge = cash.locator("[role=dialog] button").filter({ hasText: /charge now/i });
  if (await charge.count()) { await charge.first().click(); await cash.waitForTimeout(7000); }
  const closeBtn = cash.locator("[data-testid=close-order-button]");
  log(`  close-order button on ${no}:`, await closeBtn.count());
  if (await closeBtn.count()) {
    await closeBtn.first().click();
    await cash.waitForTimeout(5000);
    const chip = await cash.evaluate(() => ({
      closed: document.querySelector("[data-testid=charge-closed-chip]")?.innerText.trim() ?? null,
      err: document.querySelector("[data-testid=close-order-error]")?.innerText.trim() ?? null,
    }));
    log(`  ${no} close ->`, JSON.stringify(chip));
  }
  await shot(cash, `05b-closed-${no}`);
}

// ── the close-till panel ─────────────────────────────────────────────────────
await go(cash, "/app/pos", { waitMs: 8000 });
const strip = await cash.evaluate(() => {
  const b = document.querySelector("[data-testid=close-till-button]");
  return b ? b.parentElement.innerText.replace(/\s+/g, " ").trim() : "(no till)";
});
log("\n  STRIP:", strip);
await cash.locator("[data-testid=close-till-button]").click();
await cash.waitForTimeout(2500);
await shot(cash, "05c-close-till-panel");
const panel = await cash.evaluate(() => {
  const p = document.querySelector("[data-testid=close-till-panel]") ?? document.querySelector("[role=dialog]");
  return p ? {
    text: p.innerText.replace(/\s+/g, " ").trim().slice(0, 900),
    expected: document.querySelector("[data-testid=close-till-expected]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
    variance: document.querySelector("[data-testid=close-till-variance]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
    inputs: Array.from(p.querySelectorAll("input,textarea")).map((i) => ({ id: i.id, ph: i.getAttribute("placeholder") })),
    btns: Array.from(p.querySelectorAll("button")).map((b) => b.textContent.trim()),
  } : null;
});
log("  CLOSE-TILL PANEL:", JSON.stringify(panel, null, 1).slice(0, 1600));

// count it SHORT by Rs 50 on purpose so the variance has to say something
const countBox = cash.locator("[data-testid=close-till-panel] input, [role=dialog] input").first();
const expectedTxt = panel?.expected ?? "";
const m = /Rs ([\d,]+\.\d\d)/.exec(expectedTxt);
const expected = m ? Number(m[1].replace(/,/g, "")) : null;
const declared = expected != null ? (expected - 50).toFixed(2) : "5000";
log("  expected read from screen:", expected, "-> declaring", declared);
await countBox.fill(declared);
await cash.waitForTimeout(1800);
const afterCount = await cash.evaluate(() => ({
  variance: document.querySelector("[data-testid=close-till-variance]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
  text: (document.querySelector("[data-testid=close-till-panel]") ?? document.querySelector("[role=dialog]"))?.innerText.replace(/\s+/g, " ").trim().slice(0, 700) ?? null,
}));
log("  VARIANCE AFTER COUNTING:", JSON.stringify(afterCount).slice(0, 800));
await shot(cash, "05d-variance-preview");
const note = cash.locator("[data-testid=close-till-panel] textarea, [role=dialog] textarea").first();
if (await note.count()) await note.fill("Day 2 — Rs 50.00 short, counted twice");
const confirm = cash.locator("[role=dialog] button, [data-testid=close-till-panel] button").filter({ hasText: /close till|confirm/i });
log("  confirm buttons:", await confirm.count());
await confirm.last().click();
await cash.waitForTimeout(6000);
await shot(cash, "05e-after-close");
const after = await cash.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 600));
log("  AFTER CLOSING:", after.slice(0, 500));
saveState({ cashup: { cashierPaidView, strip, panel, afterCount, declared, after } });
await browser.close();
