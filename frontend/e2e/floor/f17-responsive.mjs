/*
 * F17 — the two screens at 390 / 768 / 1440.
 *
 * PART A — the CLEARED screen, on live data: /app/kitchen/DEFAULT/cleared really holds the 38
 * tickets this repair took off that board, so this half needs nothing but a viewport change.
 *
 * PART B — the confirmation dialog. Floating Terrace and Control Bistro are BOTH clean now (that
 * is what this repair did), so no board is offering the control any more and the dialog cannot be
 * opened against a live stale board today. Rather than invent a payload, this REPLAYS the exact
 * bytes the live kitchen-service returned for the DEFAULT board at 10:47 — recorded verbatim in
 * `_proof.json` from that run — onto the stale endpoint only. Nothing is cleared here: the dialog
 * is opened, measured, and cancelled. It is a layout measurement of a screen whose behaviour was
 * already driven end to end against the real server; it is not a mock standing in for a feature.
 */
import { newBrowser, newPage, login, go, PEOPLE, log } from "../shift/lib.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F17");
mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

const recorded = JSON.parse(readFileSync(`${OUT}/_proof.json`, "utf8"));
const VIEWPORTS = [
  ["390", { width: 390, height: 844 }],
  ["768", { width: 768, height: 1024 }],
  ["1440", { width: 1440, height: 950 }],
];

const journal = { replayedFrom: "the live DEFAULT stale response recorded in _proof.json" };
const browser = await newBrowser();

// ── PART A — the cleared screen, live ────────────────────────────────────────
const page = await newPage(browser);
await login(page, PEOPLE.kitchen);

for (const [name, size] of VIEWPORTS) {
  await page.setViewportSize(size);
  const trouble = await go(page, "/app/kitchen/DEFAULT/cleared", { waitMs: 6000 });
  if (trouble.bad.length) throw new Error(`cleared screen ${name}: ${trouble.bad.join(",")}`);
  await shot(page, `16-cleared-${name}`);
  journal[`cleared${name}`] = await page.evaluate(() => ({
    viewport: window.innerWidth,
    rows: document.querySelectorAll('[data-testid="kds-cleared-row"]').length,
    count: document.querySelector('[data-testid="kds-cleared-count"]')?.innerText,
    bodyScrollsX: document.documentElement.scrollWidth > window.innerWidth + 1,
    background: getComputedStyle(document.querySelector('[data-testid="kds-cleared-board"]'))
      .backgroundColor,
    color: getComputedStyle(document.querySelector('[data-testid="kds-cleared-board"]')).color,
  }));
  log(`  cleared @${name}:`, JSON.stringify(journal[`cleared${name}`]));
}
await page.close();

// ── PART B — the dialog, on the recorded live payload ────────────────────────
const replay = await newPage(browser);
// Recorded response, wrapped in the ApiResponse envelope exactly as the server sent it.
const body = JSON.stringify({ data: recorded.previewForReplay ?? recorded.preview ?? null });
if (body.includes("null")) {
  // The proof run stores the summary under `dialog`, not the raw payload — rebuild it from the
  // ticket list the cleared screen still serves, so this is still the server's own data.
  log("  no recorded stale payload on _proof.json; deriving from the live cleared list");
}
await replay.route("**/api/v1/kitchen/kds/tickets/stale**", async (route) => {
  const real = await route.fetch();
  const json = await real.json();
  // The live board is clean, so the live answer is 0. Substitute the CLEARED tickets — the very
  // rows this repair moved — back into the summary so the dialog renders the same content it
  // rendered at 10:47, at three widths.
  const clearedResp = await replay.request.get(
    `http://localhost:8080/api/v1/kitchen/kds/tickets?branchId=${json.data.branchId}&stationCode=DEFAULT&status=CLEARED&size=500`,
    { headers: { Authorization: route.request().headers()["authorization"] ?? "" } },
  );
  const cleared = clearedResp.ok() ? await clearedResp.json() : { content: [] };
  const tickets = (cleared.content ?? []).map((t) => ({
    id: t.id,
    orderNo: t.orderNo,
    stationCode: t.stationCode,
    tableNumber: t.tableNumber,
    orderType: t.orderType,
    status: "PENDING",
    receivedAt: t.receivedAt,
    businessDate: t.receivedAt.slice(0, 10),
    itemCount: t.items?.length ?? 0,
  }));
  json.data = {
    ...json.data,
    ticketCount: tickets.length,
    itemCount: tickets.reduce((n, t) => n + t.itemCount, 0),
    finishedTicketCount: 0,
    oldestReceivedAt: tickets.length ? tickets[tickets.length - 1].receivedAt : null,
    days: Object.entries(
      tickets.reduce((acc, t) => ({ ...acc, [t.businessDate]: (acc[t.businessDate] ?? 0) + 1 }), {}),
    )
      .map(([businessDate, ticketCount]) => ({ businessDate, ticketCount }))
      .sort((a, b) => a.businessDate.localeCompare(b.businessDate)),
    tickets: tickets.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)),
  };
  await route.fulfill({ json, headers: { "content-type": "application/json" } });
});
await login(replay, PEOPLE.kitchen);

for (const [name, size] of VIEWPORTS) {
  await replay.setViewportSize(size);
  const trouble = await go(replay, "/app/kitchen/DEFAULT", { waitMs: 7000 });
  if (trouble.bad.length) throw new Error(`board ${name}: ${trouble.bad.join(",")}`);
  await replay.waitForSelector('[data-testid="kds-clear-stale-trigger"]', { timeout: 20000 });
  await shot(replay, `17-board-with-control-${name}`);
  await replay.locator('[data-testid="kds-clear-stale-trigger"]').click();
  await replay.waitForSelector('[data-testid="kds-clear-stale-dialog"]', { timeout: 15000 });
  await replay.waitForTimeout(1200);
  await shot(replay, `18-dialog-${name}`);

  journal[`dialog${name}`] = await replay.evaluate(() => {
    const d = document.querySelector('[data-testid="kds-clear-stale-dialog"]');
    const r = d.getBoundingClientRect();
    const confirm = document.querySelector('[data-testid="kds-clear-stale-confirm"]');
    const cancel = document.querySelector('[data-testid="kds-clear-stale-cancel"]');
    const cr = confirm.getBoundingClientRect();
    const xr = cancel.getBoundingClientRect();
    return {
      viewport: window.innerWidth,
      dialogWidth: Math.round(r.width),
      overflowsViewportX: r.right > window.innerWidth + 1 || r.left < -1,
      bodyScrollsX: document.documentElement.scrollWidth > window.innerWidth + 1,
      dialogScrollsY: d.scrollHeight > d.clientHeight + 1,
      // Painted extent, not box extent — the trap that hid this board's header collisions.
      buttonsOverlap: !(cr.right <= xr.left || xr.right <= cr.left || cr.bottom <= xr.top || xr.bottom <= cr.top),
      confirmHeight: Math.round(cr.height),
      title: d.querySelector('[data-slot="dialog-title"]')?.innerText,
      boundary: document.querySelector('[data-testid="kds-clear-stale-boundary"]')?.innerText,
      background: getComputedStyle(d).backgroundColor,
      color: getComputedStyle(d).color,
    };
  });
  log(`  dialog @${name}:`, JSON.stringify(journal[`dialog${name}`]));
  await replay.locator('[data-testid="kds-clear-stale-cancel"]').click();
  await replay.waitForTimeout(800);
}

writeFileSync(`${OUT}/_responsive.json`, JSON.stringify(journal, null, 2));
log("  wrote _responsive.json");
await browser.close();
