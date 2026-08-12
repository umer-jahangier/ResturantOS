/*
 * S8 RE-OPEN — step 6.
 *  a) the GRILL printer is back: does the accusation clear on its own once a ticket succeeds?
 *  b) the WRONG personas: manager, kitchen, waiter — screen and endpoint
 *  c) another TENANT's owner asking about Floating Terrace's printers
 */
import { statSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { newBrowser, newPage, go, PEOPLE, apiGet, branchOf, totpFor, BASE } from "../s8/lib.mjs";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S8-reopen");
mkdirSync(OUT, { recursive: true });
const GRILL = process.env.GRILL_CAPTURE;
const size = (f) => {
  try {
    return statSync(f).size;
  } catch {
    return 0;
  }
};
const rec = { checks: [] };
const check = (n, p, d) => {
  console.log(`  ${p ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);
  rec.checks.push({ name: n, pass: p, detail: d });
};
const say = (k, v) => {
  console.log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  rec[k] = v;
};

async function login(page, who) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);
      const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
      if (await slug.count()) await slug.first().fill(who.slug);
      await page.locator('input[name="email"], input#email').first().fill(who.email);
      await page.locator('input[name="password"], input#password').first().fill(who.password);
      await page.locator('button[type="submit"]').first().click();
      if (who.totpSecret) {
        await page.locator('input[name="totpCode"], input#totpCode').first().waitFor({ timeout: 45_000 });
        for (let t = 0; t < 3; t += 1) {
          const f = page.locator('input[name="totpCode"], input#totpCode');
          if ((await f.count()) === 0) break;
          await f.first().fill(totpFor(who));
          await page.locator('button[type="submit"]').first().click();
          await page.waitForTimeout(6000);
          if (!page.url().includes("/login")) break;
        }
      } else {
        await page.waitForTimeout(8000);
      }
      await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 30_000 });
      console.log(`  ✓ signed in as ${who.email}`);
      return page;
    } catch (e) {
      console.log(`    login attempt ${attempt} for ${who.email}: ${String(e).slice(0, 90)}`);
      await page.waitForTimeout(4000);
    }
  }
  throw new Error(`login failed for ${who.email}`);
}

const browser = await newBrowser();
try {
  // ── (a) recovery ──────────────────────────────────────────────────────────────────────────
  const owner = await newPage(browser);
  await login(owner, PEOPLE.owner);
  let branchId = null;
  for (let i = 0; i < 6 && !branchId; i += 1) {
    try {
      branchId = await branchOf(owner);
    } catch {
      await owner.waitForTimeout(3000);
    }
  }
  say("branchId", branchId);

  await go(owner, "/app/settings/printers", { waitMs: 6000 });
  const stillAccusing = await owner.evaluate(
    () => (document.querySelector('[data-testid="printers-failing"]')?.innerText ?? "").trim(),
  );
  check(
    "with the printer plugged back in but no ticket sent since, the screen STILL accuses GRILL",
    /GRILL cannot print/i.test(stillAccusing),
    stillAccusing.slice(0, 140),
  );

  const till = await newPage(browser);
  await login(till, PEOPLE.cashier);
  const before = size(GRILL);
  await go(till, "/app/pos", { waitMs: 9000, allowTrouble: true });
  await till.locator("[data-testid=order-type-takeaway]").click();
  await till.waitForTimeout(700);
  const search = till.getByLabel(/search menu/i);
  if (await search.count()) {
    await search.first().fill("Butter Naan");
    await till.waitForTimeout(2500);
  }
  const tiles = till.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 30_000 });
  const names = await tiles.allTextContents();
  await tiles.nth(names.findIndex((n) => /Butter Naan/i.test(n))).click();
  await till.waitForTimeout(900);
  await till.locator("[data-testid=send-to-kitchen-button]").click();
  await till.waitForTimeout(9000);
  for (let i = 0; i < 14 && size(GRILL) === before; i += 1) await till.waitForTimeout(1500);
  say("grillBytes", { before, after: size(GRILL) });
  check("the restarted GRILL printer receives the next ticket", size(GRILL) > before, `${before} → ${size(GRILL)}`);

  let cleared = null;
  for (let i = 0; i < 12; i += 1) {
    await owner.reload({ waitUntil: "domcontentloaded" });
    await owner.waitForTimeout(4000);
    cleared = await owner.evaluate(() => ({
      failing: (document.querySelector('[data-testid="printers-failing"]')?.innerText ?? "").trim(),
      grillDelivery: (
        Array.from(document.querySelectorAll('[data-testid="printer-row"]')).find(
          (r) => r.getAttribute("data-printer-id") === "grill-9105",
        )?.querySelector('[data-testid="printer-delivery"]')?.textContent ?? ""
      ).trim(),
    }));
    console.log(`    t+${i * 5}s failing="${cleared.failing.slice(0, 60)}" delivery="${cleared.grillDelivery}"`);
    if (!/GRILL cannot print/i.test(cleared.failing)) break;
  }
  say("afterRecovery", cleared);
  check(
    "the accusation clears with NO clicks once a ticket actually printed",
    !/GRILL cannot print/i.test(cleared.failing),
    cleared.failing.slice(0, 120),
  );
  await owner.screenshot({ path: `${OUT}/r06a-recovered.png` });

  // ── (b) the wrong personas ────────────────────────────────────────────────────────────────
  for (const name of ["manager", "kitchen", "waiter"]) {
    const who = PEOPLE[name] ?? { slug: "floating-terrace", email: `${name}@terrace.local`, password: `Terrace#${name[0].toUpperCase()}${name.slice(1)}1` };
    const p = await newPage(browser);
    try {
      await login(p, who);
      const h = await apiGet(p, `/api/v1/pos/printers/health?branchId=${branchId}`);
      const t = await go(p, "/app/settings/printers", { waitMs: 6000, allowTrouble: true });
      const screen = await p.evaluate(() => ({
        deniedText: /Access denied|do not have permission|not authorised|not authorized/i.test(document.body.innerText),
        pickers: document.querySelectorAll('[data-testid="system-printer-picker"]').length,
        rows: document.querySelectorAll('[data-testid="printer-row"]').length,
        save: document.querySelector('[data-testid="save-printers"]') !== null,
      }));
      say(`persona.${name}`, { healthStatus: h.status, trouble: t.bad, screen });
    } catch (e) {
      say(`persona.${name}`, { error: String(e).slice(0, 120) });
    } finally {
      await p.close();
    }
  }

  // ── (c) another tenant ────────────────────────────────────────────────────────────────────
  const other = await newPage(browser);
  try {
    await login(other, {
      slug: "control-bistro-isolation-test-tenant",
      email: "owner@control.local",
      password: "Control#Owner1",
      totpSecret: "77YCNG564SWVW7YPUCJRGDSE6ZSCC3GQ",
    });
    const cross = await apiGet(other, `/api/v1/pos/printers/health?branchId=${branchId}`);
    const crossCfg = await apiGet(other, `/api/v1/branches/${branchId}/receipt-config`);
    const crossAgents = await apiGet(other, `/api/v1/pos/print-agents?branchId=${branchId}`);
    say("crossTenant", {
      healthStatus: cross.status,
      healthPrinters: (cross.body?.data?.printers ?? cross.body?.printers ?? []).length,
      healthBody: JSON.stringify(cross.body).slice(0, 200),
      cfgStatus: crossCfg.status,
      cfgBody: JSON.stringify(crossCfg.body).slice(0, 200),
      agentsStatus: crossAgents.status,
      agentsBody: JSON.stringify(crossAgents.body).slice(0, 200),
    });
    const leaked =
      (cross.body?.data?.printers ?? cross.body?.printers ?? []).length > 0 ||
      /audit-receipt|grill-9105|_80Series2|STMicroelectronics/.test(JSON.stringify(crossCfg.body ?? {})) ||
      /F8 live agent|_80Series2/.test(JSON.stringify(crossAgents.body ?? {}));
    check("tenant B learns NOTHING about tenant A's printers", !leaked, leaked ? "LEAK" : "no rows, no names");
  } catch (e) {
    check("cross-tenant probe ran", false, String(e).slice(0, 140));
  }
} catch (e) {
  check("harness completed", false, String(e).slice(0, 200));
} finally {
  writeFileSync(`${OUT}/r06-recover-personas.json`, JSON.stringify(rec, null, 2));
  const bad = rec.checks.filter((c) => !c.pass).length;
  console.log(`\n  ${rec.checks.length - bad}/${rec.checks.length} checks passed`);
  await browser.close();
}
