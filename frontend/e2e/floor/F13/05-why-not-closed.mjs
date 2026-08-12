/*
 * F13 STEP 5 — why "Mark served & close order" leaves the check SENT_TO_KDS.
 * Not my item; captured precisely so it can be reported rather than hand-waved.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, apiGet, tokenOf, log } from "./lib.mjs";

const st = loadState();
const orderId = process.argv[2] ?? st.closedOrderId;
const orderNo = st.closedOrderNo;
log("  order:", orderNo, orderId);

const browser = await newBrowser();
const p = await newPage(browser);
await login(p, PEOPLE.cashier);
const tok = await tokenOf(p);

const before = await apiGet(p, `/api/v1/pos/orders/${orderId}`, tok);
log("  status BEFORE:", before.body?.data?.status,
    "items:", JSON.stringify((before.body?.data?.items ?? []).map((i) => `${i.itemNameSnapshot}:${i.status ?? i.itemStatus}`)));

await go(p, `/app/pos/orders/${orderId}/charge`, { waitMs: 7000 });
const btn = await p.evaluate(() => {
  const b = document.querySelector("[data-testid=close-order-button]");
  return b ? { text: b.textContent.trim(), disabled: b.disabled } : null;
});
log("  close control:", JSON.stringify(btn));
p.__requests.length = 0;
if (btn && !btn.disabled) {
  await p.locator("[data-testid=close-order-button]").click();
  await p.waitForTimeout(9000);
}
await shot(p, "05a-after-close-click");
const after = await p.evaluate(() => ({
  err: document.querySelector("[data-testid=close-order-error]")?.textContent?.trim() ?? null,
  chip: document.querySelector("[data-testid=charge-closed-chip]")?.textContent?.trim() ?? null,
  alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
  toasts: Array.from(document.querySelectorAll("[data-sonner-toast]")).map((n) => n.innerText.trim()),
  btnNow: (() => { const b = document.querySelector("[data-testid=close-order-button]"); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null; })(),
}));
log("  screen after the click:", JSON.stringify(after, null, 1));
log("  network on that click:", JSON.stringify(p.__requests.filter((r) => /orders/.test(r.u)), null, 1));
log("  console errors:", JSON.stringify(p.__console.slice(0, 6)));

const post = await apiGet(p, `/api/v1/pos/orders/${orderId}`, tok);
log("  status AFTER:", post.body?.data?.status,
    "items:", JSON.stringify((post.body?.data?.items ?? []).map((i) => `${i.itemNameSnapshot}:${i.status ?? i.itemStatus}`)));
saveState({ closeProbe: { before: before.body?.data?.status, after: post.body?.data?.status, screen: after, net: p.__requests.filter((r) => /orders/.test(r.u)) } });
await browser.close();
