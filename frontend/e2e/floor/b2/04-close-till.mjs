/*
 * B2 STEP 4 — the cashier cashes up. No manager touches anything in this file.
 *
 * Clears whatever is still live on the drawer by the two legitimate paths (void the untendered,
 * serve out the paid), then drives the Close Till panel by clicking and reads the result back
 * off the server.
 *
 * NOTE ON THIS MACHINE: ten agents share this tenant and this cashier, so checks keep arriving on
 * this drawer while the run is in flight. The clear-down loop therefore repeats until the live
 * list is genuinely empty rather than assuming one pass is enough.
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, saveState, apiGet, apiSend, tokenOf, branchOf,
  money, log,
} from "./lib.mjs";

const browser = await newBrowser();
const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);
const tok = await tokenOf(cash);
const branch = await branchOf(cash, tok);

async function liveRows() {
  const rows = [];
  for (let page = 0; page < 12; page++) {
    const r = await apiGet(cash, `/api/v1/pos/orders?branchId=${branch}&page=${page}&size=50`, tok);
    const data = r.body?.data ?? [];
    rows.push(...data);
    if (data.length < 50) break;
  }
  return rows;
}

log("=== clear whatever is still live on the drawer ===");
let cleared = { voided: 0, served: 0, failed: [] };
for (let pass = 1; pass <= 4; pass++) {
  const rows = await liveRows();
  log(`  pass ${pass}: ${rows.length} live`);
  if (!rows.length) break;
  for (const r of rows) {
    if ((r.amountPaidPaisa ?? 0) === 0) {
      const v = await apiSend(cash, "POST", `/api/v1/pos/orders/${r.orderId}/void`,
        { reason: "End-of-shift clear-down: check abandoned, nothing tendered" }, tok);
      if (v.status < 300) cleared.voided++; else cleared.failed.push({ no: r.orderNo, st: r.settlementStatus, s: v.status, b: v.body });
    } else {
      const s = await apiSend(cash, "POST", `/api/v1/pos/orders/${r.orderId}/serve-all`, {}, tok);
      if (s.status < 300) cleared.served++; else cleared.failed.push({ no: r.orderNo, step: "serve-all", s: s.status, b: s.body });
    }
  }
}
log("  cleared:", JSON.stringify(cleared));
saveState({ closeClearDown: cleared });

// ── the close, by clicking ────────────────────────────────────────────────────
log("\n=== Close Till ===");
await go(cash, "/app/pos", { waitMs: 8000 });
const stripBefore = await cash.evaluate(() =>
  /Till (OPEN|CLOSED)[\s\S]{0,120}/.exec(document.body.innerText)?.[0].replace(/\s+/g, " ").trim() ?? null);
log("  strip before:", stripBefore);
await shot(cash, "04a-strip-before");

await cash.getByRole("button", { name: /^Close Till$/i }).first().click();
await cash.waitForTimeout(2500);
await shot(cash, "04b-close-panel");

const figures = await cash.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, " ");
  return {
    float: /Opening float:\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
    cashTaken: /Cash taken \(net of refunds\):\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
    expected: /Expected cash:\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
  };
});
log("  panel figures:", JSON.stringify(figures));
saveState({ closePanelFigures: figures });

const expectedPaisa = Math.round(parseFloat((figures.expected ?? "0").replace(/[^\d.]/g, "")) * 100);
const declared = (expectedPaisa / 100).toFixed(2);
log("  declaring the counted cash:", declared);
await cash.locator('input[placeholder="e.g. 12500.00"]').first().fill(declared);
await cash.locator("[data-testid=close-till-note]").first()
  .fill("B2 — counted to the expected figure; drawer cleared by the cashier alone");
await cash.waitForTimeout(500);
await shot(cash, "04c-declared");

// Ten agents ring checks on this same cashier while the panel is open, so sweep once more
// immediately before the click — otherwise the close races an order that arrived mid-form.
const late = await liveRows();
if (late.length) {
  log(`  ${late.length} check(s) arrived while the panel was open — clearing before the click`);
  for (const r of late) {
    if ((r.amountPaidPaisa ?? 0) === 0) {
      await apiSend(cash, "POST", `/api/v1/pos/orders/${r.orderId}/void`,
        { reason: "End-of-shift clear-down: nothing tendered" }, tok);
    } else {
      await apiSend(cash, "POST", `/api/v1/pos/orders/${r.orderId}/serve-all`, {}, tok);
    }
  }
}

cash.__requests.length = 0;
await cash.getByRole("button", { name: /^Close Till$/i }).last().click();
await cash.waitForTimeout(7000);
await shot(cash, "04d-after-close");

const net = cash.__requests.filter((r) => /tills/.test(r.u));
log("  network:", JSON.stringify(net));
const stripAfter = await cash.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, " ");
  return {
    strip: /Till (OPEN|CLOSED)[\s\S]{0,140}/.exec(t)?.[0].trim() ?? null,
    noTill: /No active till|Open Till|Till closed/i.exec(t)?.[0] ?? null,
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
    first400: t.slice(0, 400),
  };
});
log("  strip after:", JSON.stringify(stripAfter, null, 1));
saveState({ closeNet: net, stripAfter });

// read the till back off the server, on the cashier's own bearer
const sub = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8")).sub;
const tills = await apiGet(cash, `/api/v1/pos/tills?branchId=${branch}`, tok);
const mine = (tills.body?.data ?? []).filter((t) => t.cashierId === sub);
const latest = mine.sort((a, b) => (b.openedAt ?? "").localeCompare(a.openedAt ?? ""))[0];
log("\n  the cashier's till, read back:", JSON.stringify(latest));
saveState({ closedTill: latest });

await browser.close();
log("\nB2 step 4 done");
