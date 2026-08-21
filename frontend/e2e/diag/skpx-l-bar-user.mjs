/*
 * PROBE L — the BAR-scoped account, the exact claim: a bartender configured as the product
 * documents lands on "No active stations configured". Probe K proved the Stations picker DOES
 * exist (the earlier miss was my own branch selection, not a product gap) and proved the GRILL
 * case; this isolates BAR, whose station exists in pos-service but has never reached the KDS.
 */
import { launch, newPage, login, probe, shot, BASE } from "./skpx-lib.mjs";

const STAMP = Date.now().toString().slice(-6);
const HQ = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
const EMAIL = `dgbar2${STAMP}@terrace.local`;
const NEWPW = "Diag#BarOnly7x";

async function main() {
  const browser = await launch();
  const { page } = await newPage(browser);
  if (!(await login(page, "owner"))) process.exit(1);

  await probe(page, "/app/users", { who: "owner", wait: 6000 });
  await page.locator('button:has-text("Add user")').first().click();
  await page.waitForTimeout(2000);
  await page.locator('[role="dialog"] input[type="email"], [role="dialog"] input[name*="mail" i]').first().fill(EMAIL);
  const nf = page.locator('[role="dialog"] input[name*="name" i]').first();
  if (await nf.count()) await nf.fill(`Bartender ${STAMP}`);
  const sel = page.locator('[role="dialog"] select');
  await sel.nth(0).selectOption(HQ); await page.waitForTimeout(1500);
  await sel.nth(1).selectOption("KITCHEN_STAFF"); await page.waitForTimeout(2500);

  const box = page.locator('[data-testid="station-assignment-field"] label').filter({ hasText: "Main bar" }).first();
  await box.click();
  const checked = await page.evaluate(() => [...document.querySelectorAll('[data-testid="station-assignment-field"] input[type=checkbox]')]
    .map((c, i) => `${i}:${c.checked}`).join(" "));
  console.log(`  station checkboxes after ticking Main bar: ${checked}`);
  await shot(page, "skpx-l1-dialog-bar-ticked");

  await page.locator('[role="dialog"] button[type="submit"], [role="dialog"] button:has-text("Add user")').last().click();
  await page.waitForTimeout(6000);
  const full = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  console.log(`\n  CREATED-USER SCREEN TEXT:\n  ${full.slice(0, 1200)}`);
  await shot(page, "skpx-l2-created");

  // the temp password is shown on screen; grab whatever token sits after the label
  const m = full.match(/(?:Temporary password|password is|Password)\s*:?\s*([^\s]{10,30})/i);
  const tmp = m?.[1] ?? null;
  console.log(`\n  parsed temp password: ${JSON.stringify(tmp)}`);
  if (!tmp) { console.log("  !! cannot continue without it"); await browser.close(); return; }

  // ---- sign in as the bartender ----
  const { page: bp } = await newPage(browser);
  await bp.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await bp.waitForTimeout(1500);
  const slug = bp.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill("floating-terrace");
  await bp.locator('input[name="email"], input#email').first().fill(EMAIL);
  await bp.locator('input[name="password"], input#password').first().fill(tmp);
  await bp.locator('button[type="submit"]').first().click();
  await bp.waitForTimeout(4500);
  if (/must set its own password|Choose a new password/i.test(await bp.locator("body").innerText())) {
    const pws = bp.locator('input[type="password"]');
    const n = await pws.count();
    if (n === 3) { await pws.nth(0).fill(tmp); await pws.nth(1).fill(NEWPW); await pws.nth(2).fill(NEWPW); }
    else { await pws.nth(0).fill(NEWPW); await pws.nth(1).fill(NEWPW); }
    await bp.locator('button[type="submit"]').first().click();
    await bp.waitForTimeout(6000);
    if (bp.url().includes("/login")) {
      await bp.locator('input[name="email"], input#email').first().fill(EMAIL);
      await bp.locator('input[name="password"], input#password').first().fill(NEWPW);
      await bp.locator('button[type="submit"]').first().click();
      await bp.waitForTimeout(5000);
    }
  }
  console.log(`\n  bartender signed in: ${!bp.url().includes("/login")} url=${bp.url()}`);

  const k = await probe(bp, "/app/kitchen", { wait: 7000 });
  console.log(`\n=== THE BARTENDER'S KITCHEN DISPLAY ===`);
  console.log(`  url=${k.url} heads=${JSON.stringify(k.heads)} denied=${k.denied} failed=${k.failed} alerts=${JSON.stringify(k.alerts)}`);
  console.log(`  FULL BODY: ${k.text.replace(/\s+/g, " ").slice(0, 700)}`);
  await shot(bp, "skpx-l3-bartender-kitchen");

  for (const code of ["BAR", "DEFAULT", "GRILL"]) {
    const b = await probe(bp, `/app/kitchen/${code}`, { wait: 6000 });
    const m2 = await bp.evaluate(() => ({
      cards: document.querySelectorAll('[data-testid="kds-ticket-card"]').length,
      conn: document.querySelector('[data-testid="kds-connection"]')?.innerText.trim(),
      count: document.querySelector('[data-testid="kds-ticket-count"]')?.innerText.trim(),
    }));
    console.log(`  /app/kitchen/${code}: heads=${JSON.stringify(b.heads)} cards=${m2.cards} count="${m2.count}" conn="${m2.conn}"`);
    await shot(bp, `skpx-l4-bartender-${code}`);
  }
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
