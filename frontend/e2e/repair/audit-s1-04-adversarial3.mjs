/*
 * ADVERSARIAL re-audit of S1-04, round 3 — pin down the regression found in round 2.
 *
 * Claim under test: because `safePage` is DERIVED from the focused fragment's index in the
 * board-wide interleaved list, ANY change to another column's depth — made by another
 * terminal, or by the POS — moves the focused fragment's index and silently turns the page
 * under a cook who pressed nothing. The jump keys then point at different tickets.
 *
 *   node e2e/repair/audit-s1-04-adversarial3.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/repair/S1-04/adversarial");
mkdirSync(OUT, { recursive: true });
const KITCHEN = { slug: "floating-terrace", email: "kitchen@terrace.local", password: "Terrace#Kitchen1" };
const log = (...a) => console.log(...a);

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5500);
  if (page.url().includes("/login")) throw new Error(`login failed for ${who.email}`);
}

async function probe(page) {
  return page.evaluate(() => {
    const txt = (n) => (n?.textContent ?? "").trim();
    const cols = ["NEW", "STARTED", "PREPARING", "READY"];
    const map = {};
    const columns = cols.map((c) => {
      const list = document.querySelector(`[data-testid="kds-column-list-${c}"]`);
      const rendered = Array.from(list?.querySelectorAll("[data-fragment-key]") ?? []).map((el) => {
        const badge = (el.querySelector('[data-testid="kds-ticket-position"]')?.textContent ?? "").trim();
        const key = el.getAttribute("data-fragment-key");
        if (badge) map[badge] = key;
        return {
          key,
          badge,
          focused:
            el.querySelector('[data-testid="kds-ticket-card"]')?.getAttribute("data-focused") === "true",
          moves: Array.from(el.querySelectorAll('[data-testid^="column-move-"]')).map((b) => ({
            testid: b.getAttribute("data-testid"),
            label: (b.textContent ?? "").trim(),
          })),
        };
      });
      return { column: c, n: rendered.length, headerCount: txt(document.querySelector(`[data-testid="kds-column-count-${c}"]`)), rendered };
    });
    return {
      pageIndicator: txt(document.querySelector('[data-testid="kds-page-indicator"]')),
      columns,
      keyMap: map, // printed jump key -> the fragment it addresses
      keys: columns.flatMap((c) => c.rendered.map((r) => r.key)),
      focused: columns.flatMap((c) => c.rendered).find((r) => r.focused)?.key ?? null,
    };
  });
}

const line = (p) =>
  `page ${p.pageIndicator || "1 / 1"} | ` + p.columns.map((c) => `${c.column} ${c.n}/${c.headerCount}`).join("  ");

async function main() {
  const browser = await chromium.launch();
  const ctxA = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const A = await ctxA.newPage();
  await login(A, KITCHEN);
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const B = await ctxB.newPage();
  await login(B, KITCHEN);

  const results = [];
  for (let trial = 1; trial <= 3; trial += 1) {
    log(`\n──────── trial ${trial} ────────`);
    await A.goto(`${BASE}/app/kitchen/DEFAULT`, { waitUntil: "domcontentloaded" });
    await A.waitForTimeout(4500);
    let a1 = await probe(A);
    // The cook touches ONE key — the last card on the page — then keeps cooking.
    // The card at the PAGE BOUNDARY — jump key "0" is the tenth and last slot on the page.
    const last = a1.keyMap["0"] ? "0" : Object.keys(a1.keyMap).slice(-1)[0];
    await A.keyboard.press(last);
    await A.waitForTimeout(700);
    a1 = await probe(A);
    log(`  A: ${line(a1)}  focus=${a1.focused} (pressed "${last}")`);
    const before = { page: a1.pageIndicator, keys: a1.keys.slice(), keyMap: { ...a1.keyMap } };

    await B.goto(`${BASE}/app/kitchen/DEFAULT`, { waitUntil: "domcontentloaded" });
    await B.waitForTimeout(4500);
    const b1 = await probe(B);
    const bCard =
      b1.columns.find((c) => c.column === "STARTED")?.rendered.find((r) => r.moves.length) ??
      b1.columns.find((c) => c.column === "NEW")?.rendered.find((r) => r.moves.length);
    log(`  B: clicks "${bCard.moves[0].label}" on ${bCard.key}`);
    await B.locator(`[data-testid="${bCard.moves[0].testid}"]`).first().click();
    await B.waitForTimeout(2000);

    // A does nothing at all.
    await A.waitForTimeout(10000);
    const a2 = await probe(A);
    log(`  A (pressed nothing): ${line(a2)}`);
    const turned = a2.pageIndicator !== before.page;
    const retained = before.keys.filter((k) => a2.keys.includes(k)).length;
    const repointed = Object.keys(before.keyMap).filter(
      (k) => a2.keyMap[k] && a2.keyMap[k] !== before.keyMap[k],
    );
    log(`  page ${before.page} -> ${a2.pageIndicator}   turned=${turned}`);
    log(`  cards retained: ${retained}/${before.keys.length}`);
    log(`  jump keys now addressing a DIFFERENT ticket: ${repointed.length} of ${Object.keys(before.keyMap).length} — ${repointed.join(",")}`);
    for (const k of repointed.slice(0, 3))
      log(`     key "${k}": ${before.keyMap[k]}  ->  ${a2.keyMap[k]}`);
    results.push({ trial, turned, retained, total: before.keys.length, repointed: repointed.length });
    if (trial === 1) await A.screenshot({ path: `${OUT}/E-spontaneous-turn.png` });
  }

  log("\n================ SUMMARY ================");
  for (const r of results)
    log(
      `  trial ${r.trial}: page turned by itself = ${r.turned}; cards retained ${r.retained}/${r.total}; jump keys re-pointed ${r.repointed}`,
    );
  const turns = results.filter((r) => r.turned).length;
  log(`\n  ${turns} of ${results.length} trials: the board turned a page with NO input from the cook.`);
  await browser.close();
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(2);
});
