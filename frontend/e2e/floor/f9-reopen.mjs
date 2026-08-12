/*
 * F9 RE-OPEN ATTEMPT — independent drive of /app/finance/journal-entries/new.
 *
 * Differences from the claimant's own run, on purpose:
 *   - driven as accountant@terrace.local, the persona whose job this actually is (they used owner)
 *   - the amount is typed WITH the grouping comma the brief literally asks for ("1,250.50")
 *   - the posted entry is reloaded and re-read to prove persistence, not just first render
 *   - the READER paths are checked too: the list, the detail date, the GL
 *   - a HALF_UP rounding edge (10.005) is typed to see which way the screen rounds
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, log, BASE } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F9-reopen");
mkdirSync(OUT, { recursive: true });

const DEBIT_ACCOUNT = "1010";
const CREDIT_ACCOUNT = "3100";
const TYPED_DEBIT = "1,250.50"; // with the comma, exactly as the brief writes it
const TYPED_CREDIT = "1250.50";
const EXPECTED_PAISA = 125050;

const R = { persona: "accountant@terrace.local" };
const browser = await newBrowser();
const page = await newPage(browser);
const shot = async (n) => {
  await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
  log(`    shot: ${n}.png`);
};

await login(page, PEOPLE.accountant);

// ── what the ledger says before we touch anything ────────────────────────────────────────────
const periodsOpen = await apiGet(page, "/api/v1/finance/periods/open");
R.openPeriodCount = (periodsOpen.body?.data ?? []).length;
const aug = (periodsOpen.body?.data ?? []).find((p) => p.startDate === "2026-08-01");
R.augustPeriod = aug ? { id: aug.id, startDate: aug.startDate, endDate: aug.endDate, status: aug.status } : null;
log("  open periods:", R.openPeriodCount, "| Aug 2026:", JSON.stringify(R.augustPeriod));

const rowOf = (b, code) => (b?.data ?? []).find((r) => r.accountCode === code) ?? null;
const glBefore = await apiGet(page, `/api/v1/finance/gl/balances?periodId=${aug.id}`);
R.glBefore = { dr: rowOf(glBefore.body, DEBIT_ACCOUNT), cr: rowOf(glBefore.body, CREDIT_ACCOUNT) };
log("  GL before:", JSON.stringify(R.glBefore));

// ── STEP 1: the screen as it opens ───────────────────────────────────────────────────────────
const t1 = await go(page, "/app/finance/journal-entries/new", { waitMs: 6000 });
R.openTrouble = t1;
await shot("01-open-as-accountant");

R.onOpen = await page.evaluate(() => {
  const txt = document.body.innerText.replace(/\s+/g, " ");
  const monies = Array.from(document.querySelectorAll('input[inputmode="decimal"], input[type="number"]')).map((i) => ({
    type: i.getAttribute("type"),
    inputMode: i.getAttribute("inputmode"),
    label: i.getAttribute("aria-label"),
    placeholder: i.placeholder,
  }));
  const pressed = Array.from(document.querySelectorAll('[aria-pressed="true"]')).map((n) => n.textContent.trim());
  return {
    mentionsPaisa: /paisa/i.test(txt),
    hasDebitRs: /Debit \(Rs\)/.test(txt),
    hasCreditRs: /Credit \(Rs\)/.test(txt),
    calendarMonth: (txt.match(/(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/) ?? [null])[0],
    selectedLine: (txt.match(/Selected: [^]{0,20}?\d{4}/) ?? [null])[0],
    notice: (() => {
      const n = document.querySelector('[data-testid="entry-date-notice"]');
      return n ? n.innerText.replace(/\s+/g, " ").trim() : null;
    })(),
    pressedDays: pressed,
    moneyInputs: monies,
    blocked: (() => {
      const n = document.querySelector('[data-testid="submit-blocked-reason"]');
      return n ? n.innerText.trim() : null;
    })(),
  };
});
log("\n  STEP 1 on open:", JSON.stringify(R.onOpen, null, 1));

// ── STEP 2: type it as rupees, with the comma ────────────────────────────────────────────────
const posts = [];
page.on("request", (req) => {
  if (req.method() === "POST" && req.url().includes("/finance/journal-entries")) {
    posts.push({ url: req.url(), body: req.postData() });
  }
});

await page.locator("#description").fill("F9 REOPEN — accountant types rupees by hand");

async function pickAccount(index, code) {
  const line = page.locator('[data-testid="je-line"]').nth(index);
  const box = line.locator('input[placeholder*="Search account"]').first();
  await box.click();
  await box.fill(code);
  await page.waitForTimeout(1500);
  const opt = page.locator(`[cmdk-item][data-value="${code}"]`).first();
  if (await opt.count()) {
    await opt.click({ force: true });
  } else {
    await box.press("Enter");
  }
  await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  await page.locator("#description").click();
  await page.waitForTimeout(500);
}

await pickAccount(0, DEBIT_ACCOUNT);
await pickAccount(1, CREDIT_ACCOUNT);

await page.getByLabel("Line 1 debit (Rs)").fill(TYPED_DEBIT);
await page.getByLabel("Line 2 credit (Rs)").fill(TYPED_CREDIT);
await page.waitForTimeout(800);
await shot("02-typed-rupees");

R.afterTyping = await page.evaluate(() => {
  const txt = document.body.innerText.replace(/\s+/g, " ");
  return {
    totals: (txt.match(/Total DR: [^ ]+ [\d,.]+ Total CR: [^ ]+ [\d,.]+/) ?? [null])[0],
    balanced: /Balanced ✓/.test(txt),
    blocked: (() => {
      const n = document.querySelector('[data-testid="submit-blocked-reason"]');
      return n ? n.innerText.trim() : null;
    })(),
    saveDisabled: document.querySelector('button[type="submit"]')?.disabled ?? null,
  };
});
log("\n  STEP 2 after typing:", JSON.stringify(R.afterTyping, null, 1));

// ── STEP 3: save, and read the wire ──────────────────────────────────────────────────────────
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(5000);
R.postBody = posts.length ? posts[posts.length - 1].body : null;
R.urlAfterSave = page.url();
log("\n  STEP 3 POST body:", R.postBody);
log("  url after save:", R.urlAfterSave);
await shot("03-draft-detail");

const jeId = (R.urlAfterSave.match(/journal-entries\/([0-9a-f-]{10,})/) ?? [])[1] ?? null;
R.jeId = jeId;

R.draftScreen = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 900));

// ── post it ──────────────────────────────────────────────────────────────────────────────────
const postBtn = page.getByRole("button", { name: /^Post$/i }).first();
R.postButtonVisible = (await postBtn.count()) > 0;
if (R.postButtonVisible) {
  await postBtn.click();
  await page.waitForTimeout(1500);
  // some flows confirm in a dialog
  const confirm = page.getByRole("button", { name: /^(Post|Confirm|Yes)/i }).last();
  if (await confirm.count()) {
    await confirm.click().catch(() => {});
  }
  await page.waitForTimeout(4000);
}
await shot("04-posted");
R.afterPost = await page.evaluate(() => {
  const txt = document.body.innerText.replace(/\s+/g, " ");
  return {
    status: (txt.match(/\b(DRAFT|POSTED|VOID(ED)?)\b/) ?? [null])[0],
    entryNo: (txt.match(/JE-\d{4}-\d+/) ?? [null])[0],
    text: txt.slice(0, 900),
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
  };
});
log("\n  after Post:", JSON.stringify(R.afterPost, null, 1));

// ── STEP 4: PERSISTENCE — reload the detail page cold ────────────────────────────────────────
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
R.afterReload = await page.evaluate(() => {
  const txt = document.body.innerText.replace(/\s+/g, " ");
  return {
    status: (txt.match(/\b(DRAFT|POSTED|VOID(ED)?)\b/) ?? [null])[0],
    hasAmount: /1,250\.50/.test(txt),
    dateShown: (txt.match(/\d{1,2} \w{3} 20\d\d|20\d\d-\d\d-\d\d/g) ?? []).slice(0, 4),
    text: txt.slice(0, 900),
  };
});
log("\n  STEP 4 after reload:", JSON.stringify(R.afterReload, null, 1));
await shot("05-reloaded");

// ── read the persisted rows back over HTTP ───────────────────────────────────────────────────
if (jeId) {
  const je = await apiGet(page, `/api/v1/finance/journal-entries/${jeId}`);
  const d = je.body?.data ?? je.body;
  R.persisted = {
    status: d?.status,
    entryDate: d?.entryDate,
    totalDebitPaisa: d?.totalDebitPaisa,
    totalCreditPaisa: d?.totalCreditPaisa,
    lines: (d?.lines ?? []).map((l) => ({ a: l.accountCode, dr: l.debitPaisa, cr: l.creditPaisa })),
  };
  log("\n  persisted over HTTP:", JSON.stringify(R.persisted, null, 1));
}

// ── STEP 5: the GL reader ────────────────────────────────────────────────────────────────────
const glAfter = await apiGet(page, `/api/v1/finance/gl/balances?periodId=${aug.id}`);
R.glAfter = { dr: rowOf(glAfter.body, DEBIT_ACCOUNT), cr: rowOf(glAfter.body, CREDIT_ACCOUNT) };
const num = (v) => (typeof v === "number" ? v : 0);
R.glDelta = {
  debitAccountDebit: num(R.glAfter.dr?.debitPaisa) - num(R.glBefore.dr?.debitPaisa),
  creditAccountCredit: num(R.glAfter.cr?.creditPaisa) - num(R.glBefore.cr?.creditPaisa),
};
log("\n  STEP 5 GL delta:", JSON.stringify(R.glDelta));

const t5 = await go(page, "/app/finance/gl", { waitMs: 5000 });
R.glTrouble = t5;
// select the August 2026 period in the <select>
const sel = page.locator("select").first();
if (await sel.count()) {
  const opts = await sel.locator("option").allTextContents();
  R.glPeriodOptions = opts;
  const want = opts.find((o) => /2026-08-01/.test(o));
  if (want) await sel.selectOption({ label: want });
  await page.waitForTimeout(3500);
}
await shot("06-gl-screen");
R.glScreen = await page.evaluate(() => {
  const txt = document.body.innerText.replace(/\s+/g, " ");
  const rows = Array.from(document.querySelectorAll("tr")).map((r) => r.innerText.replace(/\s+/g, " ").trim());
  return {
    has1010: rows.filter((r) => /\b1010\b/.test(r)).slice(0, 2),
    has3100: rows.filter((r) => /\b3100\b/.test(r)).slice(0, 2),
    mentions125050: /1,250\.50/.test(txt),
  };
});
log("  GL screen rows:", JSON.stringify(R.glScreen, null, 1));

// ── STEP 6: the LIST reader ──────────────────────────────────────────────────────────────────
await go(page, "/app/finance/journal-entries", { waitMs: 5000 });
await shot("07-je-list");
R.listScreen = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll("tr")).map((r) => r.innerText.replace(/\s+/g, " ").trim());
  return rows.filter((r) => /F9 REOPEN|1,250\.50/.test(r)).slice(0, 3);
});
log("  list rows:", JSON.stringify(R.listScreen));

// ── STEP 7: HALF_UP rounding edge on a fresh form ────────────────────────────────────────────
await go(page, "/app/finance/journal-entries/new", { waitMs: 6000 });
await page.getByLabel("Line 1 debit (Rs)").fill("10.005");
await page.getByLabel("Line 2 credit (Rs)").fill("10.01");
await page.waitForTimeout(700);
R.roundingEdge = await page.evaluate(() => {
  const txt = document.body.innerText.replace(/\s+/g, " ");
  return {
    totals: (txt.match(/Total DR:.{0,30}Total CR:.{0,30}/) ?? [null])[0],
    balanced: /Balanced ✓/.test(txt),
  };
});
log("\n  STEP 7 rounding 10.005 vs 10.01:", JSON.stringify(R.roundingEdge));
await shot("08-rounding-edge");

// junk input
await page.getByLabel("Line 1 debit (Rs)").fill("12,5o0");
await page.waitForTimeout(600);
R.junkInput = await page.evaluate(() => {
  const err = document.querySelector('[data-testid="je-line-error-0"]');
  const blocked = document.querySelector('[data-testid="submit-blocked-reason"]');
  return {
    lineError: err ? err.textContent.trim() : null,
    blocked: blocked ? blocked.textContent.trim() : null,
    saveDisabled: document.querySelector('button[type="submit"]')?.disabled ?? null,
  };
});
log("  junk input:", JSON.stringify(R.junkInput));
await shot("09-junk-input");

writeFileSync(`${OUT}/_reopen.json`, JSON.stringify(R, null, 2));
log("\n  wrote", `${OUT}/_reopen.json`);
await browser.close();
