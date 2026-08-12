/*
 * F13 — "on a paid check the cashier is told to Use Refund and the Refund button is invisible".
 *
 * Thin wrapper over the B2 harness (same login / same own-bearer read discipline), with the
 * screenshot + state directory repointed at .planning/audits/floor/F13. Everything else is
 * re-exported so this file stays a redirect, not a fork.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export {
  PEOPLE, newBrowser, newPage, login, go, apiGet, apiSend, tokenOf, branchOf,
  ringAndFire, openInOrderManagement, orderRow, money, log, BASE, API, pageTrouble,
} from "../b2/lib.mjs";

import { log } from "../b2/lib.mjs";

export const OUT = resolve(process.cwd(), "../.planning/audits/floor/F13");
export const STATE = resolve(OUT, "_state.json");
mkdirSync(OUT, { recursive: true });

export function loadState() {
  if (!existsSync(STATE)) return {};
  return JSON.parse(readFileSync(STATE, "utf8"));
}
export function saveState(patch) {
  const s = { ...loadState(), ...patch };
  writeFileSync(STATE, JSON.stringify(s, null, 2));
  return s;
}

export async function shot(page, name) {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  log(`    shot: ${name}.png`);
  return p;
}

/**
 * Everything the drawer offers on one order, as the signed-in persona sees it: the notice text
 * verbatim, and every button's visible label AND accessible name (finding #17 in the walkthrough
 * is exactly the gap between those two).
 */
export async function drawerProbe(page) {
  return page.evaluate(() => {
    const d = document.querySelector("[data-testid=order-table-detail-drawer]") || document.body;
    const notice = document.querySelector("[data-testid=void-blocked-paid-notice]");
    return {
      notice: notice?.textContent?.trim() ?? null,
      buttons: Array.from(d.querySelectorAll("button"))
        .map((b) => ({
          text: (b.textContent || "").replace(/\s+/g, " ").trim(),
          aria: b.getAttribute("aria-label"),
        }))
        .filter((b) => b.text || b.aria),
      refundTrigger: !!document.querySelector('[aria-label="Refund order"]'),
      voidTrigger: !!document.querySelector('[aria-label="Void order"]'),
    };
  });
}

/**
 * Count a float into the persona's own drawer if it is closed. The drawer belongs to whoever
 * presses the button (walkthrough §0), so every persona that rings a check opens their own.
 */
export async function ensureTill(page, goFn, floatRs = "5000") {
  await goFn(page, "/app/pos", { waitMs: 8000 });
  const btn = page.locator("[data-testid=open-till-button]");
  if (!(await btn.count())) {
    log("  till already open");
    return "already-open";
  }
  await btn.first().click();
  await page.waitForTimeout(1800);
  await page.locator("[data-testid=open-till-panel] input").first().fill(floatRs);
  await page.locator("[data-testid=open-till-confirm-button]").click();
  await page.waitForTimeout(6000);
  const err = await page.evaluate(
    () => document.querySelector("[data-testid=open-till-error]")?.textContent?.trim() ?? null,
  );
  log("  opened till with Rs", floatRs, "err:", err);
  return err ?? "opened";
}

/** Take full cash on the charge page, by clicking, as the persona. */
export async function payInFullByClicking(page, orderId, label) {
  await page.goto(`${(await import("../b2/lib.mjs")).BASE}/app/pos/orders/${orderId}/charge`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(6000);
  const fill = page.locator("[data-testid=fill-full-amount-button]");
  if (await fill.count()) {
    await fill.first().click();
    await page.waitForTimeout(700);
  }
  const amount = page.locator('[aria-label="Amount (Rs)"]').first();
  const amountVal = await amount.inputValue().catch(() => null);
  const tendered = page.locator('[aria-label="Tendered (Rs)"]').first();
  if (await tendered.count()) {
    await tendered.fill(amountVal || "0");
    await page.waitForTimeout(800);
  }
  await shot(page, `${label}-charge-before-record`);
  await page.locator("[data-testid=record-payment-button]").click();
  await page.waitForTimeout(6500);
  await shot(page, `${label}-charge-after-record`);
  return page.evaluate(() => ({
    err: document.querySelector("[data-testid=record-payment-error]")?.textContent?.trim() ?? null,
    paid: document.querySelector("[data-testid=paid-chip]")?.textContent?.trim() ?? null,
    rows: Array.from(document.querySelectorAll("[data-testid=payment-history-rows] > *"))
      .map((n) => n.innerText.replace(/\s+/g, " ").trim()),
  }));
}
