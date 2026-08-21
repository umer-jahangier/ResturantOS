/*
 * PROBE P — re-drive the BAR-scoped bartender created in probe M, now that the Drinks category
 * is routed to BAR and a real ticket has projected the BAR station into kitchen-service.
 *
 * The question this settles: is "No active stations configured" an independent defect in the
 * scoped-KDS feature, or purely a downstream consequence of the missing routing screen?
 * Its password was set to a known value during probe M, so no new account is needed — the
 * email is read off the Users screen.
 */
import { launch, newPage, login, probe, shot, BASE } from "./skpx-lib.mjs";

const PW = "Diag#BarOnly7x";

async function main() {
  const browser = await launch();
  const { page } = await newPage(browser);
  if (!(await login(page, "owner"))) process.exit(1);

  await probe(page, "/app/users", { who: "owner", wait: 7000 });
  const emails = await page.evaluate(() =>
    (document.body.innerText.match(/dgbar3?\d*@terrace\.local/g) ?? []));
  console.log(`  bartender accounts on the Users screen: ${JSON.stringify([...new Set(emails)])}`);
  const email = "dgbar3136331@terrace.local"; // the one whose password probe M actually set
  if (!email) { console.log("  none found"); await browser.close(); return; }

  const { page: bp } = await newPage(browser);
  await bp.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await bp.waitForTimeout(1500);
  const slug = bp.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill("floating-terrace");
  await bp.locator('input[name="email"], input#email').first().fill(email);
  await bp.locator('input[name="password"], input#password').first().fill(PW);
  await bp.locator('button[type="submit"]').first().click();
  await bp.waitForTimeout(6000);
  console.log(`  signed in as ${email}: ${!bp.url().includes("/login")} url=${bp.url()}`);
  if (bp.url().includes("/login")) {
    console.log(`  body: ${(await bp.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 250)}`);
    await shot(bp, "skpx-p-loginfail"); await browser.close(); return;
  }

  const k = await probe(bp, "/app/kitchen", { wait: 7500 });
  console.log(`\n=== THE BARTENDER'S KITCHEN DISPLAY, WITH DRINKS ROUTED TO BAR ===`);
  console.log(`  url=${k.url} heads=${JSON.stringify(k.heads)} denied=${k.denied} failed=${k.failed}`);
  console.log(`  BODY: ${k.text.replace(/\s+/g, " ").slice(0, 600)}`);
  await shot(bp, "skpx-p1-bartender-kitchen-after-routing");

  for (const code of ["BAR", "DEFAULT"]) {
    const b = await probe(bp, `/app/kitchen/${code}`, { wait: 6500 });
    const m = await bp.evaluate(() => ({
      cards: [...document.querySelectorAll('[data-testid="kds-ticket-card"]')].map((c) => c.innerText.replace(/\s+/g, " ").slice(0, 140)),
      conn: document.querySelector('[data-testid="kds-connection"]')?.innerText.trim(),
      count: document.querySelector('[data-testid="kds-ticket-count"]')?.innerText.trim(),
    }));
    console.log(`  /app/kitchen/${code}: h1=${JSON.stringify(b.heads[0])} count="${m.count}" conn="${m.conn}" cards=${m.cards.length}`);
    m.cards.slice(0, 3).forEach((c) => console.log(`      ${c}`));
    await shot(bp, `skpx-p2-bartender-${code}`);
  }
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
