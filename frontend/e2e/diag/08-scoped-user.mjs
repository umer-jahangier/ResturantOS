// (f) Does a station-scoped account actually see only its own station's tickets?
// Create a KITCHEN_STAFF user bound to GRILL from the Users screen, then sign in as them.
// GRILL is the sharp probe: it has 1 ticket while DEFAULT has 39. If the new account sees
// DEFAULT, the scope is decorative.
import { chromium } from "@playwright/test";
import { login, openAndCheck, shot, BASE } from "./lib-login.mjs";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
const stamp = Date.now() % 100000;
const email = `bartender${stamp}@terrace.local`;

try {
  await login(page, { email: "admin@terrace.local", password: "Terrace#Admin1" });
  const r = await openAndCheck(page, "/app/users", { settle: 3000 });
  console.log("users page h1:", r.h1, "| denied:", r.denied, "| failed:", r.failed);
  await shot(page, "f1-users-page");

  const add = page.getByRole("button", { name: /add user|new user|invite/i }).first();
  console.log("add-user button:", await add.isVisible().catch(() => false));
  await add.click();
  await page.waitForTimeout(2000);
  const dlg = page.locator('[role="dialog"]').first();
  console.log("dialog box:", JSON.stringify(await dlg.boundingBox().catch(() => null)));
  console.log("dialog labels:", JSON.stringify(await dlg.locator("label").allInnerTexts().catch(() => [])));
  const dtext = await dlg.innerText().catch(() => "");
  console.log("dialog mentions station:", /station/i.test(dtext));
  const stationField = page.getByTestId("station-assignment-field");
  console.log("station-assignment-field present:", await stationField.count());
  if (await stationField.count()) {
    console.log("  station options offered:", JSON.stringify(await stationField.locator("label").allInnerTexts().catch(() => [])));
  }
  await shot(page, "f2-user-dialog");

  // fill it
  for (const [label, val] of [[/first name/i, "Diag"], [/last name/i, "Bartender"], [/^email$/i, email], [/phone/i, "03001234567"]]) {
    await dlg.getByLabel(label).first().fill(val).catch(() => console.log("  no field:", label));
  }
  // role
  const roleSel = dlg.getByLabel(/role/i).first();
  if (await roleSel.isVisible().catch(() => false)) {
    const opts = await roleSel.locator("option").allInnerTexts().catch(() => []);
    console.log("  role options:", JSON.stringify(opts));
    await roleSel.selectOption({ label: opts.find((o) => /kitchen/i.test(o)) ?? opts[1] }).catch((e) => console.log("  role select:", e.message));
  }
  // station: tick GRILL / Hot line
  if (await stationField.count()) {
    const labels = await stationField.locator("label").allInnerTexts();
    const idx = labels.findIndex((l) => /hot line|grill/i.test(l));
    console.log("  ticking station idx", idx, "=", labels[idx]);
    if (idx >= 0) await stationField.locator("input[type=checkbox]").nth(idx).check();
  }
  await shot(page, "f3-user-dialog-filled");
  await dlg.locator('button[type="submit"]').first().click().catch((e) => console.log("  submit:", e.message));
  await page.waitForTimeout(4000);
  const bodyAfter = await page.locator("body").innerText();
  await shot(page, "f4-after-user-create");
  // capture the temp password if shown
  const pwMatch = bodyAfter.match(/[A-Za-z0-9!@#$%^&*]{10,20}/g) ?? [];
  console.log("  post-create snippet:", bodyAfter.replace(/\n+/g, " | ").slice(0, 700));
  console.log("EMAIL=" + email);
} catch (err) {
  console.error("FAILED:", err.message);
  await shot(page, "zz-scoped-user-failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
