/*
 * PROBE 5 — a controlled A/B on the branch switcher, because probe 4's negative could have been
 * my own error (the switcher is hidden while the sidebar is collapsed, sidebar.tsx:185).
 *
 * A: waiter with ONE branch role  -> switcher must be absent (by design, branches.length <= 1)
 * B: waiter with TWO branch roles -> switcher must be present and offer Rooftop
 *
 * The grant is made over the API so the two states are deterministic, and the sidebar's own
 * data-collapsed attribute is read so a collapsed sidebar cannot be mistaken for a missing feature.
 * Also re-measures the tills page in both states with a longer settle, because probe 3 and probe 4
 * disagreed about it and one of those readings is wrong.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { SHOTS, login, open, shot, sniffToken, api, apiLogin, jwtClaims, BASE } from "./rbacv-lib.mjs";

const out = { probe: "branch-switcher-AB", steps: [] };
const log = (k, v) => {
  out.steps.push({ k, v });
  console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v).slice(0, 600));
};

async function measure(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const tok = sniffToken(page);
  await login(page, "waiter");
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(5000);

  const sb = page.locator('[data-slot="sidebar"]').first();
  const collapsed = await sb.getAttribute("data-collapsed").catch(() => "(no sidebar)");
  // expand if collapsed, so the switcher cannot be hidden by chrome state
  if (collapsed === "true") {
    await page.getByRole("button", { name: /expand|collapse/i }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
  }
  const collapsed2 = await sb.getAttribute("data-collapsed").catch(() => "?");
  const sidebarText = (await sb.innerText().catch(() => "")).replace(/\s+/g, " ");
  const byLabel = await page.getByRole("button", { name: /switch branch/i }).count();
  const byAria = await page.locator('button[aria-label="Switch branch"]').count();
  const skeleton = await page.locator('[aria-label="Loading branches"]').count();
  const mine = await api(tok.value, "/api/v1/branches/mine");
  const c = jwtClaims(tok.value ?? "");

  const m = {
    sidebarCollapsedBefore: collapsed,
    sidebarCollapsedAfter: collapsed2,
    switcherByRole: byLabel,
    switcherByAria: byAria,
    stillSkeleton: skeleton,
    branchesFromApi: (JSON.parse(mine.body).data ?? []).map((b) => `${b.name}=${b.roleCode}`),
    jwt: { branch: c?.branch_id, roles: c?.roles, perms: c?.permissions?.length },
    sidebarHead: sidebarText.slice(0, 220),
  };
  log(`state-${label}`, m);
  await shot(page, `05-${label}-sidebar`);

  const tills = await open(page, "/app/pos/tills", { settle: 6000 });
  log(`tills-${label}`, {
    denied: tills.denied,
    body: tills.body.replace(/\s+/g, " ").slice(0, 260),
  });
  await shot(page, `05-${label}-tills`);

  let switched = null;
  if (byLabel > 0) {
    await open(page, "/app/dashboard", { settle: 4000 });
    await page.getByRole("button", { name: /switch branch/i }).first().click();
    await page.waitForTimeout(1500);
    const items = await page.locator('[role="menuitem"]').allInnerTexts().catch(() => []);
    log(`${label}-menu-items`, items);
    await shot(page, `05-${label}-menu-open`);
    const roof = page.locator('[role="menuitem"]').filter({ hasText: /Rooftop/i }).first();
    if (await roof.count()) {
      await roof.click();
      await page.waitForTimeout(7000);
      const c2 = jwtClaims(tok.value ?? "");
      switched = {
        branch: c2?.branch_id,
        roles: c2?.roles,
        perms: c2?.permissions?.length,
        hasTillOpen: (c2?.permissions ?? []).includes("pos.till.open"),
        hasCrmView: (c2?.permissions ?? []).includes("crm.customer.view"),
      };
      log(`${label}-jwt-after-switch`, switched);
      await shot(page, `05-${label}-after-switch`);
      const nav = await page.locator("nav").innerText().catch(() => "");
      log(`${label}-nav-after-switch`, { hasTill: /till/i.test(nav), hasCustomers: /customers/i.test(nav) });
      const t2 = await open(page, "/app/pos/tills", { settle: 6000 });
      log(`${label}-tills-at-rooftop`, { denied: t2.denied, body: t2.body.replace(/\s+/g, " ").slice(0, 240) });
      await shot(page, `05-${label}-tills-rooftop`);
      const crm2 = await open(page, "/app/crm", { settle: 5000 });
      log(`${label}-crm-at-rooftop`, { denied: crm2.denied, body: crm2.body.replace(/\s+/g, " ").slice(0, 200) });
      const prof = await open(page, "/app/profile", { settle: 5000 });
      log(`${label}-profile-perms-at-rooftop`, (prof.body.match(/Permissions\s+(\d+)/) ?? [])[1] ?? null);
    }
  }
  await ctx.close();
  return { ...m, switched };
}

async function main() {
  const browser = await chromium.launch();
  const owner = await apiLogin({
    email: "owner@terrace.local",
    password: "Terrace#Owner1",
    tenantSlug: "floating-terrace",
    totpEmail: "owner@terrace.local",
  });
  const H = { Authorization: `Bearer ${owner.token}` };
  const users = await fetch("http://localhost:8080/api/v1/users?size=200", { headers: H }).then((r) => r.json());
  const waiter = (users.data ?? []).find((u) => u.email === "waiter@terrace.local");
  const branches = await fetch("http://localhost:8080/api/v1/branches", { headers: H }).then((r) => r.json());
  const rooftop = (branches.data ?? []).find((b) => /rooftop/i.test(b.name ?? ""));

  const A = await measure(browser, "A-one-branch");

  const grant = await api(owner.token, `/api/v1/users/${waiter.id}/branch-roles`, {
    method: "POST",
    body: JSON.stringify({ branchId: rooftop.id, roleCode: "CASHIER" }),
  });
  log("grant-cashier-on-rooftop", grant);

  const B = await measure(browser, "B-two-branches");

  const del = await api(
    owner.token,
    `/api/v1/users/${waiter.id}/branch-roles?branchId=${rooftop.id}&roleCode=CASHIER`,
    { method: "DELETE" },
  );
  log("RESTORE-delete", del);

  writeFileSync(`${SHOTS}/05-switcher-ab.json`, JSON.stringify({ ...out, A, B }, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  writeFileSync(`${SHOTS}/05-switcher-ab.json`, JSON.stringify({ ...out, fatal: String(e) }, null, 2));
  process.exit(1);
});
