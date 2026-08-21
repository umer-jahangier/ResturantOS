/*
 * PROBE 1 — the highest-value untested claim.
 *
 * The prior report marked "enable/disable modules per tenant" WORKS on the strength of the toggle
 * PERSISTING. It never checked whether disabling a module ENFORCES anything. The confirmation dialog
 * makes a specific behavioural promise: "Every user of Floating Terrace loses access to this module
 * immediately." That is the claim under test — including the word "immediately", because the gateway
 * caches the flag in Redis with a 5-minute TTL.
 *
 * Sequence: tenant user reaches CRM -> SuperAdmin disables FEATURE_CRM -> re-probe the SAME live
 * session and a FRESH login -> revert. State is restored at the end regardless of outcome.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { BASE, GW, SHOTS, login, open, shot, tokenFrom, jwtClaims } from "./rbacv-lib.mjs";

const out = { probe: "feature-disable-enforcement", steps: [] };
const log = (k, v) => {
  out.steps.push({ k, v });
  console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v).slice(0, 600));
};

async function api(token, path, init = {}) {
  const r = await fetch(`${GW}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await r.text();
  return { status: r.status, body: body.slice(0, 400) };
}

async function main() {
  const browser = await chromium.launch();

  // ---------- tenant side: baseline ----------
  const tctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const tpage = await tctx.newPage();
  await login(tpage, "manager");
  const tok = await tokenFrom(tpage);
  const claims = jwtClaims(tok);
  log("manager-token", { tenant: claims?.tenant_id, roles: claims?.roles, permCount: claims?.permissions?.length });

  const crmBefore = await open(tpage, "/app/crm");
  log("crm-page-BEFORE", {
    url: crmBefore.url,
    denied: crmBefore.denied,
    notFound: crmBefore.notFound,
    failed: crmBefore.failed,
    alerts: crmBefore.alerts,
    head: crmBefore.body.slice(0, 260).replace(/\s+/g, " "),
  });
  await shot(tpage, "01-crm-before-disable");

  const apiBefore = await api(tok, "/api/v1/crm/customers/search?q=&size=5");
  log("crm-API-BEFORE", apiBefore);

  // ---------- platform side: disable ----------
  const pctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ppage = await pctx.newPage();
  await login(ppage, "superadmin");
  await open(ppage, "/platform/tenants");
  await ppage.waitForTimeout(1500);
  // find the Floating Terrace row and open it
  const link = ppage.getByText("Floating Terrace", { exact: false }).first();
  await link.click().catch(() => {});
  await ppage.waitForTimeout(3000);
  log("tenant-detail-url", ppage.url());
  const tenantId = ppage.url().split("/").pop();
  out.tenantId = tenantId;

  const rows = await ppage.locator('[data-testid^="feature-row-"]').count();
  log("feature-rows", rows);
  await shot(ppage, "01-platform-tenant-detail");

  const crmRow = ppage.locator('[data-testid="feature-row-FEATURE_CRM"]');
  log("crm-row-text-BEFORE", (await crmRow.innerText().catch(() => "(row not found)")).replace(/\s+/g, " "));

  const disableBtn = crmRow.getByRole("button", { name: /disable/i }).first();
  await disableBtn.click();
  await ppage.waitForTimeout(1200);
  await shot(ppage, "01-confirm-dialog");
  const dlg = ppage.locator('[role="dialog"]').first();
  const dlgText = (await dlg.innerText().catch(() => "")).replace(/\s+/g, " ");
  const dlgBox = await dlg.boundingBox().catch(() => null);
  log("confirm-dialog", { width: dlgBox?.width, height: dlgBox?.height, text: dlgText.slice(0, 500) });

  // type the tenant name where required
  const confirmInput = dlg.locator("input").first();
  if (await confirmInput.count()) await confirmInput.fill("Floating Terrace");
  await ppage.waitForTimeout(400);
  const t0 = Date.now();
  await dlg.getByRole("button", { name: /disable module/i }).first().click();
  await ppage.waitForTimeout(2500);
  log("crm-row-text-AFTER", (await crmRow.innerText().catch(() => "?")).replace(/\s+/g, " "));
  await shot(ppage, "01-crm-disabled");

  // ---------- the actual test: does anything change for the tenant? ----------
  const elapsedA = Date.now() - t0;
  const apiAfterSameToken = await api(tok, "/api/v1/crm/customers/search?q=&size=5");
  log("crm-API-AFTER-same-token", { elapsedMs: elapsedA, ...apiAfterSameToken });

  const crmAfter = await open(tpage, "/app/crm");
  log("crm-page-AFTER-existing-session", {
    url: crmAfter.url,
    denied: crmAfter.denied,
    notFound: crmAfter.notFound,
    failed: crmAfter.failed,
    alerts: crmAfter.alerts,
    head: crmAfter.body.slice(0, 400).replace(/\s+/g, " "),
  });
  await shot(tpage, "01-crm-after-disable-existing-session");

  // does the nav item disappear?
  const navHasCrm = await tpage.locator("nav").innerText().catch(() => "");
  log("sidebar-contains-CRM-after-disable", /crm|customer/i.test(navHasCrm));

  // fresh login — a brand new token, no client cache at all
  const fctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const fpage = await fctx.newPage();
  await login(fpage, "manager");
  const ftok = await tokenFrom(fpage);
  const apiFresh = await api(ftok, "/api/v1/crm/customers/search?q=&size=5");
  log("crm-API-AFTER-fresh-token", apiFresh);
  const crmFresh = await open(fpage, "/app/crm");
  log("crm-page-AFTER-fresh-login", {
    denied: crmFresh.denied,
    failed: crmFresh.failed,
    alerts: crmFresh.alerts,
    head: crmFresh.body.slice(0, 400).replace(/\s+/g, " "),
  });
  await shot(fpage, "01-crm-after-disable-fresh-login");
  const freshNav = await fpage.locator("nav").innerText().catch(() => "");
  log("fresh-sidebar-contains-CRM", /crm|customer/i.test(freshNav));

  // POS customer picker also uses the same CRM endpoint — collateral check
  const posAfter = await open(fpage, "/app/pos");
  log("pos-page-AFTER-crm-disabled", {
    denied: posAfter.denied,
    failed: posAfter.failed,
    alerts: posAfter.alerts.slice(0, 3),
  });
  await shot(fpage, "01-pos-after-crm-disabled");

  // ---------- REVERT ----------
  const revert = crmRow.getByRole("button", { name: /revert|enable/i }).first();
  await revert.click().catch((e) => log("revert-click-error", String(e).slice(0, 200)));
  await ppage.waitForTimeout(1500);
  const rdlg = ppage.locator('[role="dialog"]').first();
  if (await rdlg.count()) {
    const ri = rdlg.locator("input").first();
    if (await ri.count()) await ri.fill("Floating Terrace");
    await rdlg.getByRole("button", { name: /revert|enable|confirm/i }).last().click().catch(() => {});
  }
  await ppage.waitForTimeout(2500);
  log("crm-row-text-REVERTED", (await crmRow.innerText().catch(() => "?")).replace(/\s+/g, " "));
  await shot(ppage, "01-crm-reverted");

  const apiRevert = await api(ftok, "/api/v1/crm/customers/search?q=&size=5");
  log("crm-API-AFTER-revert", apiRevert);

  writeFileSync(`${SHOTS}/01-feature-enforce.json`, JSON.stringify(out, null, 2));
  await browser.close();
}

main().catch(async (e) => {
  console.error("FATAL", e);
  writeFileSync(`${SHOTS}/01-feature-enforce.json`, JSON.stringify({ ...out, fatal: String(e) }, null, 2));
  process.exit(1);
});
