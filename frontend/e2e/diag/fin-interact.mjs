/* Drive the finance flows a real accountant must complete. DIAGNOSTIC ONLY. */
import { chromium } from "@playwright/test";
import { BASE, PERSONAS, login, shot, save, visit } from "./fin-lib.mjs";

const log = [];
const say = (s) => {
  console.log(s);
  log.push(s);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
const net = [];
page.on("response", (r) => {
  const u = r.url();
  if (u.includes("/api/")) net.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")}`);
});

if (!(await login(page, PERSONAS.accountant))) {
  say("LOGIN FAILED");
  process.exit(1);
}
say("signed in as accountant@terrace.local");

/* ---------- 1. DRILL-THROUGH: transaction -> order -> journal entries ---------- */
say("\n===== 1. DRILL-THROUGH from the transaction register =====");
await visit(page, "/app/finance/transactions");
// find the VOID row and open it
const voidRow = page.locator("tr", { hasText: "Void" }).first();
say(`void rows on page: ${await page.locator("tr", { hasText: "Void" }).count()}`);
if (await voidRow.count()) {
  const rowText = await voidRow.innerText();
  say(`opening void row: ${rowText.replace(/\n/g, " | ").slice(0, 160)}`);
  await voidRow.locator("a, button", { hasText: /open/i }).first().click();
  await page.waitForTimeout(4000);
  say(`after click url = ${page.url()}`);
  const body = await page.locator("body").innerText();
  say("---- drill-through panel text ----");
  say(body.slice(0, 3500));
  await shot(page, "drill-void");
}

/* ---------- 2. PAYMENT drill-through ---------- */
say("\n===== 2. DRILL-THROUGH on a normal payment =====");
await visit(page, "/app/finance/transactions");
const payRow = page.locator("tr", { hasText: "Payment" }).first();
if (await payRow.count()) {
  await payRow.locator("a, button", { hasText: /open/i }).first().click();
  await page.waitForTimeout(4000);
  say(`url = ${page.url()}`);
  const b = await page.locator("body").innerText();
  const i = b.indexOf("Transactions");
  say(b.slice(i, i + 3500));
  await shot(page, "drill-payment");
}

/* ---------- 3. CREATE A JOURNAL ENTRY end to end ---------- */
say("\n===== 3. CREATE A JOURNAL ENTRY =====");
await visit(page, "/app/finance/journal-entries/new");
await shot(page, "je-new-blank");
const sel = await page.locator("body").innerText();
say(`date label on load: ${(sel.match(/Selected: [\d-]+/) || ["<none>"])[0]}`);
// inspect what inputs exist
const inputs = await page.evaluate(() =>
  [...document.querySelectorAll("input,select,textarea,button")].map(
    (e) => `${e.tagName}[${e.getAttribute("name") || e.getAttribute("id") || e.getAttribute("aria-label") || e.textContent?.trim().slice(0, 30)}]`,
  ),
);
say(`controls: ${JSON.stringify(inputs)}`);
await save("je-new-controls.txt", JSON.stringify(inputs, null, 1));

/* ---------- 4. PERIOD CLOSE ---------- */
say("\n===== 4. CLOSE A PERIOD =====");
await visit(page, "/app/finance/periods");
const closeBtn = page.locator("button", { hasText: /close period/i }).first();
say(`Close Period buttons: ${await page.locator("button", { hasText: /close period/i }).count()}`);
if (await closeBtn.count()) {
  net.length = 0;
  await closeBtn.click();
  await page.waitForTimeout(3500);
  const dlg = page.locator('[role="dialog"]');
  say(`dialog present: ${await dlg.count()}`);
  if (await dlg.count()) {
    const box = await dlg.first().boundingBox();
    say(`dialog box: ${JSON.stringify(box)}`);
    say(`dialog text: ${(await dlg.first().innerText()).slice(0, 1500)}`);
  }
  await shot(page, "period-close-dialog");
  say(`api after click: ${net.filter((n) => n.includes("period")).join(" | ") || "none"}`);
  const body = await page.locator("body").innerText();
  say(`page after: ${body.slice(body.indexOf("Accounting Periods"), body.indexOf("Accounting Periods") + 1200)}`);
}

/* ---------- 5. NEW EXPENSE ---------- */
say("\n===== 5. NEW EXPENSE =====");
await visit(page, "/app/finance/expenses");
const newExp = page.locator("button", { hasText: /new expense/i }).first();
if (await newExp.count()) {
  await newExp.click();
  await page.waitForTimeout(3000);
  const dlg = page.locator('[role="dialog"]');
  say(`dialog present: ${await dlg.count()}  box=${JSON.stringify(await dlg.first().boundingBox().catch(() => null))}`);
  if (await dlg.count()) say(`dialog text:\n${(await dlg.first().innerText()).slice(0, 2000)}`);
  await shot(page, "expense-new-dialog");
}

/* ---------- 6. EXPORT CONTROLS anywhere in finance ---------- */
say("\n===== 6. EXPORT / DOWNLOAD CONTROLS =====");
for (const r of [
  "/app/finance/takings",
  "/app/finance/transactions",
  "/app/finance/gl",
  "/app/finance/accounts",
  "/app/finance/journal-entries",
  "/app/finance/ap-aging",
  "/app/finance/ar-aging",
  "/app/finance/expenses",
  "/app/finance/periods",
]) {
  await visit(page, r, { tries: 1, settle: 3500 });
  const hits = await page.evaluate(() =>
    [...document.querySelectorAll("button,a")]
      .map((e) => e.textContent?.trim() ?? "")
      .filter((t) => /export|download|csv|xlsx|excel|pdf|print/i.test(t)),
  );
  say(`${r} -> export controls: ${hits.length ? JSON.stringify(hits) : "NONE"}`);
}

save("interact.txt", log.join("\n"));
await browser.close();
