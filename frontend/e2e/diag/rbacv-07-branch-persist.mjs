/*
 * PROBE 7 — does the branch a user switched to survive?
 *
 * Probe 6 showed the switch reissuing a correct CASHIER token for Rooftop, and then showed the app
 * back at HQ with 7 permissions two navigations later. That could be either of two very different
 * things, and the difference decides the verdict:
 *
 *   (i)  my probe used page.goto() — a HARD navigation — and the app simply cannot carry the
 *        selected branch across a full page load, or
 *   (ii) the switch never really took and probe 6 caught a transient.
 *
 * So: switch, then SOFT-navigate by clicking sidebar links (what a real user does), then RELOAD,
 * then hard-navigate. Each step reads the live token. The access token is memory-only and a full
 * load re-bootstraps from the HttpOnly refresh cookie (lib/auth/session.ts), so this is precisely
 * where a selected branch would be dropped.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { SHOTS, BASE, login, shot, sniffToken, api, apiLogin, jwtClaims } from "./rbacv-lib.mjs";

const out = { probe: "does-the-selected-branch-survive", steps: [] };
const log = (k, v) => {
  out.steps.push({ k, v });
  console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v).slice(0, 500));
};

const HQ = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
const ROOF = "c2d74ade-7ff8-4167-8cd0-131bfbdf4fba";
const nameOf = (id) => (id === ROOF ? "ROOFTOP" : id === HQ ? "HQ" : id);

async function state(page, tok, label) {
  const c = jwtClaims(tok.value ?? "");
  const chrome = await page.locator('[data-slot="sidebar"], header').first().innerText().catch(() => "");
  const s = {
    url: page.url().replace(BASE, ""),
    jwtBranch: nameOf(c?.branch_id),
    jwtRoles: c?.roles,
    jwtPerms: c?.permissions?.length,
    chromeSaysBranch: /Rooftop/i.test(chrome) ? "ROOFTOP" : /HQ/i.test(chrome) ? "HQ" : "?",
    navHasCustomers: /customers/i.test(chrome),
  };
  log(label, s);
  return s;
}

async function main() {
  const owner = await apiLogin({
    email: "owner@terrace.local",
    password: "Terrace#Owner1",
    tenantSlug: "floating-terrace",
    totpEmail: "owner@terrace.local",
  });
  const H = { Authorization: `Bearer ${owner.token}` };
  const users = await fetch("http://localhost:8080/api/v1/users?size=200", { headers: H }).then((r) => r.json());
  const waiter = (users.data ?? []).find((u) => u.email === "waiter@terrace.local");
  log("grant", await api(owner.token, `/api/v1/users/${waiter.id}/branch-roles`, {
    method: "POST",
    body: JSON.stringify({ branchId: ROOF, roleCode: "CASHIER" }),
  }));

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const tok = sniffToken(page);
  await login(page, "waiter");
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await state(page, tok, "1-fresh-login");

  await page.getByRole("button", { name: /switch branch/i }).first().click();
  await page.waitForTimeout(1200);
  await page.locator('[role="menuitem"]').filter({ hasText: /Rooftop/i }).first().click();
  await page.waitForTimeout(8000);
  const afterSwitch = await state(page, tok, "2-immediately-after-switch");
  await shot(page, "07-after-switch");

  // SOFT navigation — click the sidebar link, which is what a user actually does
  const custLink = page.locator('[data-slot="sidebar"］, [data-slot="sidebar"] a').filter({ hasText: /customers/i }).first();
  const linkCount = await page.locator('[data-slot="sidebar"] a').filter({ hasText: /customers/i }).count();
  log("customers-link-in-sidebar", linkCount);
  if (linkCount) {
    await page.locator('[data-slot="sidebar"] a').filter({ hasText: /customers/i }).first().click();
    await page.waitForTimeout(6000);
    const soft = await state(page, tok, "3-after-SOFT-nav-to-customers");
    const body = await page.locator("body").innerText().catch(() => "");
    log("3-soft-nav-page-denied", /access denied|do not have permission/i.test(body));
    await shot(page, "07-soft-nav-customers");
  }

  // RELOAD — the plain F5 a real user presses
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  const afterReload = await state(page, tok, "4-after-RELOAD");
  const bodyR = await page.locator("body").innerText().catch(() => "");
  log("4-reload-page-denied", /access denied|do not have permission/i.test(bodyR));
  await shot(page, "07-after-reload");

  // HARD navigation, e.g. a bookmark
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  await state(page, tok, "5-after-HARD-nav");
  await shot(page, "07-after-hard-nav");

  // ---------- RESTORE ----------
  const del = await api(owner.token, `/api/v1/users/${waiter.id}/branch-roles?branchId=${ROOF}&roleCode=CASHIER`, { method: "DELETE" });
  log("RESTORE-delete", del);
  const after = await fetch(`http://localhost:8080/api/v1/users/${waiter.id}`, { headers: H }).then((r) => r.json());
  log("RESTORE-assignments", JSON.stringify(after.data.assignments));

  writeFileSync(`${SHOTS}/07-branch-persist.json`, JSON.stringify(out, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  writeFileSync(`${SHOTS}/07-branch-persist.json`, JSON.stringify({ ...out, fatal: String(e) }, null, 2));
  process.exit(1);
});
