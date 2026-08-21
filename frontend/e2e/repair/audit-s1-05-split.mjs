// Third leg of the independent S1-05 audit: the split CASH+CARD tender named in DONE MEANS,
// plus the thing a card must never do — offer change from a drawer it has no access to.
import { chromium } from "@playwright/test";
import { API, CASHIER, login, ensureTillOpen, ringBill, chargeNow, apiToken } from "./s1-05-lib.mjs";

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  const token = await apiToken();
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1200 } })).newPage();
  await login(page, CASHIER);
  await ensureTillOpen(page);
  await ringBill(page);
  const orderId = await chargeNow(page);
  console.log(`\n  order ${orderId} — Rs 3,456.80 split CASH 2000 + CARD 1456.80`);

  // Row 1 — CASH 2000.00, guest hands a 2500
  const rows = () => page.locator('[data-testid="tender-row"]');
  const amt1 = rows().nth(0).locator('input[aria-label="Amount (Rs)"]');
  await amt1.fill("");
  await amt1.pressSequentially("2000.00", { delay: 40 });
  const tnd1 = rows().nth(0).locator('input[aria-label="Tendered (Rs)"]');
  await tnd1.fill("");
  await tnd1.pressSequentially("2500", { delay: 40 });
  await page.waitForTimeout(400);
  check(
    "cash row shows Rs 500.00 change",
    (await rows().nth(0).locator('[data-testid="change-due-value"]').getAttribute("data-paisa")) === "50000",
  );

  // Row 2 — CARD for the rest
  await page.getByTestId("add-tender-button").click();
  await page.waitForTimeout(500);
  await rows().nth(1).locator('select[aria-label="Payment method"]').selectOption("CARD");
  await page.waitForTimeout(400);
  check(
    "a CARD row offers NO tendered field (no drawer to give change from)",
    (await rows().nth(1).locator('input[aria-label="Tendered (Rs)"]').count()) === 0,
  );
  const amt2 = rows().nth(1).locator('input[aria-label="Amount (Rs)"]');
  await amt2.fill("");
  await amt2.pressSequentially("1456.80", { delay: 40 });
  await page.waitForTimeout(500);

  const total = await page.locator('[data-testid="tender-total-value"]').getAttribute("data-paisa");
  const balAfter = await page.locator('[data-testid="balance-after-tender-value"]').getAttribute("data-paisa");
  check("tender total is the bill exactly", total === "345680", `total=${total}`);
  check("balance after this tender is Rs 0.00", balAfter === "0", `balAfter=${balAfter}`);

  // Capture what actually goes on the wire.
  const posted = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/payments$/.test(r.url())) {
      try { posted.push(JSON.parse(r.postData() || "{}")); } catch { /* ignore */ }
    }
  });

  await page.getByTestId("record-payment-button").click();
  await page.waitForTimeout(6000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const remaining = await page
    .locator('[data-testid="remaining-balance-value"]')
    .getAttribute("data-paisa");
  check("after reload the remaining balance is Rs 0.00", remaining === "0", `remaining=${remaining}`);

  console.log("  wire: " + JSON.stringify(posted));
  const cardReq = posted.find((r) => r.method === "CARD");
  check(
    "the CARD request carries NO tenderedPaisa",
    !!cardReq && cardReq.tenderedPaisa === undefined,
    JSON.stringify(cardReq),
  );

  const persisted = await fetch(`${API}/api/v1/pos/orders/${orderId}/payments`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const p = (persisted?.data ?? []).map((x) => ({ m: x.method, a: x.amountPaisa, t: x.tenderedPaisa, c: x.changePaisa }));
  console.log("  persisted: " + JSON.stringify(p));
  const cash = p.find((x) => x.m === "CASH");
  const card = p.find((x) => x.m === "CARD");
  check("CASH persisted 200000/250000/50000", cash && cash.a === 200000 && cash.t === 250000 && cash.c === 50000, JSON.stringify(cash));
  check("CARD persisted 145680 with zero change", card && card.a === 145680 && card.c === 0, JSON.stringify(card));
  check("applied sums to the bill", p.reduce((a, x) => a + x.a, 0) === 345680);

  await browser.close();
  console.log(`\n================ ${pass} passed, ${fail} failed ================`);
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
