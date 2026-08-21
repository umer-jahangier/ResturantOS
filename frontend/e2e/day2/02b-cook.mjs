/* DAY 2 — step 2b: the cook. Where did the check go, does the ticket carry the modifier,
 * and does NEW -> PREPARING -> READY stick? */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, finding, apiGet, log } from "./lib.mjs";

const S = loadState();
const NO = S.order1.no;
log("  hunting", NO);
const browser = await newBrowser();
const kds = await newPage(browser);
await login(kds, PEOPLE.kitchen);

let tr = await go(kds, "/app/kitchen", { waitMs: 6000 });
log("  /app/kitchen trouble:", JSON.stringify(tr.bad));
await shot(kds, "02h-station-picker");
const codes = await kds.evaluate(() =>
  Array.from(document.querySelectorAll('[data-testid^="station-tile-"]')).map((n) => ({
    code: n.getAttribute("data-testid").replace("station-tile-", ""),
    text: n.innerText.replace(/\s+/g, " ").trim().slice(0, 130),
  })),
);
log("  STATION PICKER:", JSON.stringify(codes, null, 1));

const where = {};
for (const s of codes) {
  await go(kds, `/app/kitchen/${s.code}`, { waitMs: 5000 });
  const hit = await kds.evaluate((wanted) => {
    const t = document.body.innerText;
    const idx = t.indexOf(wanted);
    return {
      present: idx >= 0,
      snippet: idx >= 0 ? t.slice(idx, idx + 260).replace(/\s+/g, " ") : null,
      header: document.querySelector("[data-testid=kds-ticket-count]")?.textContent?.trim() ?? null,
      columns: Array.from(document.querySelectorAll("[data-testid^=kds-column-]")).map((n) =>
        n.innerText.split("\n").slice(0, 2).join(" ").trim(),
      ),
    };
  }, NO);
  where[s.code] = hit;
  log(`  ${s.code}: present=${hit.present} header=${hit.header} :: ${(hit.snippet ?? "").slice(0, 170)}`);
}
saveState({ boardScan: where, stationPicker: codes });

const holders = Object.entries(where).filter(([, v]) => v.present).map(([k]) => k);
log("\n  ticket lives on:", JSON.stringify(holders));
if (!holders.length) finding({ id: "D2-KDS", sev: "blocker", what: `${NO} appears on no board` });

const holder = holders[0];
await go(kds, `/app/kitchen/${holder}`, { waitMs: 6000 });
await shot(kds, "02i-board-with-ticket");
const states = [];
for (let step = 0; step < 5; step++) {
  const snap = await kds.evaluate((wanted) => {
    const frag = Array.from(document.querySelectorAll("[data-fragment-key]")).find((n) => (n.innerText || "").includes(wanted));
    if (!frag) return { found: false };
    return {
      found: true,
      key: frag.getAttribute("data-fragment-key"),
      card: frag.innerText.replace(/\s+/g, " ").trim().slice(0, 300),
      buttons: Array.from(frag.querySelectorAll("[data-testid^=column-move-]")).map((b) => ({
        id: b.getAttribute("data-testid"), label: b.textContent.trim(),
      })),
    };
  }, NO);
  states.push(snap);
  log(`   step ${step}:`, JSON.stringify(snap).slice(0, 500));
  if (!snap.found || !snap.buttons?.length) break;
  await shot(kds, `02j-bump-${step}`);
  for (const b of snap.buttons) {
    const el = kds.locator(`[data-testid="${b.id}"]`);
    if (await el.count()) { await el.first().click(); await kds.waitForTimeout(1500); }
  }
  await kds.waitForTimeout(2500);
}
await shot(kds, "02k-after-bumps");
const finalBoard = await kds.evaluate(() => ({
  header: document.querySelector("[data-testid=kds-ticket-count]")?.textContent?.trim() ?? null,
  text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 700),
}));
log("  final board:", JSON.stringify(finalBoard).slice(0, 700));

// does an EXPO / pass view exist now, and does it show the whole check?
tr = await go(kds, "/app/kitchen/expo", { waitMs: 5500, allowTrouble: true });
const expo = await kds.evaluate((wanted) => {
  const t = document.body.innerText || "";
  const i = t.indexOf(wanted);
  return { bad: t.slice(0, 160).replace(/\s+/g, " "), mine: i >= 0 ? t.slice(i, i + 320).replace(/\s+/g, " ") : null };
}, NO);
log("  EXPO:", JSON.stringify(tr.bad), JSON.stringify(expo).slice(0, 700));
await shot(kds, "02l-expo");
saveState({ bumpStates: states, expo, finalBoard });
await browser.close();
