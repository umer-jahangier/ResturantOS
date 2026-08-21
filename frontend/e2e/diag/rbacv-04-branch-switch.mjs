/*
 * PROBE 4 — finish what probe 3 started, correctly.
 *
 * Probe 3's "Rooftop not visible" reading was MY measurement error: the branch switcher is a
 * collapsed Radix dropdown (components/shared/branch-switcher.tsx renders only when the user has
 * >1 branch), so the option text is not in the DOM until the trigger is clicked, and my last
 * navigation had been to a denied page. Re-driving properly.
 *
 * The real question for the (d) WORKS verdict: after an admin grants CASHIER on Rooftop, can the
 * waiter reach that branch and actually exercise the role — new JWT, new permissions, previously
 * denied screens now open? A grant that persists in a table but never reaches the grantee is
 * "structurally present, behaviourally absent".
 *
 * Restores the grant at the end (shape-corrected: the envelope is {data: [...]}, not data.content).
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { SHOTS, login, open, shot, sniffToken, api, apiLogin, jwtClaims } from "./rbacv-lib.mjs";

const out = { probe: "branch-scoped-role-actually-usable", steps: [] };
const log = (k, v) => {
  out.steps.push({ k, v });
  console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v).slice(0, 600));
};

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const tok = sniffToken(page);
  await login(page, "waiter");
  await open(page, "/app/dashboard");
  await page.waitForTimeout(2500);

  log("jwt-at-HQ", {
    branch: jwtClaims(tok.value ?? "")?.branch_id,
    roles: jwtClaims(tok.value ?? "")?.roles,
    perms: jwtClaims(tok.value ?? "")?.permissions?.length,
  });
  const mine = await api(tok.value, "/api/v1/branches/mine");
  log("branches-mine", mine.body);
  const grantPresent = /Rooftop/.test(mine.body) && /CASHIER/.test(mine.body);
  log("rooftop-cashier-grant-still-present", grantPresent);

  // baseline: till page denied at HQ
  const tillsHq = await open(page, "/app/pos/tills");
  log("tills-at-HQ", { denied: tillsHq.denied, notFound: tillsHq.notFound });

  // open the branch switcher properly
  await open(page, "/app/dashboard");
  await page.waitForTimeout(2000);
  const trigger = page.getByRole("button", { name: /switch branch/i }).first();
  const triggerCount = await trigger.count();
  log("branch-switcher-trigger-present", triggerCount);
  await shot(page, "04-waiter-dashboard-with-switcher");

  if (triggerCount === 0) {
    log("VERDICT", "no branch switcher rendered for a user holding 2 branch roles");
  } else {
    await trigger.click();
    await page.waitForTimeout(1200);
    const menu = page.locator('[role="menu"]');
    const items = await menu.locator('[role="menuitem"]').allInnerTexts().catch(() => []);
    log("switcher-menu-items", items);
    await shot(page, "04-switcher-open");

    const rooftop = menu.getByText(/Rooftop/i).first();
    if (await rooftop.count()) {
      await rooftop.click();
      await page.waitForTimeout(6000);
      const c = jwtClaims(tok.value ?? "");
      log("jwt-after-switch", {
        branch: c?.branch_id,
        roles: c?.roles,
        perms: c?.permissions?.length,
        hasTillOpen: (c?.permissions ?? []).includes("pos.till.open"),
        hasCrmView: (c?.permissions ?? []).includes("crm.customer.view"),
      });
      await shot(page, "04-after-switch-to-rooftop");

      const nav = await page.locator("nav").innerText().catch(() => "");
      log("nav-after-switch", { hasTill: /till/i.test(nav), hasCustomers: /customers/i.test(nav) });

      const tillsRoof = await open(page, "/app/pos/tills");
      log("tills-at-ROOFTOP", { denied: tillsRoof.denied, notFound: tillsRoof.notFound, head: tillsRoof.body.slice(0, 200).replace(/\s+/g, " ") });
      await shot(page, "04-tills-at-rooftop");

      const crmRoof = await open(page, "/app/crm");
      log("crm-at-ROOFTOP", { denied: crmRoof.denied, head: crmRoof.body.slice(0, 160).replace(/\s+/g, " ") });

      const prof = await open(page, "/app/profile");
      log("profile-perm-count-at-ROOFTOP", (prof.body.match(/Permissions\s+(\d+)/) ?? [])[1] ?? null);
      await shot(page, "04-profile-at-rooftop");
    } else {
      log("VERDICT", "switcher open but Rooftop is not among its items");
    }
  }

  // ---------- RESTORE ----------
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
  log("restore-ids", { waiter: waiter?.id, rooftop: rooftop?.id });
  const del = await api(
    owner.token,
    `/api/v1/users/${waiter.id}/branch-roles?branchId=${rooftop.id}&roleCode=CASHIER`,
    { method: "DELETE" },
  );
  log("RESTORE-delete", del);
  const verify = await fetch(`http://localhost:8080/api/v1/users/${waiter.id}`, { headers: H }).then((r) => r.text());
  log("RESTORE-verify-user-row", verify.slice(0, 600));

  writeFileSync(`${SHOTS}/04-branch-switch.json`, JSON.stringify(out, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error("FATAL", e);
  writeFileSync(`${SHOTS}/04-branch-switch.json`, JSON.stringify({ ...out, fatal: String(e) }, null, 2));
  process.exit(1);
});
