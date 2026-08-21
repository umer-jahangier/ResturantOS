// (f) Create a GRILL-scoped KITCHEN_STAFF user properly (branch first, then stations), then
// sign in as them and see whether the KDS is actually narrowed.
import { chromium } from "@playwright/test";
import { login, openAndCheck, shot, BASE } from "./lib-login.mjs";

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
const stamp = Date.now() % 100000;
const email = `bartender${stamp}@terrace.local`;

try {
  await login(page, { email: "admin@terrace.local", password: "Terrace#Admin1" });
  await openAndCheck(page, "/app/users", { settle: 3000 });
  await page.getByRole("button", { name: /add user/i }).first().click();
  await page.waitForTimeout(1800);
  const dlg = page.locator('[role="dialog"]').first();

  await dlg.getByLabel(/email address/i).fill(email);
  await dlg.getByLabel(/full name/i).fill(`Diag Bartender ${stamp}`);

  // BRANCH FIRST — the station picker is gated on it
  const branchSel = dlg.getByLabel(/branch/i).first();
  const branchOpts = await branchSel.locator("option").allInnerTexts().catch(() => []);
  console.log("branch options:", JSON.stringify(branchOpts));
  await branchSel.selectOption({ label: "Floating Terrace HQ (HQ)" });
  await page.waitForTimeout(2500);
  console.log("labels AFTER branch chosen:", JSON.stringify(await dlg.locator("label").allInnerTexts()));
  console.log("dialog mentions 'Stations' now:", /stations/i.test(await dlg.innerText()));
  const sf = page.getByTestId("station-assignment-field");
  console.log("station-assignment-field present:", await sf.count());
  await shot(page, "f5-user-dialog-with-branch");

  const roleSel = dlg.getByLabel(/role/i).first();
  await roleSel.selectOption({ label: "Kitchen Staff" }).catch((e) => console.log("role:", e.message));
  await page.waitForTimeout(1200);

  if (await sf.count()) {
    const stationText = await sf.innerText();
    console.log("STATION PICKER CONTENT:", JSON.stringify(stationText.replace(/\n+/g, " | ").slice(0, 400)));
    const boxes = sf.locator("input[type=checkbox]");
    const n = await boxes.count();
    console.log("station checkboxes:", n);
    const labels = await sf.locator("label").allInnerTexts().catch(() => []);
    console.log("station labels:", JSON.stringify(labels));
    const idx = labels.findIndex((l) => /hot line|grill/i.test(l));
    console.log("ticking GRILL at idx", idx);
    if (idx >= 0) await boxes.nth(idx).check();
    await page.waitForTimeout(400);
  }
  await shot(page, "f6-user-dialog-grill-ticked");

  await dlg.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
  const after = await page.locator("body").innerText();
  await shot(page, "f7-after-create");
  const pw = after.match(/Temporary password[\s\S]{0,80}/i)?.[0] ?? "(no temp password shown)";
  console.log("temp password block:", JSON.stringify(pw.replace(/\n+/g, " | ")));
  // grab any monospace/copyable password
  const codeEls = await page.locator("code, [data-testid*=password], pre").allInnerTexts().catch(() => []);
  console.log("code elements:", JSON.stringify(codeEls));
  console.log("EMAIL=" + email);
} catch (err) {
  console.error("FAILED:", err.message);
  await shot(page, "zz-scoped2-failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
