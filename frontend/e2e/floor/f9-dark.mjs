import { PEOPLE, newBrowser, newPage, login, go, log } from "../shift/lib.mjs";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/floor/F9";
const b = await newBrowser();
const p = await newPage(b);
await login(p, PEOPLE.owner);
await p.emulateMedia({ colorScheme: "dark" });

// (a) warning notice in dark
await p.route("**/api/v1/finance/periods/open", async (route) => {
  const res = await route.fetch();
  const j = await res.json();
  await route.fulfill({ response: res, body: JSON.stringify({ ...j, data: (j.data ?? []).filter((x) => x.fiscalYear === 2026) }), headers: { ...res.headers(), "content-type": "application/json" } });
});
await go(p, "/app/finance/journal-entries/new", { waitMs: 6000 });
const noticeStyle = await p.evaluate(() => {
  const n = document.querySelector('[data-testid="entry-date-notice"]');
  const cs = n && getComputedStyle(n);
  return n ? { color: cs.color, background: cs.backgroundColor, border: cs.borderTopColor, fontSize: cs.fontSize } : null;
});
log("dark notice:", JSON.stringify(noticeStyle));
await p.screenshot({ path: `${OUT}/08-dark-notice.png`, fullPage: false });
await p.unroute("**/api/v1/finance/periods/open");

// (b) balanced indicator in dark
await go(p, "/app/finance/journal-entries/new", { waitMs: 6000 });
await p.locator('input[aria-label="Line 1 debit (Rs)"]').fill("1250.50");
await p.locator('input[aria-label="Line 2 credit (Rs)"]').fill("1250.50");
await p.waitForTimeout(700);
const balanced = await p.evaluate(() => {
  const n = Array.from(document.querySelectorAll("span")).find((s) => /Balanced/.test(s.textContent ?? "") && s.children.length === 0);
  return n ? { text: n.textContent.trim(), color: getComputedStyle(n).color, fontSize: getComputedStyle(n).fontSize } : null;
});
log("dark balanced:", JSON.stringify(balanced));
await p.screenshot({ path: `${OUT}/09-dark-balanced.png`, fullPage: false });

// (c) an invalid amount, dark
await p.locator('input[aria-label="Line 1 debit (Rs)"]').fill("12,5o0");
await p.waitForTimeout(700);
const err = await p.evaluate(() => {
  const n = document.querySelector('[data-testid="je-line-error-0"]');
  return n ? { text: n.innerText.trim(), color: getComputedStyle(n).color, role: n.getAttribute("role"), ariaInvalid: document.querySelector('input[aria-label="Line 1 debit (Rs)"]').getAttribute("aria-invalid") } : null;
});
log("dark line error:", JSON.stringify(err));
await p.screenshot({ path: `${OUT}/10-dark-invalid.png`, fullPage: false });
await b.close();
