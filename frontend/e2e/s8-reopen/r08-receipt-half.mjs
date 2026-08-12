/*
 * S8 RE-OPEN — step 8, the ADJACENT half nobody drove: the RECEIPT printer that cannot print.
 *
 * The fix was proven on a KITCHEN station. The same alert has a second branch — "The receipt
 * printer cannot print." — and the same rule has to hold for the till. Point the till printer at a
 * dead port, settle a check, and read BOTH surfaces: the owner's Printers screen and the cashier's
 * own bill screen, which must not promise paper it did not get.
 *
 * Restores the registry at the end, whatever happens.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { newBrowser, newPage, go, PEOPLE, apiGet, branchOf, totpFor, BASE, printCount } from "../s8/lib.mjs";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S8-reopen");
mkdirSync(OUT, { recursive: true });
const rec = { checks: [] };
const check = (n, p, d) => {
  console.log(`  ${p ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);
  rec.checks.push({ name: n, pass: p, detail: d });
};
const say = (k, v) => {
  console.log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  rec[k] = v;
};

async function login(page, who) {
  for (let a = 0; a < 4; a += 1) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
      if (await slug.count()) await slug.first().fill(who.slug);
      await page.locator('input[name="email"], input#email').first().fill(who.email);
      await page.locator('input[name="password"], input#password').first().fill(who.password);
      await page.locator('button[type="submit"]').first().click();
      if (who.totpSecret) {
        await page.locator('input[name="totpCode"], input#totpCode').first().waitFor({ timeout: 45_000 });
        for (let t = 0; t < 3; t += 1) {
          const f = page.locator('input[name="totpCode"], input#totpCode');
          if ((await f.count()) === 0) break;
          await f.first().fill(totpFor(who));
          await page.locator('button[type="submit"]').first().click();
          await page.waitForTimeout(6000);
          if (!page.url().includes("/login")) break;
        }
      } else await page.waitForTimeout(8000);
      await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 30_000 });
      console.log(`  ✓ signed in as ${who.email}`);
      return page;
    } catch {
      await page.waitForTimeout(4000);
    }
  }
  throw new Error(`login failed for ${who.email}`);
}

const saveScreen = async (page) => {
  await page.locator('[data-testid="save-printers"]').click();
  await page.waitForTimeout(4000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
};

const browser = await newBrowser();
const owner = await newPage(browser);
let restored = false;
try {
  await login(owner, PEOPLE.owner);
  let branchId = null;
  for (let i = 0; i < 6 && !branchId; i += 1) {
    try {
      branchId = await branchOf(owner);
    } catch {
      await owner.waitForTimeout(3000);
    }
  }
  await go(owner, "/app/settings/printers", { waitMs: 7000 });

  // ── point the till printer at a port with nothing on it ──────────────────────────────────
  await owner.locator("#transport-audit-receipt").selectOption("TCP");
  await owner.waitForTimeout(600);
  await owner.locator("#host-audit-receipt").fill("127.0.0.1");
  await owner.locator("#port-audit-receipt").fill("9199");
  await owner.waitForTimeout(600);
  await saveScreen(owner);
  const broken = await apiGet(owner, `/api/v1/branches/${branchId}/receipt-config`);
  const r = (broken.body?.data?.config?.printers ?? []).find((p) => p.role === "RECEIPT");
  say("brokenReceipt", r);
  check("the till printer now points at a dead port", r?.transport === "TCP" && r?.port === 9199, JSON.stringify(r));

  // ── settle a check ────────────────────────────────────────────────────────────────────────
  const till = await newPage(browser);
  await login(till, PEOPLE.cashier);
  await go(till, "/app/pos", { waitMs: 9000, allowTrouble: true });
  await till.locator("[data-testid=order-type-takeaway]").click();
  await till.waitForTimeout(700);
  const search = till.getByLabel(/search menu/i);
  if (await search.count()) {
    await search.first().fill("Butter Naan");
    await till.waitForTimeout(2500);
  }
  const tiles = till.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 30_000 });
  const names = await tiles.allTextContents();
  await tiles.nth(names.findIndex((n) => /Butter Naan/i.test(n))).click();
  await till.waitForTimeout(900);
  await till.locator("[data-testid=send-to-kitchen-button]").click();
  await till.waitForTimeout(9000);
  const orderNo = await till.evaluate(
    () => Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0])))[0] ?? null,
  );
  say("orderNo", orderNo);

  await go(till, "/app/pos", { waitMs: 7000 });
  await till.getByText("Order Management", { exact: true }).click();
  await till.waitForTimeout(4500);
  await till.locator("[data-testid=order-management-search]").first().fill(orderNo);
  await till.waitForTimeout(4500);
  const orderId = await till.evaluate(
    () =>
      document.querySelector('[data-testid^="open-order-"]')?.getAttribute("data-testid")?.replace("open-order-", "") ??
      null,
  );
  await go(till, `/app/pos/orders/${orderId}/charge`, { waitMs: 7000 });
  const fill = till.locator("[data-testid=fill-full-amount-button]");
  if (await fill.count()) {
    await fill.first().click();
    await till.waitForTimeout(700);
  }
  const tendered = till.locator('[aria-label="Tendered (Rs)"]').first();
  if (await tendered.count()) {
    await tendered.fill("2000");
    await till.waitForTimeout(800);
  }
  await till.locator("[data-testid=record-payment-button]").click();
  await till.waitForTimeout(8000);

  await go(till, `/app/pos/orders/${orderId}/receipt`, { waitMs: 6000, allowTrouble: true });
  let notice = null;
  for (let i = 0; i < 20; i += 1) {
    notice = await till.evaluate(() => {
      const n = document.querySelector('[data-testid="delivery-notice"]');
      return n
        ? { state: n.getAttribute("data-delivery-state"), text: n.innerText.replace(/\s+/g, " ").trim().slice(0, 300) }
        : null;
    });
    if (notice && ["REFUSED", "NO_AGENT", "NO_PRINTER"].includes(notice.state)) break;
    if (notice?.state === "ON_PAPER") break;
    await till.waitForTimeout(3000);
  }
  say("cashierNotice", notice);
  check(
    "the cashier's bill screen does NOT claim paper it never got",
    notice?.state !== "ON_PAPER",
    JSON.stringify(notice),
  );
  say("cashierWindowPrint", await printCount(till));
  await till.screenshot({ path: `${OUT}/r08a-cashier-notice.png` });

  // ── the owner's screen ────────────────────────────────────────────────────────────────────
  let seen = null;
  for (let i = 0; i < 14; i += 1) {
    await owner.reload({ waitUntil: "domcontentloaded" });
    await owner.waitForTimeout(4000);
    seen = await owner.evaluate(() => ({
      failing: (document.querySelector('[data-testid="printers-failing"]')?.innerText ?? "").trim(),
      receiptDelivery: (
        Array.from(document.querySelectorAll('[data-testid="printer-row"]')).find(
          (n) => n.getAttribute("data-printer-id") === "audit-receipt",
        )?.querySelector('[data-testid="printer-delivery"]')?.textContent ?? ""
      ).trim(),
    }));
    console.log(`    t+${i * 5}s failing="${seen.failing.slice(0, 80)}"`);
    if (/receipt printer cannot print/i.test(seen.failing)) break;
  }
  say("ownerScreen", seen);
  check(
    "the owner's screen names the TILL printer, not only kitchen stations",
    /receipt printer cannot print/i.test(seen.failing),
    seen.failing.slice(0, 220),
  );
  check(
    "and quotes the transport's own error for the till too",
    /9199/.test(seen.failing),
    seen.failing.slice(0, 260),
  );
  await owner.screenshot({ path: `${OUT}/r08b-receipt-cannot-print.png` });
} catch (e) {
  check("harness completed", false, String(e).slice(0, 220));
} finally {
  // ── restore, always ───────────────────────────────────────────────────────────────────────
  try {
    await go(owner, "/app/settings/printers", { waitMs: 7000 });
    await owner.locator("#transport-audit-receipt").selectOption("SYSTEM");
    await owner.waitForTimeout(800);
    await owner.locator('[data-testid="system-printer-picker"]').first().selectOption("STMicroelectronics_POS80_Printer_USB");
    await owner.waitForTimeout(600);
    await saveScreen(owner);
    const back = await owner.evaluate(() => {
      const row = Array.from(document.querySelectorAll('[data-testid="printer-row"]')).find(
        (n) => n.getAttribute("data-printer-id") === "audit-receipt",
      );
      return {
        transport: row?.querySelector("#transport-audit-receipt")?.value ?? null,
        queue: row?.querySelector('[data-testid="system-printer-picker"]')?.value ?? null,
      };
    });
    restored = back.transport === "SYSTEM" && back.queue === "STMicroelectronics_POS80_Printer_USB";
    say("restored", { restored, back });
  } catch (e) {
    say("restoreFailed", String(e).slice(0, 200));
  }
  rec.restored = restored;
  writeFileSync(`${OUT}/r08-receipt-half.json`, JSON.stringify(rec, null, 2));
  const bad = rec.checks.filter((c) => !c.pass).length;
  console.log(`\n  ${rec.checks.length - bad}/${rec.checks.length} checks passed · restored=${restored}`);
  await browser.close();
}
