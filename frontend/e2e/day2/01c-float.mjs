/* DAY 2 — step 1c: the manager counts Rs 5,000.00 into the named cashier's drawer,
 * then the cashier signs in and reads their own strip. */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, finding, apiGet, log, BASE } from "./lib.mjs";

const S = loadState();
const NEW = S.newCashier;
const browser = await newBrowser();

const mgr = await newPage(browser);
await login(mgr, PEOPLE.manager);
await go(mgr, "/app/pos/tills", { waitMs: 4000 });
await mgr.getByRole("button", { name: /open a drawer/i }).first().click();
await mgr.waitForTimeout(1200);
const sel = mgr.locator("#open-drawer-cashier");
const opts = await sel.locator("option").allTextContents();
const label = opts.find((o) => o.includes(NEW.fullName));
log("  choosing:", label);
await sel.selectOption({ label });
await mgr.waitForTimeout(500);
const dlgInputs = await mgr.evaluate(() =>
  Array.from(document.querySelectorAll("[role=dialog] input")).map((i) => ({ id: i.id, ph: i.getAttribute("placeholder"), type: i.type })),
);
log("  dialog inputs now:", JSON.stringify(dlgInputs));
const floatBox = mgr.locator("[role=dialog] input").first();
await floatBox.fill("5000");
await mgr.waitForTimeout(300);
await shot(mgr, "01f-float-filled");
const dlgBtns = await mgr.evaluate(() => Array.from(document.querySelectorAll("[role=dialog] button")).map((b) => b.textContent.trim()));
log("  dialog buttons:", JSON.stringify(dlgBtns));
const confirm = mgr.locator("[role=dialog] button").filter({ hasText: /open (the )?drawer|hand (it )?over|confirm/i });
log("  confirm candidates:", await confirm.count());
await confirm.last().click();
await mgr.waitForTimeout(4000);
await shot(mgr, "01g-after-open-drawer");
const after = await mgr.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 700));
log("  till screen after:", after.slice(0, 500));

// ── the cashier reads their own drawer ───────────────────────────────────────
const cash = await newPage(browser);
await cash.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await cash.waitForTimeout(1200);
const slug = cash.locator('input[name="tenantSlug"], input#tenantSlug');
if (await slug.count()) await slug.first().fill(NEW.slug);
await cash.locator('input[name="email"], input#email').first().fill(NEW.email);
await cash.locator('input[name="password"], input#password').first().fill(NEW.newPassword);
await cash.locator('button[type="submit"]').first().click();
await cash.waitForTimeout(5000);
const tr = await go(cash, "/app/pos", { waitMs: 8000 });
log("  cashier /app/pos trouble:", JSON.stringify(tr.bad));
await shot(cash, "01h-cashier-pos-strip");
const strip = await cash.evaluate(() => {
  const b = document.querySelector("[data-testid=close-till-button]");
  if (b) return b.parentElement.innerText.replace(/\s+/g, " ").trim();
  const t = (document.body.innerText || "");
  const m = t.match(/(No active till[^\n]*|Till OPEN[^\n]*)/);
  return m ? m[0] : "(no strip found)";
});
log("  CASHIER STRIP:", strip);
const tills = await apiGet(cash, "/api/v1/pos/tills/mine");
log("  /tills/mine ->", tills.status, JSON.stringify(tills.body).slice(0, 400));
saveState({ cashierStrip: strip, floatOpenedBy: "manager" });
await browser.close();
