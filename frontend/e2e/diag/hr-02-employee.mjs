/* Pass 2: can an owner actually add and edit an employee? Measure the dialog too. */
import { newBrowser, ctxPage, login, visit, shot, PERSONAS } from "./hr-lib.mjs";

const browser = await newBrowser();
const { page } = await ctxPage(browser);
await login(page, PERSONAS.owner);
await visit(page, "/app/hr/employees");

await page.getByRole("button", { name: /New employee/i }).click();
await page.waitForTimeout(1500);

const dlg = page.locator('[role="dialog"]');
console.log("dialogs on page:", await dlg.count());
const box = await dlg.first().boundingBox();
console.log("dialog boundingBox:", JSON.stringify(box));
const computed = await dlg.first().evaluate((el) => {
  const s = getComputedStyle(el);
  return { width: s.width, maxWidth: s.maxWidth, position: s.position };
});
console.log("dialog computed:", JSON.stringify(computed));
await shot(page, "02-employee-dialog");

console.log("\n--- dialog text ---");
console.log(await dlg.first().innerText());

console.log("\n--- form controls ---");
const controls = await dlg.first().locator("input, select, textarea, button").evaluateAll((els) =>
  els.map((e) => ({
    tag: e.tagName,
    type: e.getAttribute("type"),
    name: e.getAttribute("name") || e.id,
    placeholder: e.getAttribute("placeholder"),
    label: (e.labels && e.labels[0]?.innerText) || e.innerText?.slice(0, 40),
  })),
);
console.log(JSON.stringify(controls, null, 1));

// Fill it for real.
async function fill(name, value) {
  const el = dlg.first().locator(`[name="${name}"], #${name}`);
  if ((await el.count()) === 0) { console.log(`  !! no field named ${name}`); return false; }
  await el.first().fill(value);
  return true;
}
const stamp = Date.now().toString().slice(-6);
await fill("employeeNo", `DIAG${stamp}`);
await fill("fullName", `Diag Cashier ${stamp}`);
await fill("cnic", "3520112345671");
await fill("basicSalary", "60000");
await fill("basicSalaryRupees", "60000");
await fill("joinDate", "2026-01-15");
await fill("bankAccountNo", "PK36SCBL0000001123456702");
// selects
for (const sel of await dlg.first().locator("select").all()) {
  const opts = await sel.locator("option").allInnerTexts();
  console.log("  select options:", JSON.stringify(opts));
}
await shot(page, "02-employee-dialog-filled");

const submit = dlg.first().getByRole("button", { name: /Save|Create|Add/i });
console.log("submit buttons:", await submit.count());
if (await submit.count()) {
  await submit.first().click();
  await page.waitForTimeout(3500);
}
await shot(page, "02-employee-after-submit");
console.log("\n--- after submit, dialog still open?", await page.locator('[role="dialog"]').count());
const bodyText = await page.locator("body").innerText();
console.log(bodyText.split("\n").filter((l) => /DIAG|Diag|error|required|invalid/i.test(l)).join("\n"));

await browser.close();
