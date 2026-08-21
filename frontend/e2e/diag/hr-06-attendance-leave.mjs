/* Pass 6: attendance, corrections, leave request → approval, and the roster. */
import { newBrowser, ctxPage, login, visit, shot, PERSONAS } from "./hr-lib.mjs";

const browser = await newBrowser();
const { page } = await ctxPage(browser);
page.on("response", async (r) => {
  const u = r.url();
  if (u.includes("/api/v1/hr/") && (r.request().method() !== "GET" || r.status() >= 400)) {
    let b = ""; try { b = (await r.text()).slice(0, 250); } catch {}
    console.log(`    NET ${r.request().method()} ${u.split("/api")[1]} -> ${r.status()} ${b}`);
  }
});
await login(page, PERSONAS.owner);

console.log("\n########## ATTENDANCE ##########");
await visit(page, "/app/hr/attendance");

// pick an employee and clock in
const empSelect = page.locator("select").first();
const opts = await empSelect.locator("option").allInnerTexts();
console.log("employee options:", JSON.stringify(opts));
await empSelect.selectOption({ index: 1 });
await page.waitForTimeout(2000);
console.log("summary line:", (await page.locator("body").innerText()).match(/late \d+m[^\n]*/)?.[0] ?? "(none)");

await page.getByRole("button", { name: /^Clock in$/ }).click();
await page.waitForTimeout(3000);
console.log("after clock-in body bits:", (await page.locator("body").innerText()).match(/late \d+m[^\n]*/)?.[0] ?? "(none)");
await shot(page, "06-attendance-clockin");

// Is there ANY way to see the punch list, edit a punch time, or approve a correction?
const bodyA = await page.locator("body").innerText();
for (const probe of ["punch", "Edit", "Correct", "Approve", "Timesheet", "History", "Export"]) {
  console.log(`  contains "${probe}":`, bodyA.includes(probe));
}

console.log("\n########## LEAVE ##########");
const addTypes = page.getByRole("button", { name: /Add standard leave types/i });
console.log("has 'Add standard leave types':", await addTypes.count());
if (await addTypes.count()) {
  await addTypes.first().click();
  await page.waitForTimeout(3500);
}
await visit(page, "/app/hr/attendance");
const selects = page.locator("section", { hasText: "Leave" }).locator("select");
const leaveSection = page.locator("section").filter({ hasText: "Leave type…" });
const ltypes = await leaveSection.locator("select").nth(1).locator("option").allInnerTexts();
console.log("leave type options now:", JSON.stringify(ltypes));
await shot(page, "06-leave-types");

if (ltypes.length > 1) {
  await leaveSection.locator("select").nth(0).selectOption({ index: 1 });
  await leaveSection.locator("select").nth(1).selectOption({ index: 1 });
  await page.getByRole("button", { name: /Request leave/i }).click();
  await page.waitForTimeout(3500);
  const toast = await page.locator("body").innerText();
  console.log("toast:", toast.match(/Leave requested[^\n]*|Request failed[^\n]*/)?.[0] ?? "(none)");
  await shot(page, "06-leave-requested");
}

// Is there a LIST of pending requests anywhere?
const bodyL = await page.locator("body").innerText();
console.log("page mentions 'Pending':", bodyL.includes("Pending"));
console.log("page shows a request-id input:", await page.getByPlaceholder(/Leave request id/i).count());
console.log("balances shown:", /balance/i.test(bodyL));

console.log("\n########## SCHEDULE ##########");
await visit(page, "/app/hr/schedule");
await shot(page, "06-schedule");
const bodyS = await page.locator("body").innerText();
console.log("schedule body:\n" + bodyS.split("\n").slice(-25).join("\n"));
// try a drag: employee chip -> first cell
const chip = page.locator('[draggable="true"]');
console.log("draggable elements:", await chip.count());
if (await chip.count()) {
  const cells = page.locator("td");
  console.log("td count:", await cells.count());
  const src = chip.first();
  // find a droppable cell (row cell in the shift table)
  const target = cells.nth(1);
  try {
    await src.dragTo(target);
    await page.waitForTimeout(3000);
    console.log("after drag, body tail:\n" + (await page.locator("body").innerText()).split("\n").slice(-14).join("\n"));
  } catch (e) { console.log("drag failed:", String(e).slice(0, 200)); }
}
await shot(page, "06-schedule-after-drag");

// Can you delete or edit a shift?
console.log("shift row buttons:", JSON.stringify(await page.locator("table button").allInnerTexts()));
await browser.close();
