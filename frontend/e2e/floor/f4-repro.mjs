/*
 * F4 — REPRODUCTION. Is there any way for a signed-in OWNER to read the audit log?
 *
 * Drives real Chromium as owner@terrace.local (TOTP), enumerates every sidebar entry,
 * visits the four routes the walkthrough tried, and reads /api/v1/audit/events on the
 * owner's OWN bearer (minted from the same HttpOnly refresh cookie the tab holds).
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, tokenOf, log } from "../shift/lib.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F4");
mkdirSync(OUT, { recursive: true });

const browser = await newBrowser();
const page = await newPage(browser);
await login(page, PEOPLE.owner);
await go(page, "/app/dashboard", { waitMs: 5000 });

// 1. every nav entry the OWNER is offered
const nav = await page.evaluate(() =>
  Array.from(document.querySelectorAll("nav a, aside a")).map((a) => ({
    t: (a.textContent || "").replace(/\s+/g, " ").trim(),
    h: a.getAttribute("href"),
  })),
);
log("\n  nav entries:", nav.length);
const matches = nav.filter((n) => /audit|log|activity|history|security/i.test(`${n.t} ${n.h}`));
log("  entries matching audit/log/activity/history/security:", JSON.stringify(matches));
await page.screenshot({ path: `${OUT}/repro-01-sidebar.png` });

// 2. the four routes
for (const [i, route] of [
  "/app/audit",
  "/app/settings/audit",
  "/app/admin/audit",
  "/app/settings/security",
].entries()) {
  const t = await go(page, route, { waitMs: 4000, allowTrouble: true });
  const body = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 200));
  log(`  ${route} → ${JSON.stringify(t.bad)} :: ${body}`);
  await page.screenshot({ path: `${OUT}/repro-02-route-${i}.png` });
}

// 3. the API on the owner's own bearer
const tok = await tokenOf(page);
for (const q of [
  "/api/v1/audit/events?size=200",
  "/api/v1/audit/events?action=ORDER_VOIDED&size=20",
  "/api/v1/audit/events?resourceType=ORDER&size=40",
]) {
  const r = await apiGet(page, q, tok);
  const rows = r.body?.data ?? [];
  const kinds = {};
  for (const e of rows) kinds[e.action] = (kinds[e.action] ?? 0) + 1;
  log(`\n  ${q} → ${r.status}, ${rows.length} rows, meta=${JSON.stringify(r.body?.meta)}`);
  log("   actions:", JSON.stringify(kinds));
  if (rows[0]) log("   first row:", JSON.stringify(rows[0]).slice(0, 400));
}

await browser.close();
log("\nrepro done");
