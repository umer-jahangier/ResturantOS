/*
 * SHIFT STEP 1b — yesterday's drawer is cashed up, today's is counted in.
 *
 * The shared database carries other runs' till sessions. A day's takings can only be
 * checked "to the paisa" against a drawer whose opening moment is known, so the cashier
 * closes the drawer they inherited and counts a fresh Rs 5,000.00 float in — which is
 * literally what a cashier does at the start of a shift.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, finding, apiGet, log } from "./lib.mjs";

const browser = await newBrowser();
const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);
await go(cash, "/app/pos", { waitMs: 6000 });

const me = await apiGet(cash, "/api/v1/auth/me");
log("  /auth/me:", JSON.stringify(me.body).slice(0, 400));

const open = await apiGet(cash, "/api/v1/pos/tills?status=OPEN");
log("  open tills visible to cashier:", JSON.stringify(open.body).slice(0, 900));

// Close the inherited drawer through the SCREEN, not the API.
const hasClose = await cash.locator("[data-testid=close-till-button]").count();
if (hasClose) {
  await cash.locator("[data-testid=close-till-button]").click();
  await cash.waitForTimeout(900);
  const panel = await cash.evaluate(() => {
    const p = document.querySelector("[data-testid=close-till-panel]");
    return p ? p.innerText.replace(/\s+/g, " ").trim() : null;
  });
  log("  close panel says:", panel);
  await shot(cash, "01h-inherited-drawer-close-panel");
  // Declare exactly what the screen says it expects — a perfect count.
  const expected = /Expected cash: Rs ([\d,]+\.\d\d)/.exec(panel ?? "")?.[1]?.replace(/,/g, "");
  log("  expected cash on the panel:", expected);
  await cash.locator("[data-testid=close-till-panel] input[type=number]").first().fill(expected ?? "0");
  await cash.locator("[data-testid=close-till-confirm-button]").click();
  await cash.waitForTimeout(4000);
  const err = await cash.evaluate(
    () => document.querySelector("[data-testid=close-till-error]")?.textContent?.trim() ?? null,
  );
  log("  close error:", err);
  await shot(cash, "01i-after-close-attempt");
  if (err) {
    finding({
      id: "SHIFT-02",
      sev: "obs",
      what: `closing the inherited drawer was refused: "${err}"`,
    });
  }
}

// Open today's drawer with a counted Rs 5,000.00 float.
await cash.reload({ waitUntil: "domcontentloaded" });
await cash.waitForTimeout(5000);
const canOpen = await cash.locator("[data-testid=open-till-button]").count();
log("  open-till button present:", canOpen);
if (canOpen) {
  await cash.locator("[data-testid=open-till-button]").click();
  await cash.waitForTimeout(700);
  await cash.locator("[data-testid=open-till-panel] input").first().fill("5000");
  await cash.locator("[data-testid=open-till-confirm-button]").click();
  await cash.waitForTimeout(4000);
  await shot(cash, "01j-todays-drawer-open");
}
const strip = await cash.evaluate(() => {
  const b = document.querySelector("[data-testid=close-till-button]");
  return b ? b.parentElement.innerText.replace(/\s+/g, " ").trim() : document.body.innerText.slice(0, 200);
});
log("  till strip now:", strip);

const openNow = await apiGet(cash, "/api/v1/pos/tills?status=OPEN");
const mine = (Array.isArray(openNow.body) ? openNow.body : openNow.body?.data ?? []).filter(Boolean);
log("  my open till rows:", JSON.stringify(mine).slice(0, 800));
saveState({ shiftTill: mine[0] ?? null, shiftTillId: mine[0]?.id ?? null });

await browser.close();
log("\nstep 1b done");
