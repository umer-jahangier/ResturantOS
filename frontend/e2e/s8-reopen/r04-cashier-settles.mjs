/*
 * S8 RE-OPEN — step 4. The CASHIER's half, driven by me.
 *
 * The till's receipt printer is on the queue *I* picked in step 3 (_80Series2), not the one the
 * previous run left. So this run proves the picker's choice is what actually receives the bill.
 */
import { statSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { newBrowser, newPage, login, go, PEOPLE, apiGet, branchOf, printCount } from "../s8/lib.mjs";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S8-reopen");
mkdirSync(OUT, { recursive: true });
const GRILL = process.env.GRILL_CAPTURE;
const size = (f) => {
  try {
    return statSync(f).size;
  } catch {
    return 0;
  }
};
const cupsJobs = () => {
  try {
    return execFileSync("lpstat", ["-o"], { encoding: "utf8" })
      .split("\n")
      .map((l) => l.trim().split(/\s+/)[0])
      .filter(Boolean);
  } catch {
    return [];
  }
};

const rec = { checks: [] };
const check = (n, p, d) => {
  console.log(`  ${p ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);
  rec.checks.push({ name: n, pass: p, detail: d });
};
const say = (k, v) => {
  console.log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  rec[k] = v;
};

rec.grillBefore = size(GRILL);
rec.cupsBefore = cupsJobs();
say("grillCaptureBefore", rec.grillBefore);
say("cupsPendingBefore", rec.cupsBefore.slice(-4));

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.cashier);
  let branchId = null;
  for (let i = 0; i < 6 && !branchId; i += 1) {
    try {
      branchId = await branchOf(page);
    } catch {
      await page.waitForTimeout(3000);
    }
  }

  await go(page, "/app/pos", { waitMs: 9000, allowTrouble: true });
  const tillText = await page.evaluate(() => document.body.innerText.slice(0, 1200));
  if (/No active till|Open till|open a till/i.test(tillText)) {
    const openBtn = page.getByRole("button", { name: /open till/i });
    if (await openBtn.count()) {
      await openBtn.first().click();
      await page.waitForTimeout(1500);
      const float = page.locator('input[type="text"], input[type="number"]').last();
      if (await float.count()) await float.fill("5000");
      await page.waitForTimeout(400);
      await page.getByRole("button", { name: /open till|confirm|start/i }).last().click();
      await page.waitForTimeout(4500);
    }
  }

  await go(page, "/app/pos", { waitMs: 9000, allowTrouble: true });
  await page.locator("[data-testid=order-type-takeaway]").click();
  await page.waitForTimeout(700);
  const search = page.getByLabel(/search menu/i);
  if (await search.count()) {
    await search.first().fill("Butter Naan");
    await page.waitForTimeout(2500);
  }
  const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 30_000 });
  const names = await tiles.allTextContents();
  const idx = names.findIndex((n) => /Butter Naan/i.test(n));
  if (idx < 0) throw new Error(`no Butter Naan: ${JSON.stringify(names.slice(0, 8))}`);
  await tiles.nth(idx).click();
  await page.waitForTimeout(900);
  await page.locator("[data-testid=send-to-kitchen-button]").click();
  await page.waitForTimeout(9000);
  const orderNo = await page.evaluate(
    () => Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0])))[0] ?? null,
  );
  if (!orderNo) throw new Error("no order number after firing");
  say("orderNo", orderNo);
  await page.screenshot({ path: `${OUT}/r04a-fired.png` });

  for (let i = 0; i < 14; i += 1) {
    if (size(GRILL) > rec.grillBefore) break;
    await page.waitForTimeout(1500);
  }
  rec.grillAfter = size(GRILL);
  check(
    "the GRILL ticket reached the network printer's own socket",
    rec.grillAfter > rec.grillBefore,
    `${rec.grillBefore} → ${rec.grillAfter} bytes`,
  );
  if (rec.grillAfter > rec.grillBefore) {
    const text = readFileSync(GRILL)
      .subarray(rec.grillBefore)
      .toString("latin1")
      .replace(/\x1b.|\x1d./g, "");
    rec.grillText = text.slice(0, 400);
    check(
      "and the bytes decode to THIS order's grill ticket",
      text.includes(orderNo) && /Butter Naan/i.test(text) && /GRILL/i.test(text),
      JSON.stringify(text.replace(/\s+/g, " ").slice(0, 180)),
    );
  }

  // charge it
  await go(page, "/app/pos", { waitMs: 7000 });
  await page.getByText("Order Management", { exact: true }).click();
  await page.waitForTimeout(4500);
  await page.locator("[data-testid=order-management-search]").first().fill(orderNo);
  await page.waitForTimeout(4500);
  const orderId = await page.evaluate(
    () =>
      document.querySelector('[data-testid^="open-order-"]')?.getAttribute("data-testid")?.replace("open-order-", "") ??
      null,
  );
  if (!orderId) throw new Error("could not resolve the order id");
  say("orderId", orderId);

  await go(page, `/app/pos/orders/${orderId}/charge`, { waitMs: 7000 });
  const fill = page.locator("[data-testid=fill-full-amount-button]");
  if (await fill.count()) {
    await fill.first().click();
    await page.waitForTimeout(700);
  }
  const tendered = page.locator('[aria-label="Tendered (Rs)"]').first();
  if (await tendered.count()) {
    await tendered.fill("2000");
    await page.waitForTimeout(800);
  }
  await page.locator("[data-testid=record-payment-button]").click();
  await page.waitForTimeout(8000);
  await page.screenshot({ path: `${OUT}/r04b-paid.png` });

  await go(page, `/app/pos/orders/${orderId}/receipt`, { waitMs: 6000, allowTrouble: true });
  let state = null;
  for (let i = 0; i < 18; i += 1) {
    state = await page.evaluate(
      () => document.querySelector('[data-testid="delivery-notice"]')?.getAttribute("data-delivery-state") ?? null,
    );
    if (["ON_PAPER", "NO_AGENT", "REFUSED"].includes(state)) break;
    await page.waitForTimeout(2000);
  }
  rec.receipt = await page.evaluate(() => {
    const n = document.querySelector('[data-testid="delivery-notice"]');
    return n
      ? {
          state: n.getAttribute("data-delivery-state"),
          printer: n.getAttribute("data-target-printer"),
          text: n.innerText.replace(/\s+/g, " ").trim().slice(0, 260),
        }
      : { state: null, text: document.body.innerText.replace(/\s+/g, " ").slice(0, 260) };
  });
  say("receiptNotice", rec.receipt);
  check("the bill reached paper by itself and the screen says so", rec.receipt.state === "ON_PAPER", rec.receipt.state);
  await page.screenshot({ path: `${OUT}/r04c-receipt.png` });

  rec.windowPrint = await printCount(page);
  check(
    "no browser print dialog was opened at ANY point in the cashier's journey",
    rec.windowPrint.inPage === 0 && rec.windowPrint.recorded === 0,
    JSON.stringify(rec.windowPrint),
  );

  // Did the bill land on the queue *I* chose, and not the other one?
  await page.waitForTimeout(3000);
  rec.cupsAfter = cupsJobs();
  const newJobs = rec.cupsAfter.filter((j) => !rec.cupsBefore.includes(j));
  say("newCupsJobs", newJobs);
  check(
    "the raw job landed on the queue I picked in the SELECT (_80Series2)",
    newJobs.length > 0 && newJobs.every((j) => j.startsWith("_80Series2")),
    JSON.stringify(newJobs),
  );

  // and what the cashier is NOT allowed to read
  const h = await apiGet(page, `/api/v1/pos/printers/health?branchId=${branchId}`);
  say("cashierHealth", { status: h.status, body: JSON.stringify(h.body).slice(0, 200) });
  check("a CASHIER is refused the printer-health endpoint", h.status === 403, String(h.status));
} catch (e) {
  check("harness completed", false, String(e));
} finally {
  writeFileSync(`${OUT}/r04-cashier.json`, JSON.stringify(rec, null, 2));
  const bad = rec.checks.filter((c) => !c.pass).length;
  console.log(`\n  ${rec.checks.length - bad}/${rec.checks.length} checks passed`);
  await browser.close();
}
