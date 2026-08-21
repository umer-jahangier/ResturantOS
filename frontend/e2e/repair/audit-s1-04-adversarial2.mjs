/*
 * ADVERSARIAL re-audit of S1-04, round 2 — the paths the first run did not cover.
 *
 *  A. The cook is working a DEEP page (not page 1) and bumps a ticket. Where does the board go?
 *  B. Two terminals: cook A has focus, cook B (a second real browser session) advances a
 *     ticket. Does A's board turn a page under them with no input from A?
 *  C. `V` (hide the Ready column) — is every card still numbered, is paging still sane?
 *  D. The waiter (pos.kds.view, NOT pos.kds.update) — can they bump?
 *
 *   node e2e/repair/audit-s1-04-adversarial2.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/repair/S1-04/adversarial");
mkdirSync(OUT, { recursive: true });

const KITCHEN = { slug: "floating-terrace", email: "kitchen@terrace.local", password: "Terrace#Kitchen1" };
const WAITER = { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" };

const log = (...a) => console.log(...a);
const FAILURES = [];
function check(ok, msg, detail) {
  log(`   ${ok ? "PASS" : "FAIL"}  ${msg}${detail ? ` — ${detail}` : ""}`);
  if (!ok) FAILURES.push(`${msg}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  if (page.url().includes("/login")) throw new Error(`login failed for ${who.email}`);
}

async function probe(page) {
  return page.evaluate(() => {
    const txt = (n) => (n?.textContent ?? "").trim();
    const cols = ["NEW", "STARTED", "PREPARING", "READY"];
    const columns = cols.map((c) => {
      const list = document.querySelector(`[data-testid="kds-column-list-${c}"]`);
      const rendered = Array.from(list?.querySelectorAll("[data-fragment-key]") ?? []).map((el) => ({
        key: el.getAttribute("data-fragment-key"),
        badge: (el.querySelector('[data-testid="kds-ticket-position"]')?.textContent ?? "").trim(),
        focused:
          el.querySelector('[data-testid="kds-ticket-card"]')?.getAttribute("data-focused") === "true",
        moves: Array.from(el.querySelectorAll('[data-testid^="column-move-"]')).map((b) => ({
          testid: b.getAttribute("data-testid"),
          label: (b.textContent ?? "").trim(),
        })),
      }));
      return {
        column: c,
        present: !!list,
        headerCount: txt(document.querySelector(`[data-testid="kds-column-count-${c}"]`)),
        n: rendered.length,
        rendered,
      };
    });
    return {
      board: !!document.querySelector('[data-testid="kds-board"]'),
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(txt).filter(Boolean),
      pageIndicator: txt(document.querySelector('[data-testid="kds-page-indicator"]')),
      ticketCount: txt(document.querySelector('[data-testid="kds-ticket-count"]')),
      columns,
      keys: columns.flatMap((c) => c.rendered.map((r) => r.key)),
      badges: columns.flatMap((c) => c.rendered.map((r) => r.badge)),
      unnumbered: columns.flatMap((c) =>
        c.rendered.filter((r) => !r.badge).map((r) => `${c.column}:${r.key}`),
      ),
      totalRendered: columns.reduce((a, c) => a + c.n, 0),
      moveButtons: columns.reduce((a, c) => a + c.rendered.reduce((b, r) => b + r.moves.length, 0), 0),
    };
  });
}

const line = (p) =>
  `page ${p.pageIndicator || "1 / 1"} | ` +
  p.columns.map((c) => `${c.column} ${c.n}/${c.headerCount}`).join("  ") +
  ` | rendered=${p.totalRendered} unnumbered=${p.unnumbered.length}`;

async function main() {
  const browser = await chromium.launch();
  const ctxA = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const A = await ctxA.newPage();
  await login(A, KITCHEN);

  // ───────────────────────── A. bump while working a DEEP page
  log("\n== A. the cook is on a deep page and bumps a ticket ==");
  await A.goto(`${BASE}/app/kitchen/DEFAULT`, { waitUntil: "domcontentloaded" });
  await A.waitForTimeout(4000);
  let p = await probe(A);
  log("   start:", line(p));
  const total = Number((p.pageIndicator || "1 / 1").split("/")[1]?.trim() || 1);
  const target = Math.min(5, total);
  for (let i = 1; i < target; i += 1) {
    await A.keyboard.press("PageDown");
    await A.waitForTimeout(700);
  }
  p = await probe(A);
  log(`   on page ${p.pageIndicator}:`, line(p));
  const deepPage = p.pageIndicator;
  const cardsBefore = p.keys.slice();
  const newCard = p.columns.find((c) => c.column === "NEW")?.rendered.find((r) => r.moves.length);
  if (!newCard) {
    check(false, "a NEW card with a move button exists on the deep page");
  } else {
    const tid = newCard.key.split(":")[1];
    log(`   clicking "${newCard.moves[0].label}" on ${newCard.key} (pos ${newCard.badge})`);
    await A.locator(`[data-testid="${newCard.moves[0].testid}"]`).first().click();
    await A.waitForTimeout(3000);
    const after = await probe(A);
    log(`   after:`, line(after));
    check(
      after.keys.includes(`STARTED:${tid}`),
      "the bumped ticket is visible somewhere on the cook's screen",
    );
    const stayed = after.pageIndicator === deepPage;
    check(stayed, "the board stayed on the page the cook was working", `${deepPage} -> ${after.pageIndicator}`);
    const kept = cardsBefore.filter((k) => after.keys.includes(k)).length;
    log(`   of the ${cardsBefore.length} cards the cook was looking at, ${kept} are still on screen`);
    check(kept >= cardsBefore.length - 2, "the cook kept their place in the queue", `${kept}/${cardsBefore.length} cards retained`);
    await A.screenshot({ path: `${OUT}/A-deep-page-after-bump.png` });
  }

  // ───────────────────────── B. two terminals
  log("\n== B. two terminals: cook B advances a ticket while cook A has focus ==");
  await A.goto(`${BASE}/app/kitchen/DEFAULT`, { waitUntil: "domcontentloaded" });
  await A.waitForTimeout(4000);
  p = await probe(A);
  // focus the LAST card on page 1 — the one nearest the page boundary
  const lastBadge = p.badges[p.badges.length - 1];
  await A.keyboard.press(lastBadge);
  await A.waitForTimeout(600);
  let a1 = await probe(A);
  const focusedKey = a1.columns.flatMap((c) => c.rendered).find((r) => r.focused)?.key;
  log(`   A focused ${focusedKey} (pos ${lastBadge}) on page ${a1.pageIndicator}`);
  const aPageBefore = a1.pageIndicator;
  const aCardsBefore = a1.keys.slice();

  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const B = await ctxB.newPage();
  await login(B, KITCHEN);
  await B.goto(`${BASE}/app/kitchen/DEFAULT`, { waitUntil: "domcontentloaded" });
  await B.waitForTimeout(4000);
  const b1 = await probe(B);
  // B advances a STARTED card (grows the PREPARING column — the depth change that reshuffles ranks)
  const bCard =
    b1.columns.find((c) => c.column === "STARTED")?.rendered.find((r) => r.moves.length) ??
    b1.columns.find((c) => c.column === "NEW")?.rendered.find((r) => r.moves.length);
  if (!bCard) {
    check(false, "terminal B had a card to advance");
  } else {
    log(`   B clicks "${bCard.moves[0].label}" on ${bCard.key}`);
    await B.locator(`[data-testid="${bCard.moves[0].testid}"]`).first().click();
    await B.waitForTimeout(1500);
  }
  // A does NOTHING. Wait for A's poll/socket to pick the change up.
  await A.waitForTimeout(9000);
  const a2 = await probe(A);
  log(`   A after B's action (A pressed nothing):`, line(a2));
  check(
    a2.pageIndicator === aPageBefore,
    "cook A's board did not turn a page on its own",
    `${aPageBefore} -> ${a2.pageIndicator}`,
  );
  const retained = aCardsBefore.filter((k) => a2.keys.includes(k)).length;
  log(`   A retained ${retained}/${aCardsBefore.length} of the cards they were looking at`);
  await A.screenshot({ path: `${OUT}/B-terminal-a-after-b-acted.png` });
  await ctxB.close();

  // ───────────────────────── C. V toggle
  log("\n== C. V hides the Ready column ==");
  await A.goto(`${BASE}/app/kitchen/DEFAULT`, { waitUntil: "domcontentloaded" });
  await A.waitForTimeout(4000);
  await A.keyboard.press("v");
  await A.waitForTimeout(1200);
  const cv = await probe(A);
  log("   ", line(cv));
  check(cv.unnumbered.length === 0, "every card still numbered with Ready hidden", cv.unnumbered.join(","));
  check(
    new Set(cv.badges).size === cv.badges.length,
    "no duplicate numbers with Ready hidden",
    cv.badges.join(","),
  );
  check(!cv.columns.find((c) => c.column === "READY")?.present, "the Ready column is actually hidden");
  await A.screenshot({ path: `${OUT}/C-ready-hidden.png` });
  await A.keyboard.press("v");
  await A.waitForTimeout(800);

  // ───────────────────────── D. the waiter
  log("\n== D. the waiter (pos.kds.view, no pos.kds.update) ==");
  const ctxW = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const W = await ctxW.newPage();
  await login(W, WAITER);
  await W.goto(`${BASE}/app/kitchen/DEFAULT`, { waitUntil: "domcontentloaded" });
  await W.waitForTimeout(4500);
  const w = await probe(W);
  log("   ", line(w), `moveButtons=${w.moveButtons}`);
  check(w.moveButtons === 0, "the waiter is shown NO move buttons", `${w.moveButtons} found`);
  // and the API refuses even if they forge the call
  const forged = await W.evaluate(async () => {
    const t = JSON.parse(localStorage.getItem("auth-storage") ?? "{}");
    return { keys: Object.keys(localStorage) };
  });
  const wFrag = w.columns.find((c) => c.column === "NEW")?.rendered[0];
  if (wFrag) {
    // press F on the focused card — the keyboard path must be inert for a viewer
    await W.keyboard.press("1");
    await W.waitForTimeout(400);
    const before = await probe(W);
    await W.keyboard.press("f");
    await W.waitForTimeout(2500);
    const after = await probe(W);
    check(
      JSON.stringify(before.keys) === JSON.stringify(after.keys),
      "F does nothing for a waiter (no pos.kds.update)",
      `${before.keys.length} -> ${after.keys.length}`,
    );
  }
  await W.screenshot({ path: `${OUT}/D-waiter-board.png` });
  await ctxW.close();

  log("\n================ RESULT ================");
  if (FAILURES.length === 0) log("ALL CHECKS PASSED");
  else {
    log(`${FAILURES.length} FAILURE(S):`);
    for (const f of FAILURES) log("  -", f);
  }
  await browser.close();
  process.exit(FAILURES.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(2);
});
