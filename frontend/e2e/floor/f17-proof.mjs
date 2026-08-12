/*
 * F17 — DRIVE THE PATH IN "DONE MEANS", AS THE COOK.
 *
 *   kitchen@terrace.local → a board carrying tickets older than one business day →
 *   "Clear N old" → read the confirmation → Clear → read the result →
 *   View cleared tickets → back → RELOAD → the board is still clean.
 *
 * PHASE ORDER IS DELIBERATE. Phase 1 is browser-only and never mints a token out of band: the
 * refresh cookie ROTATES on every /auth/refresh, so a probe that spends it mid-run logs the tab
 * out, and the reload — the whole point of the last step — lands on /login?reason=session_expired
 * and proves nothing. Cross-reads happen in phase 2, on their own session, after the reload has
 * already been measured.
 */
import { newBrowser, newPage, login, go, apiGet, PEOPLE, log } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F17");
mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

const journal = {};
const browser = await newBrowser();

// ══ PHASE 1 — the cook, in the browser, with no token games ══════════════════
const page = await newPage(browser);
await login(page, PEOPLE.kitchen);

// Find a board that is actually carrying tickets from a closed business day, the way a cook
// would: by looking at the boards.
const CANDIDATES = process.env.F17_STATIONS
  ? process.env.F17_STATIONS.split(",")
  : ["DEFAULT", "PANTRY1", "GRILL", "BAR", "DGB28334", "DGS43431", "DGS20334"];
let station = null;
let triggerText = null;
for (const code of CANDIDATES) {
  const trouble = await go(page, `/app/kitchen/${code}`, { waitMs: 6000 });
  if (trouble.bad.length) {
    log(`  ${code}: ${trouble.bad.join(",")} — skipped`);
    continue;
  }
  const probe = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="kds-clear-stale-trigger"]');
    const err = document.querySelector('[data-testid="kds-clear-stale-error"]');
    return { trigger: el ? el.innerText.trim() : null, error: err ? err.innerText.trim() : null };
  });
  log(`  ${code}: trigger=${JSON.stringify(probe.trigger)} error=${JSON.stringify(probe.error)}`);
  if (probe.error) throw new Error(`${code}: stale check failed — ${probe.error}`);
  if (probe.trigger) {
    station = code;
    triggerText = probe.trigger;
    break;
  }
}
if (!station) throw new Error("no board is carrying stale tickets — nothing to prove against");
journal.station = station;
journal.triggerText = triggerText;
log(`  → proving on ${station}; the control reads ${JSON.stringify(triggerText)}`);

// The branch id, taken off a request the PAGE made — never minted here.
journal.branchId = (page.__requests.map((r) => r.u).find((u) => u.includes("branchId=")) ?? "").match(
  /branchId=([0-9a-f-]{36})/,
)?.[1];
log("  branchId (from the page's own traffic):", journal.branchId);

journal.boardBefore = await page.evaluate(() => ({
  ticketCount: document.querySelector('[data-testid="kds-ticket-count"]')?.innerText,
  itemCount: document.querySelector('[data-testid="kds-item-count"]')?.innerText,
  pager: document.querySelector('[data-testid="kds-page-indicator"]')?.innerText ?? null,
  orderNumbersOnPage: Array.from(document.querySelectorAll('[data-testid="kds-board-scroll"] *'))
    .map((n) => n.textContent ?? "")
    .join(" ")
    .match(/ORD-\d{8}-\d{4}/g)
    ?.filter((v, i, a) => a.indexOf(v) === i) ?? [],
}));
log("  board BEFORE:", JSON.stringify(journal.boardBefore));
await shot(page, "10-board-before");

// ── the confirmation ─────────────────────────────────────────────────────────
await page.locator('[data-testid="kds-clear-stale-trigger"]').click();
await page.waitForSelector('[data-testid="kds-clear-stale-dialog"]', { timeout: 15000 });
await page.waitForTimeout(1200);
await shot(page, "11-confirmation");

journal.dialog = await page.evaluate(() => {
  const d = document.querySelector('[data-testid="kds-clear-stale-dialog"]');
  const list = document.querySelector('[data-testid="kds-clear-stale-list"]');
  const cs = getComputedStyle(d);
  return {
    title: d.querySelector('[data-slot="dialog-title"]')?.innerText,
    description: d.querySelector('[data-slot="dialog-description"]')?.innerText,
    boundary: document.querySelector('[data-testid="kds-clear-stale-boundary"]')?.innerText,
    days: document.querySelector('[data-testid="kds-clear-stale-days"]')?.innerText,
    finished: document.querySelector('[data-testid="kds-clear-stale-finished"]')?.innerText ?? null,
    listRows: list ? list.querySelectorAll("li").length : 0,
    firstRow: list?.querySelector("li")?.innerText,
    confirm: document.querySelector('[data-testid="kds-clear-stale-confirm"]')?.innerText,
    cancel: document.querySelector('[data-testid="kds-clear-stale-cancel"]')?.innerText,
    // computed style, never the class list — cn()/tailwind-merge has silently dropped utilities
    background: cs.backgroundColor,
    color: cs.color,
    ariaModal: d.getAttribute("aria-modal"),
    role: d.getAttribute("role"),
  };
});
log("  dialog:", JSON.stringify(journal.dialog, null, 1));

// Cancel first: a confirmation that cannot be declined is not a confirmation.
await page.locator('[data-testid="kds-clear-stale-cancel"]').click();
await page.waitForTimeout(1500);
journal.cancelLeavesBoardAlone = await page.evaluate(() => ({
  dialogGone: !document.querySelector('[data-testid="kds-clear-stale-dialog"]'),
  triggerStillThere: !!document.querySelector('[data-testid="kds-clear-stale-trigger"]'),
  triggerText: document.querySelector('[data-testid="kds-clear-stale-trigger"]')?.innerText.trim(),
}));
log("  after Cancel:", JSON.stringify(journal.cancelLeavesBoardAlone));

// ── clear ────────────────────────────────────────────────────────────────────
await page.locator('[data-testid="kds-clear-stale-trigger"]').click();
await page.waitForSelector('[data-testid="kds-clear-stale-confirm"]', { timeout: 15000 });
await page.locator('[data-testid="kds-clear-stale-confirm"]').click();
await page.waitForSelector('[data-testid="kds-clear-stale-done"]', { timeout: 25000 });
await page.waitForTimeout(800);
await shot(page, "12-cleared");
journal.success = await page.evaluate(() => {
  const d = document.querySelector('[data-testid="kds-clear-stale-dialog"]');
  return {
    body: d.innerText,
    viewClearedHref: document
      .querySelector('[data-testid="kds-clear-stale-view-cleared"]')
      ?.getAttribute("href"),
  };
});
log("  after clearing:", JSON.stringify(journal.success, null, 1));

// ── the cleared tickets are still findable ───────────────────────────────────
await page.locator('[data-testid="kds-clear-stale-view-cleared"]').click();
await page.waitForTimeout(6000);
journal.clearedScreen = await page.evaluate(() => {
  const t = document.body.innerText;
  return {
    url: location.href,
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
    rows: document.querySelectorAll('[data-testid="kds-cleared-row"]').length,
    count: document.querySelector('[data-testid="kds-cleared-count"]')?.innerText,
    firstRow: document.querySelector('[data-testid="kds-cleared-row"]')?.innerText,
    orderNumbers: (t.match(/ORD-\d{8}-\d{4}/g) ?? []).filter((v, i, a) => a.indexOf(v) === i),
  };
});
log("  cleared screen:", JSON.stringify({ ...journal.clearedScreen, orderNumbers: journal.clearedScreen.orderNumbers.slice(0, 5) }, null, 1));
await shot(page, "13-cleared-list");

// ── back to the board, and RELOAD ────────────────────────────────────────────
await page.locator('[data-testid="kds-cleared-back"]').click();
await page.waitForTimeout(4000);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
await shot(page, "14-board-after-reload");
journal.boardAfterReload = await page.evaluate(() => {
  const scroll = document.querySelector('[data-testid="kds-board-scroll"]');
  return {
    url: location.href,
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
    ticketCount: document.querySelector('[data-testid="kds-ticket-count"]')?.innerText,
    itemCount: document.querySelector('[data-testid="kds-item-count"]')?.innerText,
    pager: document.querySelector('[data-testid="kds-page-indicator"]')?.innerText ?? null,
    stillOffersClear: !!document.querySelector('[data-testid="kds-clear-stale-trigger"]'),
    orderNumbersOnPage: ((scroll?.textContent ?? "").match(/ORD-\d{8}-\d{4}/g) ?? []).filter(
      (v, i, a) => a.indexOf(v) === i,
    ),
  };
});
log("  board AFTER RELOAD:", JSON.stringify(journal.boardAfterReload, null, 1));

// ── the three viewports, on the surface that never follows a theme ───────────
for (const [name, size] of [
  ["390", { width: 390, height: 844 }],
  ["768", { width: 768, height: 1024 }],
  ["1440", { width: 1440, height: 950 }],
]) {
  await page.setViewportSize(size);
  await page.waitForTimeout(1200);
  await shot(page, `15-board-${name}`);
}
await page.close();

// ══ PHASE 2 — cross-read on the cook's OWN bearer, on a fresh session ════════
const probe = await newPage(browser);
await login(probe, PEOPLE.kitchen);
const token = await probe.evaluate(async () => {
  const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const j = await r.json().catch(() => null);
  return j?.accessToken ?? j?.data?.accessToken ?? null;
});
const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
const branchId = claims.branch_id ?? claims.branchId;
journal.cook = { sub: claims.sub, branchId, permissions: claims.permissions };

const stale = await apiGet(
  probe,
  `/api/v1/kitchen/kds/tickets/stale?branchId=${branchId}&stationCode=${station}`,
  token,
);
const active = await apiGet(
  probe,
  `/api/v1/kitchen/kds/tickets?branchId=${branchId}&stationCode=${station}&size=500`,
  token,
);
const cleared = await apiGet(
  probe,
  `/api/v1/kitchen/kds/tickets?branchId=${branchId}&stationCode=${station}&status=CLEARED&size=500`,
  token,
);
const cutoff = Date.parse(stale.body?.data?.currentBusinessDayStartedAt);
const activeTickets = (active.body?.content ?? []).map((t) => ({
  no: t.orderNo,
  recv: t.receivedAt,
}));
journal.crossRead = {
  branchTimezone: stale.body?.data?.branchTimezone,
  currentBusinessDayStartedAt: stale.body?.data?.currentBusinessDayStartedAt,
  staleLeft: stale.body?.data?.ticketCount,
  activeTotal: active.body?.totalElements,
  clearedTotal: cleared.body?.totalElements,
  activeOlderThanCutoff: activeTickets.filter((t) => Date.parse(t.recv) < cutoff).length,
  activeFromToday: activeTickets.filter((t) => Date.parse(t.recv) >= cutoff).length,
  clearedSample: (cleared.body?.content ?? []).slice(0, 3).map((t) => ({
    no: t.orderNo,
    receivedAt: t.receivedAt,
    clearedAt: t.clearedAt,
    status: t.status,
    items: t.items?.length,
  })),
  everyClearedIsBeforeCutoff: (cleared.body?.content ?? []).every(
    (t) => Date.parse(t.receivedAt) < cutoff,
  ),
};
log("  cross-read:", JSON.stringify(journal.crossRead, null, 1));
await probe.close();

// ══ PHASE 3 — the audit event, as the OWNER (a cook holds no audit.read) ═════
const ownerPage = await newPage(browser);
await login(ownerPage, PEOPLE.owner);
const ownerToken = await ownerPage.evaluate(async () => {
  const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const j = await r.json().catch(() => null);
  return j?.accessToken ?? j?.data?.accessToken ?? null;
});
const audit = await apiGet(
  ownerPage,
  "/api/v1/audit/events?action=KDS_STALE_TICKETS_CLEARED&size=10",
  ownerToken,
);
const rows = audit.body?.data?.content ?? audit.body?.content ?? audit.body?.data ?? [];
journal.audit = {
  status: audit.status,
  count: Array.isArray(rows) ? rows.length : null,
  rows: (Array.isArray(rows) ? rows : []).slice(0, 3),
};
log("  audit:", JSON.stringify(journal.audit, null, 1));

await browser.close();
writeFileSync(`${OUT}/_proof.json`, JSON.stringify(journal, null, 2));
log("  wrote _proof.json");
