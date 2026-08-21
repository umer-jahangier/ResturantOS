/*
 * SHIFT STEP 4 — did every ticket reach the right board, and can a discount ever be given?
 *
 *  a. Discount on a check that has NOT been fired (the only state the server allows), then
 *     look for it anywhere on the bill.
 *  b. Every board scanned for every check of the day; the picker's counts compared with each
 *     board's own count; the voided check checked for a cancelled ticket.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, apiGet, apiSend, tokenOf, log, BASE } from "./lib.mjs";

const st = loadState();
const NEW = st.newCashier;
const browser = await newBrowser();

async function signIn(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password ?? who.newPassword);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  log("  ✓", who.email);
}

// ── 4a. discount, on the only order state the server accepts ──────────────────
log("\n=== 4a. discount on an unfired check ===");
const cash = await newPage(browser);
await signIn(cash, NEW);
await go(cash, "/app/pos", { waitMs: 7000 });
const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 20000 });
await tiles.nth(3).click(); // Chicken Karahi Rs 1,450
await cash.waitForTimeout(600);
await cash.locator("[data-testid=save-draft-button]").click();
await cash.waitForTimeout(6500);
const tok = await tokenOf(cash);
const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
const bid = claims.branch_id ?? claims.branchId;
const l = await apiGet(cash, `/api/v1/pos/orders?branchId=${bid}&size=60`, tok);
const mine = (l.body?.data ?? []).filter((o) => o.cashierId === claims.sub);
log("  my orders:", JSON.stringify(mine.map((o) => ({ no: o.orderNo, s: o.settlementStatus, d: o.derivedStatus }))));
const draft = mine.find((o) => o.settlementStatus === "OPEN" && o.derivedStatus === "DRAFT");
saveState({ discountOrderNo: draft?.orderNo, discountOrderId: draft?.orderId });
log("  discount target:", draft?.orderNo);

if (draft) {
  const d = await apiSend(cash, "POST", `/api/v1/pos/orders/${draft.orderId}/discounts`, { scope: "ORDER", type: "PERCENT", value: 10 }, tok);
  log("  cashier ORDER 10% →", d.status);
  const body = JSON.stringify(d.body);
  log("  totals after:", /"subtotalPaisa":\d+|"discountPaisa":-?\d+|"totalPaisa":\d+/g.test(body) ? body.match(/"(subtotalPaisa|discountPaisa|taxPaisa|totalPaisa)":-?\d+/g).join(" ") : body.slice(0, 200));
  saveState({ discountApplied: { status: d.status, totals: body.match(/"(subtotalPaisa|discountPaisa|taxPaisa|totalPaisa)":-?\d+/g) } });

  // Does the bill the guest is shown mention it?
  await go(cash, `/app/pos/orders/${draft.orderId}/charge`, { waitMs: 6000 });
  await shot(cash, "04a-charge-with-discount");
  const bill = await cash.evaluate(() => {
    const t = document.body.innerText.replace(/\s+/g, " ");
    return {
      billBlock: /Bill(.*?)(Payment History|Take Payment)/.exec(t)?.[1]?.trim() ?? null,
      reasonShown: /reason/i.test(t),
      discountRows: Array.from(document.querySelectorAll("*"))
        .filter((n) => n.children.length === 0 && /discount/i.test(n.textContent || ""))
        .map((n) => n.parentElement?.innerText?.replace(/\s+/g, " ").trim())
        .slice(0, 4),
    };
  });
  log("  bill block:", JSON.stringify(bill, null, 1));
  saveState({ discountBill: bill });
}

// ── 4b. every board, every check ──────────────────────────────────────────────
log("\n=== 4b. every ticket of the day, on every board ===");
const kds = await newPage(browser);
await login(kds, PEOPLE.kitchen);
await go(kds, "/app/kitchen", { waitMs: 6000 });
await shot(kds, "04b-station-picker");
const picker = await kds.evaluate(() =>
  Array.from(document.querySelectorAll('[data-testid^="station-tile-"]')).map((n) => {
    const code = n.getAttribute("data-testid").replace("station-tile-", "");
    const q = document.querySelector(`[data-testid="station-queue-${code}"]`);
    return { code, queue: q?.textContent?.trim() ?? null, text: n.innerText.replace(/\s+/g, " ").trim() };
  }),
);
log("  picker:", JSON.stringify(picker, null, 1));

const wanted = [st.order1No, st.order2No, st.order3No, st.discountOrderNo].filter(Boolean);
const scan = {};
for (const s of picker) {
  await go(kds, `/app/kitchen/${s.code}`, { waitMs: 5500 });
  scan[s.code] = await kds.evaluate((list) => {
    const t = document.body.innerText;
    const out = {};
    for (const n of list) {
      const i = t.indexOf(n);
      out[n] = i >= 0 ? t.slice(i, i + 200).replace(/\s+/g, " ") : null;
    }
    return {
      boardCount: document.querySelector("[data-testid=kds-ticket-count]")?.textContent?.trim() ?? null,
      pages: document.querySelector("[data-testid=kds-page-indicator]")?.textContent?.trim() ?? null,
      hits: out,
    };
  }, wanted);
  log(`  ${s.code}: count=${scan[s.code].boardCount} pages=${scan[s.code].pages}`);
  for (const [n, v] of Object.entries(scan[s.code].hits)) if (v) log(`      ${n}: ${v.slice(0, 150)}`);
}
saveState({ boardScan: scan, pickerCounts: picker });

// picker count vs board count, per station
const mismatch = picker.map((p) => {
  const pc = /(\d+)\s+tickets/.exec(p.text)?.[1];
  const bc = /(\d+)\s+tickets/.exec(scan[p.code].boardCount ?? "")?.[1];
  return { code: p.code, picker: pc, board: bc, agree: pc === bc };
});
log("\n  picker vs board ticket counts:", JSON.stringify(mismatch, null, 1));
saveState({ countMismatch: mismatch });

await browser.close();
log("\nstep 4 done");
