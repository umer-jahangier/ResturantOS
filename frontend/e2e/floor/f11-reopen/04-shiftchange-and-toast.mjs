/*
 * F11 RE-OPEN, part 3 — the two things part 2 could not score honestly, plus the shift
 * change the feature exists for.
 *
 *   E. what a CASHIER actually sees at /app/pos/tills, on a session that has not expired
 *      (part 2 scored this against an expired session and the screenshot was the login page)
 *   F. the manager's confirmation toast, polled instead of screenshotted after it fades
 *   G. SHIFT CHANGE — the cashier cashes their drawer up, and the duty manager counts a
 *      fresh float into the SAME cashier's drawer for the next shift
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  BASE,
  PEOPLE,
  newBrowser,
  newPage,
  login,
  go,
  shot,
  apiGet,
  tokenOf,
  OUT,
  ok,
  log,
} from "./lib.mjs";

const j = JSON.parse(readFileSync(`${OUT}/journal.json`, "utf8"));
const HIRE = j.hire;
const hireId = j.hireUserId;
const branchId = j.branchId;
const out = { ...j };
const checks = [];
const note = (k, v) => {
  out[k] = v;
  log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
};
const check = (...a) => {
  const r = ok(...a);
  checks.push(r);
  return r;
};

async function signIn(page, email, password, slug = "floating-terrace") {
  for (let i = 0; i < 3; i++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await s.count()) await s.first().fill(slug);
    await page.locator('input[name="email"], input#email').first().fill(email);
    await page.locator('input[name="password"], input#password').first().fill(password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(5500);
    if (!page.url().includes("/login")) return log(`  ✓ signed in as ${email}`);
  }
  throw new Error(`login failed for ${email}`);
}
async function loginHard(page, who, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      await login(page, who);
      return;
    } catch (e) {
      if (i === tries) throw e;
      await page.waitForTimeout(6000);
    }
  }
}
const stripOf = (page) =>
  page.evaluate(() => {
    const c = document.querySelector("[data-testid=close-till-button]");
    if (c) return c.parentElement.innerText.replace(/\s+/g, " ").trim();
    const o = document.querySelector("[data-testid=open-till-button]");
    if (o) return o.parentElement.innerText.replace(/\s+/g, " ").trim();
    return "(no till strip)";
  });

/** Poll for a toast rather than screenshot after it has faded (sonner clears in ~4s). */
async function catchToast(page, ms = 9000) {
  const deadline = Date.now() + ms;
  let best = "";
  while (Date.now() < deadline) {
    const t = await page.evaluate(() => {
      const n = document.querySelector("[data-sonner-toast]");
      return n ? n.innerText.replace(/\s+/g, " ").trim() : "";
    });
    if (t) {
      best = t;
      break;
    }
    await page.waitForTimeout(250);
  }
  return best;
}

const browser = await newBrowser();

// ═══ E. what a cashier sees at Till Review, on a LIVE session ════════════════
log("\n=== E. the cashier at /app/pos/tills, on a fresh session ===");
const cash = await newPage(browser);
await signIn(cash, HIRE.email, HIRE.newPassword);
await go(cash, "/app/pos", { waitMs: 6000 });
const t1 = await go(cash, "/app/pos/tills", { waitMs: 6000, allowTrouble: true });
note("cashierTillReviewTrouble", t1);
await shot(cash, "50-cashier-till-review-live");
const seen = await cash.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400));
note("cashierTillReviewText", seen);
note("cashierStillSignedIn", !cash.url().includes("/login"));
check(!cash.url().includes("/login"), "the cashier's session survived to score this screen");
const btnCount = await cash.locator("[data-testid=open-drawer-for-cashier-button]").count();
check(btnCount === 0, "the 'Open a drawer' control is absent for a cashier", String(btnCount));

// ═══ G. shift change: the cashier cashes up ══════════════════════════════════
log("\n=== G. the cashier cashes the drawer up ===");
await go(cash, "/app/pos", { waitMs: 7000 });
const stripNow = await stripOf(cash);
note("stripBeforeClose", stripNow);
const expectedCash = (stripNow.match(/Cash:\s*Rs ([\d,]+\.\d\d)/) ?? [])[1] ?? null;
note("expectedCashOnScreen", expectedCash);
await cash.locator("[data-testid=close-till-button]").click();
await cash.waitForTimeout(2500);
await shot(cash, "51-close-till-panel");
// The cash-up panel is INLINE, not a dialog — the declared count is the box labelled
// "Declared Cash Count (PKR)". Count the drawer honestly: declare exactly what the panel
// says is expected, so the close carries a zero variance and no reviewer is misled.
const panelFigures = await cash.evaluate(() => {
  const t = document.body.innerText;
  const g = (re) => (t.match(re) ?? [])[1] ?? null;
  return {
    float: g(/Opening float:\s*Rs ([\d,]+\.\d\d)/),
    taken: g(/Cash taken \(net of refunds\):\s*Rs ([\d,]+\.\d\d)/),
    expected: g(/Expected cash:\s*Rs ([\d,]+\.\d\d)/),
  };
});
note("closePanelFigures", panelFigures);
check(
  panelFigures.float === "5,000.00",
  "the cash-up panel shows the float the MANAGER counted in",
  panelFigures.float,
);
check(
  panelFigures.expected ===
    (Number((panelFigures.float ?? "0").replace(/,/g, "")) +
      Number((panelFigures.taken ?? "0").replace(/,/g, ""))
    ).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  "…and expected = float + cash taken, to the paisa",
  JSON.stringify(panelFigures),
);
const declaredBox = cash.locator('input[placeholder="e.g. 12500.00"]').first();
await declaredBox.fill((panelFigures.expected ?? "6228.00").replace(/,/g, ""));
await cash.waitForTimeout(700);
await cash.getByRole("button", { name: /^Close Till$/i }).last().click();
note("closeConfirmClicked", true);
await cash.waitForTimeout(7000);
await go(cash, "/app/pos", { waitMs: 7000 });
const stripClosed = await stripOf(cash);
note("stripAfterClose", stripClosed);
await shot(cash, "52-after-close");
check(/No active till/i.test(stripClosed), "the drawer is cashed up — the terminal reads 'No active till'", stripClosed);

// ═══ F. the manager hands a FRESH float over for the next shift ══════════════
log("\n=== F+G. the duty manager counts a fresh float for the next shift ===");
const mgr = await newPage(browser);
await loginHard(mgr, PEOPLE.manager);
await go(mgr, "/app/pos/tills", { waitMs: 6000 });
await mgr.locator("[data-testid=open-drawer-for-cashier-button]").first().click();
await mgr.waitForTimeout(2500);
const sel = mgr.locator("[role=dialog] select, dialog select").first();
await sel.selectOption(hireId);
await mgr.waitForTimeout(600);
await mgr.locator("[role=dialog] input, dialog input").first().fill("7250.50");
await mgr.waitForTimeout(900);
const sentence = await mgr.evaluate(() => {
  const d = document.querySelector("[role=dialog], dialog");
  const m = d ? d.innerText.match(/Counting[^\n]*/) : null;
  return m ? m[0].trim() : null;
});
note("sentence2", sentence);
check(
  !!sentence && sentence.includes("Rs 7,250.50") && sentence.includes(HIRE.fullName),
  "an odd-paisa float is shown back correctly, naming the cashier",
  sentence,
);
await shot(mgr, "53-panel-second-handover");
await mgr
  .locator("[role=dialog] button, dialog button")
  .filter({ hasText: /^Open drawer$/i })
  .first()
  .click();
const toast = await catchToast(mgr);
note("toast2", toast);
await shot(mgr, "54-toast");
check(!!toast, "the manager gets a confirmation toast at all", toast);
check(
  toast.includes(HIRE.fullName),
  "…which names the CASHIER the drawer was opened for",
  toast,
);
check(toast.includes("Rs 7,250.50"), "…and the float, to the paisa", toast);

// the cashier's own terminal, for the second shift
await go(cash, "/app/pos", { waitMs: 8000 });
const strip2 = await stripOf(cash);
note("stripSecondShift", strip2);
await shot(cash, "55-cashier-second-shift");
check(
  /Till\s*OPEN/i.test(strip2) && strip2.includes("Float: Rs 7,250.50"),
  "the cashier's terminal shows the NEW float for the next shift",
  strip2,
);
check(/Orders:\s*0\b/.test(strip2), "…on a fresh drawer with no orders yet", strip2);

const rows = await apiGet(cash, `/api/v1/pos/tills?cashierId=${hireId}&status=OPEN`, await tokenOf(cash));
const r0 = (rows.body?.data ?? [])[0] ?? {};
note("secondTillRow", r0);
check(r0.openingFloatPaisa === 725050, "the persisted float is 725050 paisa — no float rounding", String(r0.openingFloatPaisa));
check(r0.cashierId === hireId, "…and the drawer is the CASHIER's", r0.cashierId);

writeFileSync(`${OUT}/journal.json`, JSON.stringify({ ...out, checks3: checks }, null, 2));
log("\n--- part 3 checks ---");
checks.forEach((c) => log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.label}`));
log(`\n${checks.filter((c) => !c.pass).length} failures of ${checks.length}`);
await browser.close();
