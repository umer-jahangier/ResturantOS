/*
 * S8 step 1 — reproduce the residual gap, before touching a line of code.
 *
 * The claim under test: on /app/settings/printers an owner CANNOT pick a USB/system printer from a
 * list of devices the agent found. The only control is a free-text box, so the owner has to know
 * the CUPS queue name by heart and type it exactly, and a typo is a printer that never prints.
 */
import { newBrowser, newPage, login, go, shot, PEOPLE, OUT } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const browser = await newBrowser();
const page = await newPage(browser);
await login(page, PEOPLE.owner);

const trouble = await go(page, "/app/settings/printers", { waitMs: 5000 });
console.log("  page:", JSON.stringify(trouble));
await shot(page, "01a-printers-as-owner");

// Add a receipt printer and switch it to USB/system, which is the exact click path the owner takes.
const addReceipt = page.locator('[data-testid="add-receipt-printer"]');
console.log("  add-receipt-printer present:", await addReceipt.count());
if (await addReceipt.count()) {
  await addReceipt.first().click();
  await page.waitForTimeout(800);
}

const rows = page.locator('[data-testid="printer-row"]');
const count = await rows.count();
console.log("  printer rows:", count);

// The last row is the one just added.
const row = rows.nth(count - 1);
const transportSelect = row.locator('select[id^="transport-"]').first();
await transportSelect.selectOption("SYSTEM").catch(async () => {
  console.log("  ! could not select SYSTEM on the first select; dumping options");
  console.log(await transportSelect.evaluate((el) => el.outerHTML.slice(0, 600)));
});
await page.waitForTimeout(800);
await shot(page, "01b-system-transport-selected");

const evidence = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('[data-testid="printer-row"]'));
  const last = rows[rows.length - 1];
  if (!last) return { error: "no printer row" };
  const controls = Array.from(last.querySelectorAll("input, select, textarea")).map((el) => ({
    tag: el.tagName,
    type: el.getAttribute("type"),
    id: el.id,
    label: (document.querySelector(`label[for="${el.id}"]`)?.textContent || "").trim(),
    placeholder: el.getAttribute("placeholder"),
    list: el.getAttribute("list"),
    options:
      el.tagName === "SELECT"
        ? Array.from(el.options).map((o) => `${o.value}=${o.textContent.trim()}`)
        : null,
  }));
  const queue = controls.find((c) => /queue/i.test(c.label || ""));
  const datalists = Array.from(document.querySelectorAll("datalist")).map((d) => ({
    id: d.id,
    options: Array.from(d.options).map((o) => o.value),
  }));
  return {
    controls,
    queueControl: queue ?? null,
    queueIsFreeText: queue ? queue.tag === "INPUT" && !queue.list : null,
    datalists,
    bodyMentionsDiscovered: /discovered|found on|devices on this/i.test(document.body.innerText),
  };
});

console.log(JSON.stringify(evidence, null, 2));
writeFileSync(`${OUT}/01-repro.json`, JSON.stringify(evidence, null, 2));

console.log(
  "\n  VERDICT: the print-queue control is",
  evidence.queueIsFreeText ? "FREE TEXT with no device list" : "something else — look at the JSON",
);

await browser.close();
