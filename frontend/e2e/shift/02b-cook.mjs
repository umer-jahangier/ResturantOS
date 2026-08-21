/*
 * SHIFT STEP 2b — the cook.
 *
 * Where did the three dishes of ORD-…-0164 go? Then bump the ticket the whole way,
 * NEW -> STARTED -> PREPARING -> READY, using the buttons on the cook's own board.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, finding, apiGet, log } from "./lib.mjs";

const st = loadState();
const NO = st.order1No;
log("  hunting", NO);

const browser = await newBrowser();
const kds = await newPage(browser);
await login(kds, PEOPLE.kitchen);

// Which boards exist, and which one holds my ticket?
await go(kds, "/app/kitchen", { waitMs: 5000 });
const codes = await kds.evaluate(() =>
  Array.from(document.querySelectorAll('[data-testid^="station-tile-"]')).map((n) => ({
    code: n.getAttribute("data-testid").replace("station-tile-", ""),
    text: n.innerText.replace(/\s+/g, " ").trim().slice(0, 110),
  })),
);
log("  stations:", JSON.stringify(codes, null, 1));
saveState({ stationCodes: codes });

const where = {};
for (const s of codes) {
  await go(kds, `/app/kitchen/${s.code}`, { waitMs: 5500 });
  const hit = await kds.evaluate((wanted) => {
    const t = document.body.innerText;
    const idx = t.indexOf(wanted);
    return {
      present: idx >= 0,
      count: (t.match(new RegExp(wanted.replace(/-/g, "\\-"), "g")) || []).length,
      snippet: idx >= 0 ? t.slice(idx, idx + 220).replace(/\s+/g, " ") : null,
      boardCount: document.querySelector("[data-testid=kds-ticket-count]")?.textContent?.trim() ?? null,
      pages: document.querySelector("[data-testid=kds-page-indicator]")?.textContent?.trim() ?? null,
    };
  }, NO);
  where[s.code] = hit;
  log(`  ${s.code}: ${JSON.stringify(hit)}`);
}
saveState({ order1BoardScan: where });
await shot(kds, "02g-board-scan-last");

// The order as the server holds it — items and where each was routed.
const detail = await apiGet(kds, `/api/v1/pos/orders`);
log("  cook's view of /pos/orders:", JSON.stringify(detail).slice(0, 300));

// ── bump my ticket all the way through, on the board that has it ──────────────
const holder = Object.entries(where).find(([, v]) => v.present)?.[0];
log("\n  ticket lives on:", holder);
if (holder) {
  await go(kds, `/app/kitchen/${holder}`, { waitMs: 6000 });
  const states = [];
  for (let step = 0; step < 4; step++) {
    const snap = await kds.evaluate((wanted) => {
      const frag = Array.from(document.querySelectorAll("[data-fragment-key]")).find((n) =>
        (n.innerText || "").includes(wanted),
      );
      if (!frag) return { found: false };
      const btns = Array.from(frag.querySelectorAll("[data-testid^=column-move-]")).map((b) => ({
        id: b.getAttribute("data-testid"),
        label: b.textContent.trim(),
      }));
      return {
        found: true,
        column: frag.getAttribute("data-fragment-key")?.split(":")[0] ?? null,
        card: frag.innerText.replace(/\s+/g, " ").trim().slice(0, 200),
        buttons: btns,
      };
    }, NO);
    states.push(snap);
    log(`   step ${step}:`, JSON.stringify(snap));
    if (!snap.found || !snap.buttons?.length) break;
    await shot(kds, `02h-bump-${step}`);
    for (const b of snap.buttons) {
      const el = kds.locator(`[data-testid="${b.id}"]`);
      if (await el.count()) {
        await el.first().click();
        await kds.waitForTimeout(1400);
      }
    }
    await kds.waitForTimeout(2500);
  }
  saveState({ bumpStates: states });
  await shot(kds, "02i-after-bumps");

  const finalLook = await kds.evaluate((wanted) => {
    const frag = Array.from(document.querySelectorAll("[data-fragment-key]")).find((n) =>
      (n.innerText || "").includes(wanted),
    );
    const cols = {};
    for (const c of ["NEW", "STARTED", "PREPARING", "READY"]) {
      const el = document.querySelector(`[data-testid=kds-column-count-${c}]`);
      if (el) cols[c] = el.textContent.trim();
    }
    return {
      fragmentKey: frag?.getAttribute("data-fragment-key") ?? null,
      readyToggle: document.querySelector("[data-testid=kds-toggle-ready]")?.textContent?.trim() ?? null,
      cols,
      bumpError: document.querySelector("[data-testid=kds-bump-error]")?.textContent?.trim() ?? null,
    };
  }, NO);
  log("  final:", JSON.stringify(finalLook, null, 1));
  saveState({ bumpFinal: finalLook });
}

await browser.close();
log("\nstep 2b done");
