/*
 * F9 PROOF — /app/finance/journal-entries/new, driven as owner@terrace.local.
 *
 * DONE MEANS, step by step:
 *   1. the screen no longer jumps a year back — today IS inside an open period (FY2027 P2), so
 *      today is what it selects, and the calendar opens on that month;
 *   2. 1,250.50 typed as RUPEES on a debit and a credit line, no ×100 arithmetic anywhere;
 *   3. the entry posts, reads Rs 1,250.50 on both lines and balances;
 *   4. the same figure appears to the paisa on /app/finance/gl.
 *
 * Step 0 also proves the fallback SENTENCE, by making the server answer with only the fiscal-2026
 * periods — the subset that genuinely does not cover today. That is a real server answer driving
 * the real component; nothing about the page is stubbed.
 */
import {
  PEOPLE,
  newBrowser,
  newPage,
  login,
  go,
  apiGet,
  log,
  BASE,
} from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F9");
mkdirSync(OUT, { recursive: true });

const DEBIT_ACCOUNT = "1010"; // Cash in Hand
const CREDIT_ACCOUNT = "3100"; // Owner's Capital
const AMOUNT = "1250.50";
const EXPECTED_PAISA = 125050;

const browser = await newBrowser();
const page = await newPage(browser);
await login(page, PEOPLE.owner);

const results = {};
const shot = async (n) => {
  await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
  log(`    shot: ${n}.png`);
};

// ── baseline: what the GL says about these two accounts before we touch anything ─────────────
const periodsRes = await apiGet(page, "/api/v1/finance/periods?fiscalYear=2027");
const augPeriod = (periodsRes.body?.data ?? []).find((p) => p.startDate === "2026-08-01");
log("  August 2026 period:", JSON.stringify(augPeriod));
const glBefore = await apiGet(page, `/api/v1/finance/gl/balances?periodId=${augPeriod.id}`);
const rowOf = (body, code) => (body?.data ?? []).find((r) => r.accountCode === code) ?? null;
results.glBefore = {
  debitAccount: rowOf(glBefore.body, DEBIT_ACCOUNT),
  creditAccount: rowOf(glBefore.body, CREDIT_ACCOUNT),
};
log("  GL before:", JSON.stringify(results.glBefore));

// ── STEP 0: the fallback sentence, with the server answering FY2026 open periods only ────────
await page.route("**/api/v1/finance/periods/open", async (route) => {
  const res = await route.fetch();
  const json = await res.json();
  const only2026 = (json.data ?? []).filter((p) => p.fiscalYear === 2026);
  await route.fulfill({
    response: res,
    body: JSON.stringify({ ...json, data: only2026 }),
    headers: { ...res.headers(), "content-type": "application/json" },
  });
});
await go(page, "/app/finance/journal-entries/new", { waitMs: 7000 });
results.fallbackState = await page.evaluate(() => {
  const notice = document.querySelector('[data-testid="entry-date-notice"]');
  const t = document.body.innerText.replace(/\s+/g, " ");
  return {
    notice: notice ? notice.innerText.replace(/\s+/g, " ").trim() : null,
    calendarMonth: (t.match(/(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/) ?? [null])[0],
    selected: (t.match(/Selected: [^ ]+ [^ ]+ \d{4}/) ?? [null])[0],
  };
});
log("\n  STEP 0 (server serves FY2026 open periods only):", JSON.stringify(results.fallbackState, null, 1));
await shot("01-fallback-sentence");
await page.unroute("**/api/v1/finance/periods/open");

// ── STEP 1: the real screen, real data ───────────────────────────────────────────────────────
await go(page, "/app/finance/journal-entries/new", { waitMs: 7000 });
results.realState = await page.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, " ");
  const pressed = Array.from(document.querySelectorAll('button[aria-pressed="true"]')).map((b) =>
    b.getAttribute("aria-label"),
  );
  return {
    notice: document.querySelector('[data-testid="entry-date-notice"]')?.innerText ?? null,
    calendarMonth: (t.match(/(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/) ?? [null])[0],
    selected: (t.match(/Selected: [^S]*?(?=Description)/) ?? [null])[0]?.trim() ?? null,
    pressedDay: pressed,
    columnLabels: Array.from(document.querySelectorAll("span"))
      .map((n) => n.textContent.trim())
      .filter((s) => /^(Debit|Credit) \(/.test(s)),
    mentionsPaisa: /paisa/i.test(t),
    moneyInputs: Array.from(document.querySelectorAll("form input"))
      .filter((i) => i.inputMode === "decimal" || i.type === "number")
      .map((i) => ({ type: i.type, inputMode: i.inputMode, label: i.getAttribute("aria-label"), value: i.value, placeholder: i.placeholder })),
    // Computed style, never the class list: `cn()`/tailwind-merge has silently dropped
    // utilities in this repo before, and the contract type roles are new to this file.
    computed: (() => {
      const header = Array.from(document.querySelectorAll("span")).find((n) => n.textContent.trim() === "Debit (Rs)");
      const totals = Array.from(document.querySelectorAll("span")).find((n) => /^Total DR:/.test(n.textContent ?? ""));
      const pick = (n) => (n ? { fontSize: getComputedStyle(n).fontSize, color: getComputedStyle(n).color } : null);
      return { headerLabel: pick(header), totalsRow: pick(totals) };
    })(),
  };
});
log("\n  STEP 1 (live data):", JSON.stringify(results.realState, null, 1));
await shot("02-new-je-today-selected");

// ── STEP 2: type the entry in rupees ─────────────────────────────────────────────────────────
async function pickAccount(index, code) {
  const boxes = page.locator('input[placeholder="Search account code or name"]');
  const box = boxes.nth(index);
  await box.click({ force: true });
  await box.fill(code);
  await page.waitForTimeout(1500);
  const option = page.locator(`[cmdk-item][data-value="${code}"]`).first();
  await option.waitFor({ timeout: 10000 });
  await option.click({ force: true, timeout: 10000 });
  await page.waitForTimeout(600);
  // The popover closes on select; if it lingers it will swallow the next line's clicks, so
  // dismiss it explicitly before moving on.
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.click(8, 8);
  await page.waitForTimeout(500);
  const value = await box.inputValue();
  if (value !== code) throw new Error(`account ${index} did not take: input reads "${value}"`);
  log(`    account line ${index + 1} = ${code}`);
}

await page.locator('input[placeholder="Journal entry description"]').fill("F9 rupee-entry proof");
await pickAccount(0, DEBIT_ACCOUNT);
await pickAccount(1, CREDIT_ACCOUNT);

await page.locator('input[aria-label="Line 1 debit (Rs)"]').fill(AMOUNT);
await page.locator('input[aria-label="Line 2 credit (Rs)"]').fill(AMOUNT);
await page.waitForTimeout(800);

results.typed = await page.evaluate(() => {
  const t = document.body.innerText.replace(/\s+/g, " ");
  return {
    totalsLine: (t.match(/Total DR:.*?(Balanced|Not balanced)[^ ]*/) ?? [null])[0],
    balanced: /Balanced ✓/.test(t),
    saveDisabled: Array.from(document.querySelectorAll("button")).find((b) => /Save as Draft/.test(b.textContent))?.disabled ?? null,
    blockedReason: document.querySelector('[data-testid="submit-blocked-reason"]')?.innerText ?? null,
    debitValue: document.querySelector('input[aria-label="Line 1 debit (Rs)"]')?.value ?? null,
    creditValue: document.querySelector('input[aria-label="Line 2 credit (Rs)"]')?.value ?? null,
  };
});
log("\n  STEP 2 (typed 1250.50 as rupees):", JSON.stringify(results.typed, null, 1));
await shot("03-typed-rupees");

// ── STEP 3: save, then post ──────────────────────────────────────────────────────────────────
const createReq = [];
page.on("request", (r) => {
  if (r.url().includes("/api/v1/finance/journal-entries") && r.method() === "POST") {
    createReq.push({ url: r.url(), body: r.postData() });
  }
});
await page.locator('button[type="submit"]', { hasText: "Save as Draft" }).first().click();
await page.waitForTimeout(6000);
results.postedRequest = createReq;
log("\n  STEP 3 request bodies:", JSON.stringify(createReq, null, 1));
log("  now at:", page.url());
await shot("04-draft-detail");

results.draftDetail = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll("tbody tr")).map((r) =>
    Array.from(r.querySelectorAll("td")).map((c) => c.innerText.replace(/\s+/g, " ").trim()),
  );
  return {
    url: location.href,
    heading: document.querySelector("h1")?.textContent?.trim() ?? null,
    body: document.body.innerText.replace(/\s+/g, " ").slice(0, 900),
    rows,
  };
});
log("\n  STEP 3 draft detail:", JSON.stringify(results.draftDetail, null, 1));

const postBtn = page.locator("button", { hasText: /^Post$/ }).first();
if (await postBtn.count()) {
  await postBtn.click();
  await page.waitForTimeout(6000);
}
results.postedDetail = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll("tbody tr")).map((r) =>
    Array.from(r.querySelectorAll("td")).map((c) => c.innerText.replace(/\s+/g, " ").trim()),
  );
  return {
    url: location.href,
    heading: document.querySelector("h1")?.textContent?.trim() ?? null,
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
    body: document.body.innerText.replace(/\s+/g, " ").slice(0, 900),
    rows,
  };
});
log("\n  STEP 3 POSTED detail:", JSON.stringify(results.postedDetail, null, 1));
await shot("05-posted-entry");
const jeId = page.url().split("/").pop();
results.jeId = jeId;

// ── STEP 4: the general ledger, on screen ────────────────────────────────────────────────────
await go(page, "/app/finance/gl", { waitMs: 8000 });
await page.selectOption("#periodSelect", augPeriod.id);
await page.waitForTimeout(6000);
results.glScreen = await page.evaluate(
  ({ dr, cr }) => {
    const rows = Array.from(document.querySelectorAll("tbody tr")).map((r) =>
      Array.from(r.querySelectorAll("td")).map((c) => c.innerText.replace(/\s+/g, " ").trim()),
    );
    return {
      selectedPeriod: document.querySelector("#periodSelect")?.selectedOptions?.[0]?.textContent?.trim() ?? null,
      debitRow: rows.find((r) => r[0] === dr) ?? null,
      creditRow: rows.find((r) => r[0] === cr) ?? null,
      rowCount: rows.length,
    };
  },
  { dr: DEBIT_ACCOUNT, cr: CREDIT_ACCOUNT },
);
log("\n  STEP 4 GL on screen:", JSON.stringify(results.glScreen, null, 1));
await shot("06-gl-after");

const glAfter = await apiGet(page, `/api/v1/finance/gl/balances?periodId=${augPeriod.id}`);
results.glAfter = {
  debitAccount: rowOf(glAfter.body, DEBIT_ACCOUNT),
  creditAccount: rowOf(glAfter.body, CREDIT_ACCOUNT),
};
const beforeDr = results.glBefore.debitAccount?.debitTotal ?? 0;
const afterDr = results.glAfter.debitAccount?.debitTotal ?? 0;
const beforeCr = results.glBefore.creditAccount?.creditTotal ?? 0;
const afterCr = results.glAfter.creditAccount?.creditTotal ?? 0;
results.glDelta = { debitDelta: afterDr - beforeDr, creditDelta: afterCr - beforeCr, expected: EXPECTED_PAISA };
log("\n  STEP 4 GL delta:", JSON.stringify(results.glDelta, null, 1));

// ── STEP 5: 390 / 768 / 1440, light and dark ─────────────────────────────────────────────────
for (const [w, h, name] of [
  [390, 844, "390"],
  [768, 1024, "768"],
  [1440, 950, "1440"],
]) {
  await page.setViewportSize({ width: w, height: h });
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await go(page, "/app/finance/journal-entries/new", { waitMs: 5000 });
    await page.locator('input[aria-label="Line 1 debit (Rs)"]').fill("1250.50");
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/07-${name}-${scheme}.png`, fullPage: true });
    log(`    shot: 07-${name}-${scheme}.png`);
  }
}
results.overflow = await page.evaluate(() => ({
  docWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  horizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
}));
log("\n  overflow at 1440:", JSON.stringify(results.overflow));

writeFileSync(`${OUT}/_proof.json`, JSON.stringify(results, null, 2));
await browser.close();
log("\nF9 proof complete →", OUT);
