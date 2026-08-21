/*
 * PROBE N —
 *  (a) create a station and a menu-scoped POS terminal through the UI and RELOAD to prove the
 *      rows persisted (an optimistic list that vanishes on refresh is not a created record);
 *  (b) then check every plausible way a till could be bound to that terminal — query parameter,
 *      localStorage seeding, a picker — because a false MISSING here costs a rebuild.
 */
import { launch, newPage, login, probe, shot, readDialog, BASE } from "./skpx-lib.mjs";

const STAMP = Date.now().toString().slice(-5);
const ST_CODE = `DGS${STAMP}`;
const TM_CODE = `DGT${STAMP}`;

async function main() {
  const browser = await launch();
  const { page } = await newPage(browser);
  if (!(await login(page, "owner"))) process.exit(1);

  // ---------- (a1) create a station ----------
  await probe(page, "/app/stations", { who: "owner", wait: 6000 });
  await page.locator('button:has-text("Add station")').first().click();
  await page.waitForTimeout(1500);
  await page.locator('[role="dialog"] input#code, [role="dialog"] input[name="code"]').first().fill(ST_CODE);
  await page.locator('[role="dialog"] input#name, [role="dialog"] input[name="name"]').first().fill(`Diag Dessert ${STAMP}`);
  const stype = page.locator('[role="dialog"] select');
  if (await stype.count()) {
    const opts = await stype.first().evaluate((s) => [...s.options].map((o) => o.value));
    const dessert = opts.find((o) => /DESSERT/i.test(o)) ?? opts[0];
    await stype.first().selectOption(dessert);
    console.log(`  station type set to ${dessert}`);
  }
  await page.locator('[role="dialog"] button:has-text("Add station")').last().click();
  await page.waitForTimeout(4500);
  await shot(page, "skpx-n1-station-created");

  // reload and confirm it survived
  await probe(page, "/app/stations", { who: "owner", wait: 6000 });
  const stationPersisted = (await page.locator("body").innerText()).includes(ST_CODE);
  console.log(`  >>> station ${ST_CODE} present AFTER RELOAD: ${stationPersisted}`);

  // ---------- (a2) create a menu-scoped terminal that fires only to that station ----------
  await probe(page, "/app/terminals", { who: "owner", wait: 6000 });
  await page.locator('button:has-text("Add terminal")').first().click();
  await page.waitForTimeout(1800);
  await page.locator('[role="dialog"] input#terminal-code, [role="dialog"] input[name="terminal-code"]').first().fill(TM_CODE);
  await page.locator('[role="dialog"] input#terminal-name, [role="dialog"] input[name="terminal-name"]').first().fill(`Diag Bar Till ${STAMP}`);
  // tick only the Drinks category, and only the new station
  const drinks = page.locator('[role="dialog"] label').filter({ hasText: /^Drinks$/ }).first();
  if (await drinks.count()) { await drinks.click(); console.log("  ticked category Drinks"); }
  const stat = page.locator('[role="dialog"] label').filter({ hasText: `Diag Dessert ${STAMP}` }).first();
  if (await stat.count()) { await stat.click(); console.log(`  ticked station Diag Dessert ${STAMP}`); }
  await shot(page, "skpx-n2-terminal-dialog");
  await page.locator('[role="dialog"] button:has-text("Add terminal")').last().click();
  await page.waitForTimeout(5000);
  await shot(page, "skpx-n3-terminal-created");

  await probe(page, "/app/terminals", { who: "owner", wait: 6500 });
  const body = await page.locator("body").innerText();
  const terminalPersisted = body.includes(TM_CODE);
  const row = body.split("\n").find((l) => l.includes(TM_CODE)) ?? body.match(new RegExp(`${TM_CODE}[^\\n]*`))?.[0];
  console.log(`  >>> terminal ${TM_CODE} present AFTER RELOAD: ${terminalPersisted}`);
  console.log(`  >>> its row reads: ${JSON.stringify(body.replace(/\s+/g, " ").match(new RegExp(`${TM_CODE}.{0,120}`))?.[0])}`);
  await shot(page, "skpx-n4-terminals-after-reload");

  // ---------- (b) can a till be bound to it, by ANY means? ----------
  console.log(`\n=== can the POS be bound to terminal ${TM_CODE}? ===`);
  const attempts = [
    `/app/pos?terminal=${TM_CODE}`,
    `/app/pos?terminalCode=${TM_CODE}`,
    `/app/pos/${TM_CODE}`,
    `/app/pos?till=${TM_CODE}`,
  ];
  for (const route of attempts) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5500);
    const r = await page.evaluate(() => ({
      url: location.pathname + location.search,
      cats: [...document.querySelectorAll("button")].map((b) => b.innerText.trim()).filter((t) => t && t.length < 24 && !/Rs/.test(t)),
      is404: /This page doesn.t exist/i.test(document.body.innerText),
      picker: !!document.querySelector('[data-testid="terminal-picker"]'),
      ls: Object.keys(localStorage),
    }));
    const catLine = r.cats.filter((c) => /^(All|Starters|Mains|Drinks|Soft Drinks|Diag Cat.*)$/.test(c));
    console.log(`  ${route}\n     -> ${r.url} 404=${r.is404} picker=${r.picker} localStorage=${JSON.stringify(r.ls)}\n     -> category filters: ${JSON.stringify(catLine)}`);
  }

  // seed localStorage the way a "remembered device" would, then reload
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.evaluate((c) => {
    localStorage.setItem("terminalCode", c);
    localStorage.setItem("activeTerminal", c);
    localStorage.setItem("pos.terminal", c);
  }, TM_CODE);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const seeded = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.innerText.trim())
    .filter((c) => /^(All|Starters|Mains|Drinks|Soft Drinks|Diag Cat.*)$/.test(c)));
  console.log(`  after seeding localStorage with the terminal code, category filters: ${JSON.stringify(seeded)}`);
  await shot(page, "skpx-n5-pos-after-seed");

  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
