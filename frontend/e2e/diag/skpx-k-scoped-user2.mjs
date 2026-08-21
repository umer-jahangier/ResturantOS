/*
 * PROBE K — probe J redone. Two faults in that run were MINE, not the product's:
 *   - it selected branch "Floating Terrace — Rooftop" (first regex match) instead of HQ, and the
 *     stations picker only offers stations for the branch the admin is SIGNED IN to, so it
 *     correctly showed a cross-branch notice instead of checkboxes;
 *   - the forced password change is served on /login itself, so the login helper reported failure.
 * Both fixed here. Nothing about the Stations picker is claimed until this run sees it.
 */
import { launch, newPage, login, probe, shot, readDialog, BASE } from "./skpx-lib.mjs";

const STAMP = Date.now().toString().slice(-6);
const HQ = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";

async function createScoped(page, email, stationText) {
  await probe(page, "/app/users", { who: "owner", wait: 6000 });
  await page.locator('button:has-text("Add user")').first().click();
  await page.waitForTimeout(2000);

  await page.locator('[role="dialog"] input[type="email"], [role="dialog"] input[name*="mail" i]').first().fill(email);
  const nameField = page.locator('[role="dialog"] input[name*="name" i]').first();
  if (await nameField.count()) await nameField.fill(`Diag ${STAMP}`);

  const selects = page.locator('[role="dialog"] select');
  await selects.nth(0).selectOption(HQ);            // Floating Terrace HQ — the signed-in branch
  await page.waitForTimeout(1500);
  await selects.nth(1).selectOption("KITCHEN_STAFF");
  await page.waitForTimeout(2500);

  const d = await readDialog(page);
  console.log(`  dialog after HQ + Kitchen Staff: w=${d?.w} labels=${JSON.stringify(d?.labels)}`);
  const field = await page.evaluate(() => {
    const f = document.querySelector('[data-testid="station-assignment-field"]');
    return f ? { present: true, text: f.innerText.replace(/\s+/g, " ").slice(0, 400), boxes: [...f.querySelectorAll("input[type=checkbox]")].length } : { present: false };
  });
  console.log(`  station-assignment-field: ${JSON.stringify(field)}`);
  await shot(page, `skpx-k-dialog-${stationText.replace(/\W+/g, "")}`);

  const box = page.locator('[data-testid="station-assignment-field"] label').filter({ hasText: stationText }).first();
  if (await box.count()) { await box.click(); console.log(`  ticked "${stationText}"`); }
  else { console.log(`  !! no checkbox matching "${stationText}"`); }

  await page.locator('[role="dialog"] button[type="submit"], [role="dialog"] button:has-text("Add user")').last().click();
  await page.waitForTimeout(5500);
  const txt = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  const pw = (txt.match(/[A-Za-z0-9!@#$%^&*]{12,24}/g) ?? []).filter((s) => /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s) && /[!@#$%^&*]/.test(s));
  console.log(`  temp password: ${JSON.stringify(pw.slice(0, 2))}`);
  await shot(page, `skpx-k-created-${stationText.replace(/\W+/g, "")}`);
  return pw[0] ?? null;
}

/** Signs in and clears the forced password change, which is rendered on /login itself. */
async function signInFresh(page, email, tempPw, newPw) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill("floating-terrace");
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(tempPw);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);
  const body = await page.locator("body").innerText();
  if (/must set its own password|Choose a new password/i.test(body)) {
    console.log("  forced password change — completing it");
    const pws = page.locator('input[type="password"]');
    const n = await pws.count();
    console.log(`    ${n} password fields`);
    if (n === 3) { await pws.nth(0).fill(tempPw); await pws.nth(1).fill(newPw); await pws.nth(2).fill(newPw); }
    else if (n === 2) { await pws.nth(0).fill(newPw); await pws.nth(1).fill(newPw); }
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(6000);
    console.log(`    after change: ${page.url()}`);
    if (page.url().includes("/login")) {
      await page.locator('input[name="email"], input#email').first().fill(email);
      await page.locator('input[name="password"], input#password').first().fill(newPw);
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(5000);
    }
  }
  const ok = !page.url().includes("/login");
  console.log(`  signed in: ${ok} url=${page.url()}`);
  return ok;
}

async function inspect(browser, email, tempPw, label) {
  const { page } = await newPage(browser);
  console.log(`\n--- ${label}: ${email} ---`);
  if (!(await signInFresh(page, email, tempPw, "Diag#Scoped9x"))) {
    await shot(page, `skpx-k-loginfail-${label}`);
    console.log("  could not establish a session");
    await page.context().close(); return;
  }
  const k = await probe(page, "/app/kitchen", { wait: 7000 });
  console.log(`  /app/kitchen -> url=${k.url} heads=${JSON.stringify(k.heads)} denied=${k.denied} failed=${k.failed}`);
  console.log(`  body: ${k.text.replace(/\s+/g, " ").slice(0, 420)}`);
  await shot(page, `skpx-k-kitchen-${label}`);
  for (const code of ["DEFAULT", "GRILL", "BAR"]) {
    const b = await probe(page, `/app/kitchen/${code}`, { wait: 6000 });
    const m = await page.evaluate(() => ({
      cards: document.querySelectorAll('[data-testid="kds-ticket-card"]').length,
      conn: document.querySelector('[data-testid="kds-connection"]')?.innerText.trim(),
      count: document.querySelector('[data-testid="kds-ticket-count"]')?.innerText.trim(),
    }));
    console.log(`    /app/kitchen/${code}: heads=${JSON.stringify(b.heads)} cards=${m.cards} count="${m.count}" conn="${m.conn}" denied=${b.denied}`);
    await shot(page, `skpx-k-${label}-${code}`);
  }
  await page.context().close();
}

async function main() {
  const browser = await launch();
  const { page } = await newPage(browser);
  if (!(await login(page, "owner"))) process.exit(1);

  const bar = `dgbar${STAMP}@terrace.local`;
  const barPw = await createScoped(page, bar, "Main bar");
  const grill = `dggrill${STAMP}@terrace.local`;
  const grillPw = await createScoped(page, grill, "Hot line");

  if (barPw) await inspect(browser, bar, barPw, "BAR");
  if (grillPw) await inspect(browser, grill, grillPw, "GRILL");
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
