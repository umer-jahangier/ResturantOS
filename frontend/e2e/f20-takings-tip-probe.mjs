/*
 * F20 — READ-ONLY probe of /app/finance/takings as the OWNER.
 *
 * This script writes nothing: it signs in, loads the takings screen, and reports what the page
 * says about tips and whether a closed till's EXPECTED CASH can be rebuilt from the tender split
 * shown above it. Ten-plus agents share this stack, so it rings nothing up and closes no till.
 *
 * Run:  cd frontend && node e2e/f20-takings-tip-probe.mjs
 */
import { PEOPLE, login, newBrowser, newPage } from "./s8/lib.mjs";

const BASE = "http://localhost:3000";

function paisa(s) {
  if (!s) return null;
  const m = String(s).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Math.round(parseFloat(m[0]) * 100) : null;
}

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.owner);
  await page.goto(`${BASE}/app/finance/takings`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  const seen = await page.evaluate(() => {
    const body = document.body.innerText || "";
    const tenders = {};
    document.querySelectorAll('[data-testid^="tender-row-"]').forEach((tr) => {
      const method = tr.getAttribute("data-testid").replace("tender-row-", "");
      const cells = [...tr.querySelectorAll("td")].map((td) => td.textContent.trim());
      tenders[method] = {
        cells,
        amountPaisa: tr.querySelector('[data-testid^="tender-amount-"]')?.getAttribute("data-paisa") ?? null,
        tipPaisa: tr.querySelector('[data-testid^="tender-tip-"]')?.getAttribute("data-paisa") ?? null,
      };
    });
    const headers = [...document.querySelectorAll('[data-testid="tender-split"] th')].map((th) =>
      th.textContent.trim(),
    );
    const tills = [...document.querySelectorAll('[data-testid^="till-row-"], tbody tr')]
      .map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim()))
      .filter((c) => c.length);
    return {
      businessDate: document.querySelector('[data-testid="takings-date"]')?.value ?? null,
      wordTipAppears: /tip/i.test(body),
      tipMatches: (body.match(/[^\n]*tip[^\n]*/gi) ?? []).slice(0, 8),
      headers,
      tenders,
      tills,
      unclosed: document.querySelector('[data-testid="unclosed-tender-panel"]')?.innerText?.trim() ?? null,
    };
  });

  console.log("\n── /app/finance/takings, as owner@terrace.local ──");
  console.log("business date :", seen.businessDate);
  console.log('the word "tip" appears on the page :', seen.wordTipAppears);
  if (seen.tipMatches.length) console.log("  lines mentioning it:", seen.tipMatches);
  console.log("tender split headers :", seen.headers);
  console.log("tender rows :", JSON.stringify(seen.tenders, null, 2));
  console.log("unclosed panel :", seen.unclosed);
  console.log("till rows :", JSON.stringify(seen.tills, null, 2));

  // The reconciliation, attempted from what the page actually renders.
  const cash = seen.tenders.CASH;
  if (cash) {
    console.log(
      "\nCASH line: amount =",
      cash.amountPaisa,
      "paisa; tip column =",
      cash.tipPaisa === null ? "ABSENT FROM THE PAGE" : `${cash.tipPaisa} paisa`,
    );
  }
  void paisa;
} finally {
  await page.context().close();
  await browser.close();
}
