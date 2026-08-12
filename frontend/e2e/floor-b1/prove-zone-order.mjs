/*
 * B1 / S0-C, part 4 — with the branch on America/New_York (00:5x local, still last night's
 * service) ring and settle a cash check. If the branch zone truly drives all three call sites,
 * the order number, the Takings day and the ORDER_REVENUE entry date must all read the NEW YORK
 * trading day, which is the PREVIOUS calendar day from UTC's answer.
 */
import { PEOPLE, newBrowser, newPage, login, go, log } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/B1";
mkdirSync(OUT, { recursive: true });
const journal = {};
const record = (k, v) => {
  journal[k] = v;
  log(`  ${k}: ${JSON.stringify(v)}`);
  writeFileSync(`${OUT}/prove-zone-order.json`, JSON.stringify(journal, null, 2));
};
const shot = async (p, n) => {
  await p.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
  log(`    shot: ${n}.png`);
};

const browser = await newBrowser();
const p = await newPage(browser);
await login(p, PEOPLE.manager);
record("clock", {
  utc: new Date().toISOString(),
  karachi: new Date().toLocaleString("en-GB", { timeZone: "Asia/Karachi" }),
  newYork: new Date().toLocaleString("en-GB", { timeZone: "America/New_York" }),
});

await go(p, "/app/pos", { waitMs: 8000 });
const openTill = p.locator("[data-testid=open-till-button]");
if (await openTill.count()) {
  await openTill.first().click();
  await p.waitForTimeout(1500);
  const float = p.locator('input[type="number"], input[inputmode="decimal"]').first();
  if (await float.count()) await float.fill("5000");
  const confirm = p.getByRole("button", { name: /open till|confirm|start/i }).first();
  if (await confirm.count()) await confirm.click();
  await p.waitForTimeout(4000);
}
await p.locator("[data-testid=order-type-takeaway]").click();
await p.waitForTimeout(600);
const tiles = p.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 25000 });
await tiles.nth(0).click();
await p.waitForTimeout(600);
await p.locator("[data-testid=send-to-kitchen-button]").click();
await p.waitForTimeout(7000);
const rung = await p.evaluate(() => [
  ...new Set([...document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)].map((m) => m[0])),
]);
record("orderNumbersOnScreen", rung);
await shot(p, "70-newyork-order-rung");

const orderNo = rung[0];
await p.getByText("Order Management", { exact: true }).click();
await p.waitForTimeout(4500);
await p.locator("[data-testid=order-management-search]").first().fill(orderNo);
await p.waitForTimeout(4500);
const orderId = await p.evaluate(
  () =>
    document
      .querySelector('[data-testid^="open-order-"]')
      ?.getAttribute("data-testid")
      ?.replace("open-order-", "") ?? null,
);
record("order", { orderNo, orderId });

await go(p, `/app/pos/orders/${orderId}/charge`, { waitMs: 7000 });
const fillFull = p.locator("[data-testid=fill-full-amount-button]");
if (await fillFull.count()) {
  await fillFull.first().click();
  await p.waitForTimeout(800);
}
await p.locator("[data-testid=record-payment-button]").click();
await p.waitForTimeout(7000);
const serve = p.getByRole("button", { name: /mark served|serve all|mark all served/i });
if (await serve.count()) {
  await serve.first().click();
  await p.waitForTimeout(6000);
}
await shot(p, "71-newyork-settled");

await go(p, "/app/finance/takings", { waitMs: 8000 });
await shot(p, "72-newyork-takings-default");
record(
  "takingsDefault",
  await p.evaluate(() => ({
    dateBox: document.querySelector("input[type=date]")?.value ?? null,
    orderLine:
      /(\d+) orders? closed on this trading day/.exec(document.body.innerText)?.[0] ?? null,
    cashRow:
      [...document.querySelectorAll("tr")]
        .map((r) => r.innerText.replace(/\s+/g, " ").trim())
        .find((r) => /^Cash/i.test(r)) ?? null,
  })),
);

await browser.close();
