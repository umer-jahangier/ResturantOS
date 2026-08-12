/*
 * S8 RE-OPEN — step 5. Stop the GRILL printer, fire a grilled dish, and read the OWNER's screen.
 *
 * The claim under test: the Printers screen names the STATION that cannot print, with the
 * transport's own error, while the agent beside it still reads Connected.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { newBrowser, newPage, login as baseLogin, go, PEOPLE, apiGet, branchOf, totpFor, BASE } from "../s8/lib.mjs";

/** The shared helper gives the TOTP field 3 s to appear; under ten concurrent agents it needs more. */
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
        await page
          .locator('input[name="totpCode"], input#totpCode')
          .first()
          .waitFor({ timeout: 45_000 });
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
      console.log(`    login attempt ${attempt} for ${who.email} failed: ${String(e).slice(0, 120)}`);
      await page.waitForTimeout(4000);
    }
  }
  void baseLogin;
  throw new Error(`login failed for ${who.email}`);
}

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S8-reopen");
mkdirSync(OUT, { recursive: true });
const rec = { checks: [] };
const check = (n, p, d) => {
  console.log(`  ${p ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);
  rec.checks.push({ name: n, pass: p, detail: d });
};
const say = (k, v) => {
  console.log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  rec[k] = v;
};

const pidOn = (port) => {
  try {
    return execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { encoding: "utf8" }).trim().split("\n")[0];
  } catch {
    return null;
  }
};

const grillPid = pidOn(9105);
say("grillPrinterPid", grillPid);
if (!grillPid) throw new Error("no listener on 9105 — nothing to switch off");

const browser = await newBrowser();
const owner = await newPage(browser);
const till = await newPage(browser);
try {
  await login(owner, PEOPLE.owner);
  let branchId = null;
  for (let i = 0; i < 6 && !branchId; i += 1) {
    try {
      branchId = await branchOf(owner);
    } catch {
      await owner.waitForTimeout(3000);
    }
  }

  // The screen BEFORE: no failing alert for GRILL.
  await go(owner, "/app/settings/printers", { waitMs: 7000 });
  const before = await owner.evaluate(() => ({
    failing: (document.querySelector('[data-testid="printers-failing"]')?.innerText ?? "").trim(),
    grillDelivery: (
      Array.from(document.querySelectorAll('[data-testid="printer-row"]')).find(
        (r) => r.getAttribute("data-printer-id") === "grill-9105",
      )?.querySelector('[data-testid="printer-delivery"]')?.textContent ?? ""
    ).trim(),
  }));
  say("before", before);
  check("before I break anything, GRILL is not accused", !/GRILL cannot print/i.test(before.failing), before.failing.slice(0, 120));
  await owner.screenshot({ path: `${OUT}/r05a-before.png` });

  // ── switch the printer off ────────────────────────────────────────────────────────────────
  execSync(`kill ${grillPid}`);
  await owner.waitForTimeout(2000);
  say("stillListening", pidOn(9105));
  check("the GRILL printer is now switched off", pidOn(9105) === null, String(pidOn(9105)));

  // ── fire a grilled dish ───────────────────────────────────────────────────────────────────
  await login(till, PEOPLE.cashier);
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
  const idx = names.findIndex((n) => /Butter Naan/i.test(n));
  await tiles.nth(idx).click();
  await till.waitForTimeout(900);
  await till.locator("[data-testid=send-to-kitchen-button]").click();
  await till.waitForTimeout(9000);
  const orderNo = await till.evaluate(
    () => Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0])))[0] ?? null,
  );
  say("orderNo", orderNo);

  // ── what does the OWNER's screen say now? ─────────────────────────────────────────────────
  let seen = null;
  for (let i = 0; i < 14; i += 1) {
    await owner.reload({ waitUntil: "domcontentloaded" });
    await owner.waitForTimeout(4000);
    seen = await owner.evaluate(() => ({
      failing: (document.querySelector('[data-testid="printers-failing"]')?.innerText ?? "").trim(),
      perPrinter: Array.from(document.querySelectorAll('[data-testid="printer-cannot-print"]')).map((n) => ({
        id: n.getAttribute("data-printer-id"),
        text: n.innerText.replace(/\s+/g, " ").trim(),
      })),
      agentRows: Array.from(document.querySelectorAll("[data-agent-liveness]")).map(
        (n) => n.getAttribute("data-agent-liveness"),
      ),
      bodyHasConnected: /Connected/.test(document.body.innerText),
      grillDelivery: (
        Array.from(document.querySelectorAll('[data-testid="printer-row"]')).find(
          (r) => r.getAttribute("data-printer-id") === "grill-9105",
        )?.querySelector('[data-testid="printer-delivery"]')?.textContent ?? ""
      ).trim(),
    }));
    console.log(`    t+${i * 5}s failing="${seen.failing.slice(0, 90)}"`);
    if (/GRILL/i.test(seen.failing)) break;
    await owner.waitForTimeout(1000);
  }
  say("after", seen);
  await owner.screenshot({ path: `${OUT}/r05b-grill-cannot-print.png` });

  check(
    "the screen names the STATION that cannot print",
    /GRILL cannot print/i.test(seen.failing),
    seen.failing.slice(0, 200),
  );
  check(
    "and quotes the transport's own error, not 'printing failed'",
    /9105/.test(seen.failing) && /refus|ECONNREFUSED|connection/i.test(seen.failing),
    seen.failing.slice(0, 260),
  );
  check(
    "the row's own delivery badge stopped saying Delivered",
    !/^Delivered$/i.test(seen.grillDelivery),
    seen.grillDelivery,
  );
  check(
    "while the machine beside it still reads Connected — the pair that is the whole point",
    seen.bodyHasConnected === true,
    String(seen.bodyHasConnected),
  );

  const health = await apiGet(owner, `/api/v1/pos/printers/health?branchId=${branchId}`);
  const grill = (health.body?.data?.printers ?? health.body?.printers ?? []).find((p) => p.printerId === "grill-9105");
  say("healthGrill", grill);
  check("the server agrees: grill-9105 is FAILING", grill?.state === "FAILING", JSON.stringify(grill));
} catch (e) {
  check("harness completed", false, String(e));
} finally {
  writeFileSync(`${OUT}/r05-grill-down.json`, JSON.stringify(rec, null, 2));
  const bad = rec.checks.filter((c) => !c.pass).length;
  console.log(`\n  ${rec.checks.length - bad}/${rec.checks.length} checks passed`);
  await browser.close();
}
