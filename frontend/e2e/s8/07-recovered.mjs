/*
 * S8 step 7 — the printer is back on; the next ticket clears the accusation.
 *
 * Step 6 restarted the printer and the screen kept saying GRILL cannot print, which is CORRECT and
 * worth pinning: the held ticket had already spent its five attempts and was dead-lettered, so the
 * last thing that happened to that printer really did fail. "The printer is plugged in again" is
 * not evidence that it prints. The next ticket is.
 */
import { newBrowser, newPage, login, go, shot, apiGet, branchOf, PEOPLE, OUT } from "./lib.mjs";
import { statSync, writeFileSync } from "node:fs";

const GRILL_PORT = Number(process.env.S8_GRILL_PORT ?? 9105);
const GRILL_CAPTURE = process.env.S8_GRILL_CAPTURE;
const size = () => {
  try {
    return statSync(GRILL_CAPTURE).size;
  } catch {
    return 0;
  }
};

const evidence = { grillBytesBefore: size() };
const browser = await newBrowser();

const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);
await go(cash, "/app/pos", { waitMs: 9000, allowTrouble: true });
await cash.locator("[data-testid=order-type-takeaway]").click();
await cash.waitForTimeout(700);
const search = cash.getByLabel(/search menu/i);
if (await search.count()) {
  await search.first().fill("Butter Naan");
  await cash.waitForTimeout(2200);
}
const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 30_000 });
const names = await tiles.allTextContents();
const idx = names.findIndex((n) => /Butter Naan/i.test(n));
if (idx < 0) throw new Error("Butter Naan not on the grid");
await tiles.nth(idx).click();
await cash.waitForTimeout(900);
await cash.locator("[data-testid=send-to-kitchen-button]").click();
await cash.waitForTimeout(9000);
evidence.orderNo = (
  await cash.evaluate(() =>
    Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0]))),
  )
)[0];
console.log("  fired with the GRILL printer back on:", evidence.orderNo);

for (let i = 0; i < 15; i += 1) {
  if (size() > evidence.grillBytesBefore) break;
  await cash.waitForTimeout(1500);
}
evidence.grillBytesAfter = size();
console.log(`  GRILL capture: ${evidence.grillBytesBefore} → ${evidence.grillBytesAfter}`);

const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
const branchId = await branchOf(owner);
for (let i = 0; i < 15; i += 1) {
  const res = await apiGet(owner, `/api/v1/pos/printers/health?branchId=${branchId}`);
  const grill = (res.body?.data?.printers ?? []).find((p) => p.printerId === `grill-${GRILL_PORT}`);
  if (grill?.state === "PRINTING") break;
  await owner.waitForTimeout(2000);
}
await go(owner, "/app/settings/printers", { waitMs: 7000 });
await owner.waitForTimeout(2500);
evidence.screen = await owner.evaluate(() => {
  const failing = document.querySelector('[data-testid="printers-failing"]');
  const row = Array.from(document.querySelectorAll('[data-testid="printer-row"]')).find((r) =>
    /grill/i.test(r.getAttribute("data-printer-id") ?? ""),
  );
  return {
    failingText: failing ? failing.innerText.replace(/\s+/g, " ").trim() : null,
    grill: row
      ? {
          state: row.querySelector('[data-testid="printer-delivery"]')?.getAttribute("data-delivery-state"),
          badge: row.querySelector('[data-testid="printer-delivery"]')?.textContent?.trim(),
        }
      : null,
  };
});
console.log("  screen:", JSON.stringify(evidence.screen, null, 2));
await shot(owner, "07-grill-printing-again");

writeFileSync(`${OUT}/07-recovered.json`, JSON.stringify(evidence, null, 2));
await browser.close();
