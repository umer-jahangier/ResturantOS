// Second half of the independent S1-05 audit.
//
// The regression this hunts: before the fix the UI had no Tendered field, so `tenderedPaisa`
// was NEVER sent and change was ALWAYS zero. The fix starts sending it. If anything downstream
// reconciles the drawer against TENDERED rather than APPLIED, every cash sale with change now
// reports a false shortage at close-out — a money bug the fix would have introduced.
//
// Also probes the two personas the fix must not have widened.
import { chromium } from "@playwright/test";
import { API, BASE, CASHIER, login, ensureTillOpen, ringBill, chargeNow, apiToken } from "./s1-05-lib.mjs";

let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; failures.push(name); console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function tokenFor(slug, email, password) {
  const r = await fetch(`${API}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenantSlug: slug, email, password }),
  });
  const b = await r.json().catch(() => null);
  return b?.data?.accessToken ?? null;
}

async function recon(token, tillId) {
  const r = await fetch(`${API}/api/v1/pos/tills/${tillId}/reconciliation`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await r.json())?.data ?? null;
}

async function main() {
  const token = await apiToken();
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  const tills = await fetch(`${API}/api/v1/pos/tills?cashierId=${claims.sub}&status=OPEN`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const tillId = tills?.data?.[0]?.id;
  if (!tillId) throw new Error("no open till for the cashier");

  const before = await recon(token, tillId);
  console.log(`\n=== drawer BEFORE: liveExpectedCash=${before.liveExpectedCashPaisa} ===`);

  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1100 } })).newPage();
  await login(page, CASHIER);
  await ensureTillOpen(page);
  await ringBill(page);
  const orderId = await chargeNow(page);
  console.log(`  order ${orderId} — Rs 3,456.80, paying with a Rs 5,000 note`);

  const amt = page.locator('input[aria-label="Amount (Rs)"]');
  await amt.fill("");
  await amt.pressSequentially("3456.80", { delay: 40 });
  const tnd = page.locator('input[aria-label="Tendered (Rs)"]');
  await tnd.fill("");
  await tnd.pressSequentially("5000", { delay: 40 });
  await page.waitForTimeout(500);
  const changeShown = await page
    .locator('[data-testid="change-due-value"]')
    .getAttribute("data-paisa");
  check("screen offers Rs 1,543.20 change on a Rs 5,000 note", changeShown === "154320", `change=${changeShown}`);
  await page.getByTestId("record-payment-button").click();
  await page.waitForTimeout(5000);

  const after = await recon(token, tillId);
  const delta = after.liveExpectedCashPaisa - before.liveExpectedCashPaisa;
  console.log(`=== drawer AFTER: liveExpectedCash=${after.liveExpectedCashPaisa} (delta ${delta}) ===`);
  check(
    "drawer grew by the BILL (345680), not by the note handed over (500000)",
    delta === 345680,
    `delta=${delta}`,
  );
  check(
    "cashCollected also moved by the applied amount only",
    after.cashCollectedPaisa - before.cashCollectedPaisa === 345680,
    `delta=${after.cashCollectedPaisa - before.cashCollectedPaisa}`,
  );

  // ── persona checks: the fix must not have widened anything ────────────────
  console.log("\n=== wrong persona ===");
  const waiter = await tokenFor("floating-terrace", "waiter@terrace.local", "Terrace#Waiter1");
  const wRes = await fetch(`${API}/api/v1/pos/orders/${orderId}/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${waiter}` },
    body: JSON.stringify({ method: "CASH", amountPaisa: 100, tenderedPaisa: 100000 }),
  });
  check(
    "a waiter still cannot record a cash payment",
    wRes.status === 403 || wRes.status === 409,
    `POST payments -> ${wRes.status}`,
  );

  console.log("\n=== cross-tenant ===");
  const other = await tokenFor("control-bistro-isolation-test-tenant", "waiter@control.local", "Control#Waiter1");
  if (other) {
    const oRes = await fetch(`${API}/api/v1/pos/orders/${orderId}/payments`, {
      headers: { Authorization: `Bearer ${other}` },
    });
    const body = await oRes.text();
    check(
      "the other tenant cannot read this order's tenders",
      oRes.status >= 400 || !body.includes("345680"),
      `GET -> ${oRes.status} ${body.slice(0, 120)}`,
    );
  } else {
    console.log("  (control tenant token unavailable — skipped)");
  }

  await browser.close();
  console.log(`\n================ ${pass} passed, ${fail} failed ================`);
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
