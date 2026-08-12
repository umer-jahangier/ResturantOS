/*
 * S1-08 REPRODUCTION — does deactivating a menu item reach an already-open till?
 *
 * Context A: manager@terrace.local on /app/menu/items.
 * Context B: cashier@terrace.local on /app/pos, terminal tab, till open.
 * A deactivates the target item. B is polled at +2/+5/+10/+20s and NEVER touched.
 * Then B is manually reloaded to prove the change did land server-side.
 * Finally A reactivates so the tenant is left exactly as found.
 */
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import {
  BASE,
  MANAGER,
  CASHIER,
  TARGET_ITEM,
  outDir,
  shot,
  login,
  ensureTillOpen,
  probeTill,
  fmt,
  toggleItem,
  watch,
} from "./s1-08-lib.mjs";

const DIR = outDir(process.env.S1_PHASE ?? "before");
const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};

const browser = await chromium.launch({ headless: true });

const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const A = await ctxA.newPage();
const B = await ctxB.newPage();

const wsFrames = [];
B.on("websocket", (ws) => {
  say(`  [B] websocket opened: ${ws.url().split("?")[0]}`);
  ws.on("framereceived", (f) => {
    const s = typeof f.payload === "string" ? f.payload : "(binary)";
    wsFrames.push(s);
    say(`  [B] WS frame ${s.slice(0, 160)}`);
  });
});

try {
  say("== A: manager login → /app/menu/items ==");
  await login(A, MANAGER);
  await A.goto(`${BASE}/app/menu/items`, { waitUntil: "domcontentloaded" });
  await A.waitForTimeout(3000);
  await shot(A, DIR, "01-A-menu-items");
  const hasRow = await A.locator(`button[aria-label="Actions for ${TARGET_ITEM}"]`).count();
  say(`  A: action menu for "${TARGET_ITEM}" present = ${hasRow > 0}`);
  if (!hasRow) {
    const names = await A.evaluate(() =>
      Array.from(document.querySelectorAll('button[aria-label^="Actions for "]')).map((b) =>
        b.getAttribute("aria-label"),
      ),
    );
    say(`  A: rows visible = ${JSON.stringify(names)}`);
    throw new Error(`no row for ${TARGET_ITEM}`);
  }

  say("== B: cashier login → /app/pos ==");
  await login(B, CASHIER);
  await B.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await B.waitForTimeout(3500);
  const till = await ensureTillOpen(B);
  say(`  B: till = ${till}`);
  await B.waitForTimeout(2500);

  const baseline = await probeTill(B, TARGET_ITEM);
  say(`  B baseline: ${fmt(baseline)}`);
  await shot(B, DIR, "02-B-baseline");
  if (!baseline.target) {
    say(`  B: labels = ${JSON.stringify(baseline.labels)}`);
    throw new Error(`"${TARGET_ITEM}" is not on the cashier grid to begin with`);
  }

  say(`== A: toggle "${TARGET_ITEM}" ==`);
  const act1 = await toggleItem(A, TARGET_ITEM);
  say(`  A clicked: ${act1}`);
  await shot(A, DIR, "03-A-after-deactivate");

  say("== B: watched WITHOUT any reload or click ==");
  const observed = await watch(B, TARGET_ITEM, DIR, "04-B-after-deactivate");

  const stillThere = observed[observed.length - 1].target;
  say(
    stillThere
      ? `  RESULT: after 20s the tile is STILL TAPPABLE on the open till → gap reproduced`
      : `  RESULT: the tile went away without a reload → live propagation works`,
  );

  say("== B: manual reload (control — proves the server did change) ==");
  await B.reload({ waitUntil: "domcontentloaded" });
  await B.waitForTimeout(4500);
  const afterReload = await probeTill(B, TARGET_ITEM);
  say(`  B after reload: ${fmt(afterReload)}`);
  await shot(B, DIR, "05-B-after-manual-reload");

  say(`== A: restore "${TARGET_ITEM}" ==`);
  // The list hides inactive rows by default — tick "Show inactive" to find it again.
  const showInactive = A.locator('input[type="checkbox"]').first();
  if (await showInactive.count()) await showInactive.check();
  await A.waitForTimeout(1200);
  const act2 = await toggleItem(A, TARGET_ITEM);
  say(`  A clicked: ${act2}`);
  await shot(A, DIR, "06-A-after-reactivate");

  say("== B: watched again WITHOUT reload (does it come back?) ==");
  const observed2 = await watch(B, TARGET_ITEM, DIR, "07-B-after-reactivate");
  const cameBack = !!observed2[observed2.length - 1].target;
  say(
    cameBack
      ? "  RESULT: reactivation reached the open till live"
      : "  RESULT: reactivation did NOT reach the open till",
  );

  say(`== WS frames seen on B: ${wsFrames.length} ==`);

  writeFileSync(
    `${DIR}/RESULT.json`,
    JSON.stringify(
      {
        item: TARGET_ITEM,
        baseline: { n: baseline.n, target: !!baseline.target },
        deactivate: { clicked: act1, observed: observed.map((o) => ({ t: o.t, present: !!o.target, n: o.n })) },
        afterManualReload: { n: afterReload.n, target: !!afterReload.target },
        reactivate: { clicked: act2, observed: observed2.map((o) => ({ t: o.t, present: !!o.target, n: o.n })) },
        wsFrameCount: wsFrames.length,
        wsFrameSamples: wsFrames.slice(0, 5).map((f) => f.slice(0, 200)),
      },
      null,
      2,
    ),
  );
} catch (e) {
  say(`FATAL: ${e.message}`);
  await shot(A, DIR, "zz-A-fatal");
  await shot(B, DIR, "zz-B-fatal");
} finally {
  writeFileSync(`${DIR}/RUN-LOG.txt`, log.join("\n"));
  await browser.close();
}
