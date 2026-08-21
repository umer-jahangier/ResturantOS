/*
 * PROBE 2 — re-run the feature-gate test with a REAL token, and time the word "immediately".
 *
 * Probe 1 proved the UI blocks. This proves (or disproves) the API half, which is the half that
 * matters for a tenant who bookmarks a URL or drives the API directly. The gateway caches the flag
 * in Redis with a 5-minute TTL, so "immediately" is a falsifiable claim: poll the API every 3s from
 * the instant the toggle flips and record when the first 403 lands.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { SHOTS, login, open, shot, sniffToken, api } from "./rbacv-lib.mjs";

const out = { probe: "feature-gate-api-and-latency", steps: [] };
const log = (k, v) => {
  out.steps.push({ k, v });
  console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v).slice(0, 500));
};

const CRM_PATH = "/api/v1/crm/customers/search?q=&size=5";

async function main() {
  const browser = await chromium.launch();

  const tctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const tpage = await tctx.newPage();
  const tokBox = sniffToken(tpage);
  await login(tpage, "manager");
  await open(tpage, "/app/crm");
  await tpage.waitForTimeout(1500);
  log("sniffed-manager-token", tokBox.value ? `${tokBox.value.slice(0, 24)}… (len ${tokBox.value.length})` : "NONE");
  if (!tokBox.value) throw new Error("could not sniff a token — probe invalid");

  const before = await api(tokBox.value, CRM_PATH);
  log("crm-API-BEFORE", before);

  // platform side
  const pctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ppage = await pctx.newPage();
  await login(ppage, "superadmin");
  await open(ppage, "/platform/tenants/d108c2e6-a70d-49c8-acdc-37531fd752d8");
  await ppage.waitForTimeout(2000);
  const crmRow = ppage.locator('[data-testid="feature-row-FEATURE_CRM"]');
  log("row-before", (await crmRow.innerText().catch(() => "?")).replace(/\s+/g, " "));

  await crmRow.getByRole("button", { name: /^disable$/i }).first().click();
  await ppage.waitForTimeout(1000);
  const dlg = ppage.locator('[role="dialog"]').first();
  const ci = dlg.locator("input").first();
  if (await ci.count()) await ci.fill("Floating Terrace");
  await ppage.waitForTimeout(300);
  const t0 = Date.now();
  await dlg.getByRole("button", { name: /disable module/i }).first().click();
  log("clicked-disable-at", new Date(t0).toISOString());

  // poll the API until it flips, up to 6.5 minutes (TTL is 5 min)
  const poll = [];
  let flippedAt = null;
  for (let i = 0; i < 130; i += 1) {
    const r = await api(tokBox.value, CRM_PATH);
    const el = Date.now() - t0;
    poll.push({ ms: el, status: r.status, code: (r.body.match(/"code":"([A-Z_]+)"/) ?? [])[1] ?? null });
    if (r.status !== 200) {
      flippedAt = el;
      log("API-FLIPPED", { afterMs: el, status: r.status, body: r.body.slice(0, 220) });
      break;
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  out.poll = poll.filter((_, i) => i % 5 === 0 || i === poll.length - 1);
  if (flippedAt === null) log("API-NEVER-FLIPPED", { polledForMs: Date.now() - t0, lastStatus: poll.at(-1) });

  // ---------- REVERT and confirm restoration ----------
  await crmRow.getByRole("button", { name: /revert/i }).first().click().catch(() => {});
  await ppage.waitForTimeout(1200);
  const rdlg = ppage.locator('[role="dialog"]').first();
  if (await rdlg.count()) {
    const ri = rdlg.locator("input").first();
    if (await ri.count()) await ri.fill("Floating Terrace");
    const btn = rdlg.getByRole("button", { name: /revert|enable|confirm/i }).last();
    await btn.click().catch(() => {});
  }
  await ppage.waitForTimeout(2500);
  log("row-after-revert", (await crmRow.innerText().catch(() => "?")).replace(/\s+/g, " "));
  await shot(ppage, "02-reverted");

  // poll back to 200 so the tenant is left healthy
  let restored = null;
  for (let i = 0; i < 120; i += 1) {
    const r = await api(tokBox.value, CRM_PATH);
    if (r.status === 200) {
      restored = i * 3;
      break;
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  log("crm-API-restored-after-s", restored);

  writeFileSync(`${SHOTS}/02-feature-api.json`, JSON.stringify(out, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  writeFileSync(`${SHOTS}/02-feature-api.json`, JSON.stringify({ ...out, fatal: String(e) }, null, 2));
  process.exit(1);
});
