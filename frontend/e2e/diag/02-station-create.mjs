// Focused: can an admin create a station from the screen? Step-by-step, screenshotting each step.
import { chromium } from "@playwright/test";
import { login, openAndCheck, shot } from "./lib-login.mjs";

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("  console.error:", m.text().slice(0, 200)); });
page.on("response", (res) => {
  const u = res.url();
  if (/\/pos\/stations/.test(u)) console.log(`  NET ${res.request().method()} ${res.status()} ${u.replace("http://localhost:8080", "")}`);
});
const stamp = Date.now() % 100000;

try {
  await login(page, { email: "admin@terrace.local", password: "Terrace#Admin1" });
  await openAndCheck(page, "/app/stations");
  const before = await page.getByTestId("station-row").count().catch(() => -1);
  console.log("stations before:", before);

  await page.getByRole("button", { name: /add station/i }).first().click();
  await page.waitForTimeout(1200);
  const dlg = page.locator('[role="dialog"]').first();
  console.log("dialog open:", await dlg.isVisible(), "labels:", JSON.stringify(await dlg.locator("label").allInnerTexts()));

  await dlg.getByLabel(/^code$/i).fill(`DGB${stamp}`);
  await dlg.getByLabel(/^name$/i).fill(`Diag Bar ${stamp}`);
  await shot(page, "s1-filled-text");

  // native <select> for station type
  const combo = dlg.getByRole("combobox").first();
  await combo.selectOption("BAR");
  await page.waitForTimeout(800);
  await shot(page, "s2-type-open");
  console.log("type value now:", await combo.inputValue());
  console.log("dialog STILL open after type pick:", await dlg.isVisible().catch(() => false));
  await shot(page, "s3-after-type-pick");

  const buttons = await page.locator('[role="dialog"] button').allInnerTexts().catch(() => []);
  console.log("dialog buttons:", JSON.stringify(buttons));

  const submit = page.locator('[role="dialog"] button[type="submit"]').first();
  console.log("submit visible:", await submit.isVisible().catch(() => false));
  await submit.click();
  await page.waitForTimeout(3000);
  console.log("form error:", await page.getByTestId("station-form-error").innerText().catch(() => "(none)"));
  console.log("dialog open after submit:", await page.locator('[role="dialog"]').first().isVisible().catch(() => false));
  await shot(page, "s4-after-submit");

  await openAndCheck(page, "/app/stations");
  const after = await page.getByTestId("station-row").count().catch(() => -1);
  console.log("stations AFTER reload:", after, "(before", before + ")");
  console.log("body:", (await page.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 500));
  await shot(page, "s5-stations-final");
  console.log("STAMP=" + stamp);
} catch (err) {
  console.error("FAILED:", err.message);
  await shot(page, "zz-station-create-failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
