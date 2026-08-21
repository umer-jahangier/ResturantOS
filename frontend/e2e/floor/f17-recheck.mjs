/*
 * F17 RE-VERIFICATION — an independent drive of the clear-stale path.
 *
 * The two seeded demo tenants were both cleared by the original F17 run, so this drives the
 * seeded `test` tenant (scripts/seed_test_env.py), whose HQ board still carries tickets from
 * 2026-06-30 / 2026-07-14 / 2026-07-16 — a genuinely stale board nobody has touched.
 *
 *   node e2e/floor/f17-recheck.mjs [scan|drive] [STATION]
 */
import { newBrowser, newPage, login, go, apiGet, apiSend, PEOPLE, log } from "../shift/lib.mjs";
import { writeFileSync } from "node:fs";

const OUT =
  "/private/tmp/claude-501/-Users-muhammadumer-Documents-Projects-ResturantOS/b8e6f92e-7d80-4d4f-b270-4f05a9458825/scratchpad";
const MODE = process.argv[2] ?? "scan";
const STATION = process.argv[3] ?? null;

const TENANT = process.env.F17_TENANT ?? "zaitoon";
const SLUGS = { zaitoon: "zaitoon-kitchen", marina: "marina-bay-dining", saffron: "saffron-grill" };
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const persona = (local) => ({
  slug: SLUGS[TENANT],
  email: `${local}@${TENANT}.local`,
  password: `${cap(TENANT)}#${cap(local)}1`,
});
const COOK = persona("kitchen");
const CASHIER = persona("cashier");
const WAITER = persona("waiter");

const browser = await newBrowser();
const J = {};
const shot = (page, n) => page.screenshot({ path: `${OUT}/f17r-${n}.png` });

const boardProbe = () =>
  ({
    url: location.href,
    trigger: document.querySelector('[data-testid="kds-clear-stale-trigger"]')?.innerText.trim() ?? null,
    error: document.querySelector('[data-testid="kds-clear-stale-error"]')?.innerText.trim() ?? null,
    loading: !!document.querySelector('[data-testid="kds-clear-stale-loading"]'),
    tickets: document.querySelector('[data-testid="kds-ticket-count"]')?.innerText ?? null,
    items: document.querySelector('[data-testid="kds-item-count"]')?.innerText ?? null,
    pager: document.querySelector('[data-testid="kds-page-indicator"]')?.innerText ?? null,
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
    orderNos: [
      ...new Set(
        (document.body.innerText.match(/ORD-[0-9]{8}-[0-9]{4}|ORD-[A-Z0-9-]{6,}/g) ?? []),
      ),
    ],
  });

// ═══ PHASE 0 — put a ticket from TODAY on the board, through the till ════════
// The whole point of the business-day rule is that today's work survives the clear. A board
// carrying only old tickets cannot prove that, so a real order is fired first.
if (process.env.F17_FIRE === "1") {
  const till = await newPage(browser);
  await login(till, CASHIER);
  await go(till, "/app/pos", { waitMs: 8000 });
  const dine = till.locator("[data-testid=order-type-dine_in]");
  if (await dine.count()) { await dine.click(); await till.waitForTimeout(400); }
  const tt = till.locator("[data-testid=table-select-trigger]");
  if (await tt.count()) {
    await tt.click();
    await till.waitForTimeout(1200);
    const opt = till.locator('[data-testid^="table-option-"]').first();
    if (await opt.count()) { await opt.click(); await till.waitForTimeout(800); }
  }
  const tiles = till.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 25000 });
  const n = Math.min(4, await tiles.count());
  for (let i = 0; i < n; i++) { await tiles.nth(i).click(); await till.waitForTimeout(300); }
  await shot(till, "0a-cart");
  await till.locator("[data-testid=send-to-kitchen-button]").click();
  await till.waitForTimeout(7000);
  await shot(till, "0b-fired");
  const list = await apiGet(till, "/api/v1/pos/orders?size=3");
  J.firedOrder = (list.body?.data ?? [])[0] ?? null;
  log("fired order:", JSON.stringify(J.firedOrder)?.slice(0, 400));
  await till.context().close();
}

// ═══ the cook ════════════════════════════════════════════════════════════════
const page = await newPage(browser);
await login(page, COOK);
await go(page, "/app/kitchen", { waitMs: 5000 });
J.picker = await page.evaluate(() => ({
  url: location.href,
  text: (document.body.innerText || "").slice(0, 800),
  hrefs: [...new Set(Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href")))],
  buttons: Array.from(document.querySelectorAll("button")).map((b) => b.innerText.trim()).filter(Boolean),
}));
log("picker:", JSON.stringify(J.picker).slice(0, 900));
await shot(page, "00-picker");

J.branchId =
  (page.__requests.map((r) => r.u).find((u) => u.includes("branchId=")) ?? "").match(
    /branchId=([0-9a-f-]{36})/,
  )?.[1] ?? null;
log("branchId from page traffic:", J.branchId);

const CODES = STATION ? [STATION] : ["DEFAULT", "GRILL", "DRINKS", "FRYER", "BAR", "PANTRY1"];
J.scan = [];
let target = null;
for (const code of CODES) {
  const trouble = await go(page, `/app/kitchen/${code}`, { waitMs: 5500 });
  const p = await page.evaluate(boardProbe);
  J.scan.push({ code, trouble: trouble.bad, ...p });
  log(`  ${code}:`, JSON.stringify({ t: p.trigger, e: p.error, tk: p.tickets, it: p.items }));
  if (p.error) log(`  !! ${code} stale-check ERROR: ${p.error}`);
  if (p.trigger && !target) target = code;
}

// server's own answer on the cook's bearer, per station and branch-wide
if (J.branchId) {
  J.serverStale = {};
  for (const code of [null, ...CODES]) {
    const q = code ? `&stationCode=${code}` : "";
    const r = await apiGet(page, `/api/v1/kitchen/kds/tickets/stale?branchId=${J.branchId}${q}`);
    J.serverStale[code ?? "ALL"] = {
      status: r.status,
      count: r.body?.data?.ticketCount,
      itemCount: r.body?.data?.itemCount,
      cutoff: r.body?.data?.currentBusinessDayStartedAt ?? r.body?.data?.clearedBefore,
      zone: r.body?.data?.branchTimezone,
      raw: code === null ? r.body?.data : undefined,
    };
  }
  log("server stale:", JSON.stringify(J.serverStale).slice(0, 1200));
}

if (MODE === "scan") {
  writeFileSync(`${OUT}/f17r-scan.json`, JSON.stringify(J, null, 2));
  await browser.close();
  log("scan written");
  process.exit(0);
}

if (!target) throw new Error("no board offers the control — nothing to drive");
J.target = target;
log(`→ driving ${target}`);

await go(page, `/app/kitchen/${target}`, { waitMs: 5500 });
J.before = await page.evaluate(boardProbe);
await shot(page, "01-board-before");
log("before:", JSON.stringify(J.before));

// ── the confirmation ─────────────────────────────────────────────────────────
await page.locator('[data-testid="kds-clear-stale-trigger"]').click();
await page.waitForTimeout(1200);
J.dialog = await page.evaluate(() => {
  const d = document.querySelector('[data-testid="kds-clear-stale-dialog"]');
  if (!d) return null;
  const cs = getComputedStyle(d);
  return {
    role: d.getAttribute("role"),
    ariaModal: d.getAttribute("aria-modal"),
    background: cs.backgroundColor,
    color: cs.color,
    title: d.querySelector("h2,[data-slot='dialog-title']")?.innerText?.trim(),
    text: d.innerText,
    boundary: d.querySelector('[data-testid="kds-clear-stale-boundary"]')?.innerText?.trim(),
    days: d.querySelector('[data-testid="kds-clear-stale-days"]')?.innerText?.trim(),
    listRows: d.querySelectorAll('[data-testid="kds-clear-stale-list"] li').length,
    confirm: d.querySelector('[data-testid="kds-clear-stale-confirm"]')?.innerText?.trim(),
    cancel: d.querySelector('[data-testid="kds-clear-stale-cancel"]')?.innerText?.trim(),
  };
});
await shot(page, "02-dialog");
log("dialog:", JSON.stringify(J.dialog).slice(0, 2000));

// ── cancel must change nothing ───────────────────────────────────────────────
await page.locator('[data-testid="kds-clear-stale-cancel"]').click();
await page.waitForTimeout(1500);
J.afterCancel = await page.evaluate(() => ({
  dialogGone: !document.querySelector('[data-testid="kds-clear-stale-dialog"]'),
  trigger: document.querySelector('[data-testid="kds-clear-stale-trigger"]')?.innerText.trim() ?? null,
}));
log("after cancel:", JSON.stringify(J.afterCancel));

// ── clear ────────────────────────────────────────────────────────────────────
await page.locator('[data-testid="kds-clear-stale-trigger"]').click();
await page.waitForTimeout(1000);
await page.locator('[data-testid="kds-clear-stale-confirm"]').click();
await page.waitForTimeout(3000);
J.success = await page.evaluate(() => {
  const d = document.querySelector('[data-testid="kds-clear-stale-dialog"]');
  return {
    text: d?.innerText ?? null,
    viewCleared: d?.querySelector('[data-testid="kds-clear-stale-view-cleared"]')?.getAttribute("href"),
  };
});
await shot(page, "03-success");
log("success:", JSON.stringify(J.success));

// ── the cleared screen ───────────────────────────────────────────────────────
await page.locator('[data-testid="kds-clear-stale-view-cleared"]').click();
await page.waitForTimeout(4000);
J.cleared = await page.evaluate(() => ({
  url: location.href,
  alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
  count: document.querySelector('[data-testid="kds-cleared-count"]')?.innerText ?? null,
  rows: document.querySelectorAll('[data-testid="kds-cleared-row"]').length,
  firstRow: document.querySelector('[data-testid="kds-cleared-row"]')?.innerText ?? null,
  text: (document.body.innerText || "").slice(0, 1500),
}));
await shot(page, "04-cleared");
log("cleared screen:", JSON.stringify(J.cleared).slice(0, 1200));

// ── back, then a hard reload ─────────────────────────────────────────────────
await go(page, `/app/kitchen/${target}`, { waitMs: 5500 });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);
J.afterReload = await page.evaluate(boardProbe);
await shot(page, "05-after-reload");
log("after reload:", JSON.stringify(J.afterReload));

// ── other boards must be untouched ───────────────────────────────────────────
J.otherBoards = [];
for (const code of CODES.filter((c) => c !== target)) {
  await go(page, `/app/kitchen/${code}`, { waitMs: 5000 });
  const p = await page.evaluate(boardProbe);
  J.otherBoards.push({ code, trigger: p.trigger, tickets: p.tickets, items: p.items });
}
log("other boards:", JSON.stringify(J.otherBoards));

// ── read back on a fresh session, cook's own bearer ──────────────────────────
const page2 = await newPage(browser);
await login(page2, COOK);
await go(page2, `/app/kitchen/${target}`, { waitMs: 4000 });
const rStale = await apiGet(page2, `/api/v1/kitchen/kds/tickets/stale?branchId=${J.branchId}&stationCode=${target}`);
const rCleared = await apiGet(page2, `/api/v1/kitchen/kds/tickets?branchId=${J.branchId}&stationCode=${target}&status=CLEARED`);
const rActive = await apiGet(page2, `/api/v1/kitchen/kds/tickets?branchId=${J.branchId}&stationCode=${target}`);
J.crossRead = {
  staleLeft: rStale.body?.data?.ticketCount,
  clearedStatus: rCleared.status,
  cleared: (rCleared.body?.data ?? []).map((t) => ({
    no: t.orderNo, status: t.status, receivedAt: t.receivedAt, clearedAt: t.clearedAt, items: t.items?.length,
  })),
  activeStatus: rActive.status,
  activeCount: (rActive.body?.data ?? []).length,
};
log("crossRead:", JSON.stringify(J.crossRead).slice(0, 1500));

// ── WRONG PERSONA: the cashier holds no pos.kds.update ───────────────────────
const page3 = await newPage(browser);
await login(page3, CASHIER);
const cashTok = await page3.evaluate(async () => {
  const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  const j = await r.json().catch(() => null);
  return j?.accessToken ?? j?.data?.accessToken ?? null;
});
J.cashier = {
  perms: cashTok ? JSON.parse(Buffer.from(cashTok.split(".")[1], "base64").toString()).permissions?.filter?.((p) => p.startsWith("pos.kds")) : null,
  stale: await apiGet(page3, `/api/v1/kitchen/kds/tickets/stale?branchId=${J.branchId}`, cashTok),
  clear: await apiSend(page3, "POST", `/api/v1/kitchen/kds/tickets/clear-stale?branchId=${J.branchId}`, {}, cashTok),
};
J.cashier.staleStatus = J.cashier.stale.status;
J.cashier.clearStatus = J.cashier.clear.status;
J.cashier.clearBody = JSON.stringify(J.cashier.clear.body).slice(0, 300);
delete J.cashier.stale; delete J.cashier.clear;
log("cashier:", JSON.stringify(J.cashier));

// ── CROSS-TENANT: the test cook aimed at Floating Terrace's branch ───────────
const FT_BRANCH = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
J.crossTenant = {
  stale: await apiGet(page2, `/api/v1/kitchen/kds/tickets/stale?branchId=${FT_BRANCH}`),
  clear: await apiSend(page2, "POST", `/api/v1/kitchen/kds/tickets/clear-stale?branchId=${FT_BRANCH}`, {}),
};
J.crossTenant = {
  staleStatus: J.crossTenant.stale.status,
  staleBody: JSON.stringify(J.crossTenant.stale.body).slice(0, 400),
  clearStatus: J.crossTenant.clear.status,
  clearBody: JSON.stringify(J.crossTenant.clear.body).slice(0, 400),
};
log("crossTenant:", JSON.stringify(J.crossTenant));

writeFileSync(`${OUT}/f17r-drive.json`, JSON.stringify(J, null, 2));
await browser.close();
log("done");
