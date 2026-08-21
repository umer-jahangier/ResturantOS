/*
 * PROBE J — the station-scoped staff account.
 *  (a) create a BAR-scoped Kitchen Staff user through /app/users, sign in as them, and record
 *      exactly what /app/kitchen shows. Claim under test: "No active stations configured".
 *  (b) create a GRILL-scoped one and check the server actually refuses DEFAULT (D-28-02).
 * Both are driven through the browser; nothing is asserted from source.
 */
import { launch, newPage, login, probe, shot, readDialog, BASE } from "./skpx-lib.mjs";

const STAMP = Date.now().toString().slice(-6);
const ADMIN = "owner";

async function createUser(page, email, stationLabel) {
  await probe(page, "/app/users", { who: ADMIN, wait: 6000 });
  const addBtn = page.locator('button:has-text("Add user")').first();
  console.log(`  Add user button present: ${await addBtn.count()}`);
  await addBtn.click();
  await page.waitForTimeout(1800);
  const d = await readDialog(page);
  console.log(`  add-user dialog: w=${d?.w} labels=${JSON.stringify(d?.labels)}`);

  await page.locator('[role="dialog"] input[type="email"], [role="dialog"] input[name*="mail" i]').first().fill(email);
  const nameField = page.locator('[role="dialog"] input[name*="name" i], [role="dialog"] input[name="fullName"]').first();
  if (await nameField.count()) await nameField.fill(`Diag Bar ${STAMP}`);

  // selects: branch + role
  const selects = page.locator('[role="dialog"] select');
  const n = await selects.count();
  for (let i = 0; i < n; i++) {
    const opts = await selects.nth(i).evaluate((s) => [...s.options].map((o) => `${o.value}|${o.text}`));
    console.log(`    select#${i}: ${JSON.stringify(opts.slice(0, 8))}`);
    const roleOpt = opts.find((o) => /Kitchen Staff/i.test(o));
    const branchOpt = opts.find((o) => /Floating Terrace/i.test(o) && !/Select/i.test(o));
    if (roleOpt) await selects.nth(i).selectOption(roleOpt.split("|")[0]);
    else if (branchOpt) await selects.nth(i).selectOption(branchOpt.split("|")[0]);
    await page.waitForTimeout(900);
  }

  // stations checkbox
  const stationLabels = await page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"] label')].map((l) => l.innerText.trim().replace(/\s+/g, " ")));
  console.log(`    labels now: ${JSON.stringify(stationLabels)}`);
  const target = page.locator('[role="dialog"] label').filter({ hasText: stationLabel }).first();
  if (await target.count()) {
    await target.click();
    console.log(`    ticked station "${stationLabel}"`);
  } else {
    console.log(`    !! no station checkbox matching "${stationLabel}"`);
  }
  await shot(page, `skpx-j-adduser-${stationLabel.replace(/\W+/g, "")}`);

  const submit = page.locator('[role="dialog"] button[type="submit"], [role="dialog"] button:has-text("Add user"), [role="dialog"] button:has-text("Create")').last();
  await submit.click();
  await page.waitForTimeout(5000);
  const after = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  const pw = after.match(/[A-Za-z0-9!@#$%^&*]{10,24}/g)?.filter((s) => /[A-Z]/.test(s) && /[0-9]/.test(s) && /[!@#$%^&*]/.test(s));
  console.log(`  temp password candidates: ${JSON.stringify(pw?.slice(0, 4))}`);
  await shot(page, `skpx-j-created-${stationLabel.replace(/\W+/g, "")}`);
  return pw?.[0] ?? null;
}

async function inspectAsUser(browser, email, password, label) {
  const { page } = await newPage(browser);
  console.log(`\n--- signing in as ${email} (${label}) ---`);
  const ok = await login(page, { slug: "floating-terrace", email, password });
  if (!ok) { console.log("  LOGIN FAILED"); await shot(page, `skpx-j-loginfail-${label}`); return; }
  await page.waitForTimeout(2500);
  console.log(`  landed at ${page.url()}`);
  const body = await page.locator("body").innerText();
  if (/password/i.test(body) && /change|new/i.test(body) && page.url().includes("password")) {
    console.log("  forced password change screen — setting a new password");
    const inputs = page.locator('input[type="password"]');
    const c = await inputs.count();
    for (let i = 0; i < c; i++) await inputs.nth(i).fill(i === 0 && c === 3 ? password : "Diag#Bar99x");
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(5000);
    console.log(`  after change: ${page.url()}`);
  }

  const k = await probe(page, "/app/kitchen", { wait: 6500 });
  console.log(`  /app/kitchen heads=${JSON.stringify(k.heads)} denied=${k.denied} 404=${k.is404} failed=${k.failed}`);
  console.log(`  body: ${k.text.replace(/\s+/g, " ").slice(0, 500)}`);
  await shot(page, `skpx-j-kitchen-${label}`);

  for (const code of ["DEFAULT", "GRILL", "BAR"]) {
    const b = await probe(page, `/app/kitchen/${code}`, { wait: 6000 });
    const cards = await page.evaluate(() => document.querySelectorAll('[data-testid="kds-ticket-card"]').length);
    const conn = await page.evaluate(() => document.querySelector('[data-testid="kds-connection"]')?.innerText.trim());
    console.log(`    /app/kitchen/${code}: heads=${JSON.stringify(b.heads)} cards=${cards} conn="${conn}" denied=${b.denied}`);
    await shot(page, `skpx-j-${label}-${code}`);
  }
  await page.context().close();
}

async function main() {
  const browser = await launch();
  const { page } = await newPage(browser);
  if (!(await login(page, ADMIN))) process.exit(1);

  const barEmail = `diagbar${STAMP}@terrace.local`;
  const barPw = await createUser(page, barEmail, "Main bar");
  const grillEmail = `diaggrill${STAMP}@terrace.local`;
  const grillPw = await createUser(page, grillEmail, "Hot line");

  if (barPw) await inspectAsUser(browser, barEmail, barPw, "BARSCOPED");
  else console.log("\n  !! no temp password captured for the bar user");
  if (grillPw) await inspectAsUser(browser, grillEmail, grillPw, "GRILLSCOPED");

  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
