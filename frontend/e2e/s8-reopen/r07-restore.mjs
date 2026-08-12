/* S8 RE-OPEN — step 7. Put the branch back the way I found it, through the screen. */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { newPage, newBrowser, go, PEOPLE, apiGet, branchOf, totpFor, BASE } from "../s8/lib.mjs";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S8-reopen");
mkdirSync(OUT, { recursive: true });
const rec = { checks: [] };
const check = (n, p, d) => {
  console.log(`  ${p ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`);
  rec.checks.push({ name: n, pass: p, detail: d });
};

async function login(page, who) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
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
      } else await page.waitForTimeout(8000);
      await page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 30_000 });
      return page;
    } catch {
      await page.waitForTimeout(4000);
    }
  }
  throw new Error(`login failed for ${who.email}`);
}

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.owner);
  let branchId = null;
  for (let i = 0; i < 6 && !branchId; i += 1) {
    try {
      branchId = await branchOf(page);
    } catch {
      await page.waitForTimeout(3000);
    }
  }
  await go(page, "/app/settings/printers", { waitMs: 7000 });

  await page.locator('[data-testid="system-printer-picker"]').first().selectOption("STMicroelectronics_POS80_Printer_USB");
  await page.waitForTimeout(500);

  const row = page.locator('[data-testid="printer-row"][data-printer-id="reopen-bar"]');
  if (await row.count()) {
    await row.first().getByRole("button", { name: /remove/i }).click();
    await page.waitForTimeout(700);
  }

  await page.locator('[data-testid="save-printers"]').click();
  await page.waitForTimeout(4000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);

  const cfg = await apiGet(page, `/api/v1/branches/${branchId}/receipt-config`);
  const printers = (cfg.body?.data?.config?.printers ?? []).map(
    (p) => `${p.id}|${p.role}|${p.stationCode}|${p.transport}|${p.host}:${p.port}|${p.systemPrinterName}`,
  );
  rec.printers = printers;
  console.log("  ", JSON.stringify(printers, null, 1));
  check("the till is back on the USB queue I found it on", printers.some((p) => p.includes("STMicroelectronics_POS80_Printer_USB")), "");
  check("my temporary BAR printer is gone", !printers.some((p) => p.startsWith("reopen-bar")), "");
  check("GRILL is still bound to 127.0.0.1:9105", printers.some((p) => p.includes("grill-9105|KITCHEN|GRILL|TCP|127.0.0.1:9105")), "");
  await page.screenshot({ path: `${OUT}/r07-restored.png` });
} catch (e) {
  check("restore completed", false, String(e).slice(0, 200));
} finally {
  writeFileSync(`${OUT}/r07-restore.json`, JSON.stringify(rec, null, 2));
  await browser.close();
}
