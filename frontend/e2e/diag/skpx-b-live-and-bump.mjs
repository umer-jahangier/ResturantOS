/*
 * PROBE B — the two claims that most need re-driving:
 *   (1) "a ticket fired at the POS appears on the KDS live, no reload"  [claimed WORKS]
 *   (2) bump / recall  — the other agent explicitly could NOT complete this and reported it
 *       from affordances alone. The board is keyboard-driven (1-9 selects, F bumps, R recalls),
 *       NOT click-to-select; clicking a card navigates to a detail route. So it IS drivable.
 * Also records whether the drink and the food split into two tickets.
 */
import { launch, newPage, login, probe, shot, api, BASE, BRANCH } from "./skpx-lib.mjs";

const PERSONA = process.argv[2] ?? "manager";
const STATION = process.argv[3] ?? "DEFAULT";

async function readBoard(page, tag) {
  const r = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-testid="kds-ticket-card"]')];
    const conn = document.querySelector('[data-testid="kds-connection"]');
    const count = document.querySelector('[data-testid="kds-ticket-count"]');
    const cols = [...document.querySelectorAll("h2,h3")].map((h) => h.innerText.trim());
    return {
      cardCount: cards.length,
      countLabel: count?.innerText.trim() ?? null,
      connection: conn?.innerText.trim() ?? null,
      cols,
      cards: cards.map((c) => c.innerText.replace(/\s+/g, " ").slice(0, 180)),
      alerts: [...document.querySelectorAll('[role="alert"]')].map((a) => a.innerText.trim().slice(0, 200)),
      bodyHasEmpty: /No active stations configured|No tickets/i.test(document.body.innerText),
    };
  });
  console.log(`  [board ${tag}] cards=${r.cardCount} count="${r.countLabel}" conn="${r.connection}" alerts=${JSON.stringify(r.alerts)}`);
  r.cards.forEach((c, i) => console.log(`      #${i + 1} ${c}`));
  return r;
}

async function main() {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const kds = await ctx.newPage();
  kds.on("pageerror", (e) => console.log("    ! kds pageerror:", String(e).slice(0, 140)));

  if (!(await login(kds, PERSONA))) process.exit(1);

  // ---- KDS board open FIRST, so any change is genuinely live ----
  const b0 = await probe(kds, `/app/kitchen/${STATION}`, { who: PERSONA, wait: 6000 });
  console.log(`\n=== KDS /app/kitchen/${STATION} heads=${JSON.stringify(b0.heads)} denied=${b0.denied} 404=${b0.is404}`);
  const before = await readBoard(kds, "BEFORE");
  await shot(kds, "skpx-b1-board-before");

  // ---- POS in a SECOND TAB of the SAME session ----
  const pos = await ctx.newPage();
  pos.on("pageerror", (e) => console.log("    ! pos pageerror:", String(e).slice(0, 140)));
  await pos.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await pos.waitForTimeout(6000);

  // Terminal binding hunt, on the real till, before we ring anything.
  const bind = await pos.evaluate(() => ({
    testids: [...document.querySelectorAll("[data-testid]")].map((n) => n.getAttribute("data-testid")),
    localStorage: Object.keys(localStorage),
    sessionStorage: Object.keys(sessionStorage),
    lsDump: Object.fromEntries(Object.entries(localStorage).map(([k, v]) => [k, String(v).slice(0, 120)])),
    filterButtons: [...document.querySelectorAll("button")].map((b) => b.innerText.trim()).filter(Boolean),
    mentionsTerminalProfile: /terminal/i.test(document.body.innerText),
  }));
  console.log("\n=== POS TILL, terminal-binding hunt ===");
  console.log("  testids:", JSON.stringify([...new Set(bind.testids)]));
  console.log("  localStorage keys:", JSON.stringify(bind.localStorage));
  console.log("  localStorage dump:", JSON.stringify(bind.lsDump));
  console.log("  sessionStorage keys:", JSON.stringify(bind.sessionStorage));
  console.log("  buttons:", JSON.stringify(bind.filterButtons));
  await shot(pos, "skpx-b2-pos-till");

  // ---- ring a FOOD item and a DRINK item, then fire ----
  async function ring(name) {
    const tile = pos.locator(`[data-testid="menu-grid"] button:has-text("${name}")`).first();
    if (!(await tile.count())) { console.log(`  !! could not find tile "${name}"`); return false; }
    await tile.click();
    await pos.waitForTimeout(900);
    console.log(`  rang "${name}"`);
    return true;
  }
  await ring("Mutton Biryani");
  await ring("Pinacolada");
  await shot(pos, "skpx-b3-cart");

  const send = pos.locator('[data-testid="send-to-kitchen-button"]').first();
  console.log("  send-to-kitchen present:", await send.count(), "enabled:", (await send.count()) ? await send.isEnabled() : "n/a");
  if (await send.count()) {
    await send.click();
    await pos.waitForTimeout(5000);
    console.log("  POS after fire:", (await pos.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 300));
  }
  await shot(pos, "skpx-b4-after-fire");

  // ---- WITHOUT reloading the KDS tab: did it update live? ----
  await kds.waitForTimeout(6000);
  const afterLive = await readBoard(kds, "AFTER-FIRE-NO-RELOAD");
  await shot(kds, "skpx-b5-board-live");
  console.log(`\n>>> LIVE UPDATE: before=${before.cardCount} afterNoReload=${afterLive.cardCount} delta=${afterLive.cardCount - before.cardCount} conn=${afterLive.connection}`);

  // ---- did it SPLIT? check the BAR board too ----
  const bar = await ctx.newPage();
  await bar.goto(`${BASE}/app/kitchen/BAR`, { waitUntil: "domcontentloaded" });
  await bar.waitForTimeout(6000);
  const barBoard = await readBoard(bar, "BAR");
  console.log(`>>> BAR board contains "Pinacolada": ${barBoard.cards.some((c) => /Pinacolada/i.test(c))}`);
  await shot(bar, "skpx-b6-bar-board");
  await bar.close();

  // ---- BUMP: select with the number key, then F. This is the interaction the board defines. ----
  console.log("\n=== BUMP / RECALL (keyboard: 1 selects, F bumps, R recalls) ===");
  await kds.bringToFront();
  await kds.locator('[data-testid="kds-board"]').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
  await kds.waitForTimeout(500);
  await kds.keyboard.press("1");
  await kds.waitForTimeout(800);
  const focus1 = await kds.evaluate(() => {
    const f = document.querySelector('[data-testid="kds-ticket-card"][data-focused="true"], [data-testid="kds-ticket-card"].ring, [aria-selected="true"]');
    return { found: !!f, text: f?.innerText.replace(/\s+/g, " ").slice(0, 120) ?? null };
  });
  console.log("  after pressing '1', a card looks focused:", JSON.stringify(focus1));
  await shot(kds, "skpx-b7-focused");

  const preBump = await readBoard(kds, "PRE-BUMP");
  await kds.keyboard.press("f");
  await kds.waitForTimeout(4000);
  const postBump = await readBoard(kds, "POST-BUMP");
  await shot(kds, "skpx-b8-post-bump");
  console.log(`>>> BUMP changed the board: cards ${preBump.cardCount} -> ${postBump.cardCount}`);
  const bumpErr = await kds.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/Couldn.t bump[^\n]*|Can.t recall[^\n]*|Nothing to recall[^\n]*/i);
    return m ? m[0] : null;
  });
  console.log("  bump error text on screen:", JSON.stringify(bumpErr));

  // ---- RECALL within the 60s window ----
  await kds.keyboard.press("r");
  await kds.waitForTimeout(4000);
  const postRecall = await readBoard(kds, "POST-RECALL");
  await shot(kds, "skpx-b9-post-recall");
  const recallErr = await kds.evaluate(() => {
    const m = document.body.innerText.match(/Can.t recall[^\n]*|Nothing to recall[^\n]*/i);
    return m ? m[0] : null;
  });
  console.log("  recall error text on screen:", JSON.stringify(recallErr));
  console.log(`>>> RECALL changed the board: ${postBump.cardCount} -> ${postRecall.cardCount}`);

  // ---- PERSISTENCE: bump again, then hard reload ----
  await kds.keyboard.press("1"); await kds.waitForTimeout(600);
  await kds.keyboard.press("f"); await kds.waitForTimeout(4000);
  const beforeReload = await readBoard(kds, "BUMPED-AGAIN");
  await kds.reload({ waitUntil: "domcontentloaded" });
  await kds.waitForTimeout(6500);
  const afterReload = await readBoard(kds, "AFTER-RELOAD");
  await shot(kds, "skpx-b10-after-reload");
  console.log(`>>> PERSISTED: bumped board ${beforeReload.cardCount} cards, after reload ${afterReload.cardCount} cards`);

  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
