// Real-browser proof for plan 28-09: an owner creates a bar till scoped to drinks, from a screen.
// Run from frontend/: node e2e/terminal-admin-proof.mjs
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";

const REPO = "/Users/muhammadumer/Documents/Projects/ResturantOS";
const SHOTS = `${REPO}/.planning/phases/28-station-pos-profiles/screenshots`;
const BASE = "http://localhost:3000";

function totp(email) {
  const out = execFileSync("python3", [`${REPO}/scripts/generate_totp.py`, email], {
    cwd: REPO,
    encoding: "utf8",
  });
  return out.match(/TOTP code:\s*(\d{6})/)[1];
}

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();

try {
  await page.goto(`${BASE}/login?tenant=floating-terrace`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const totpField = page.getByTestId("totp-code");
  for (let i = 0; i < 6 && !/\/app\//.test(page.url()); i += 1) {
    await page.getByLabel("Email").fill("admin@terrace.local");
    await page.getByLabel("Password").fill("Terrace#Admin1");
    if (await totpField.isVisible().catch(() => false)) {
      await totpField.fill(totp("admin@terrace.local"));
    }
    await page.getByTestId("login-submit").click();
    await Promise.race([
      page.waitForURL(/\/app\//, { timeout: 8000 }).catch(() => {}),
      totpField.waitFor({ state: "visible", timeout: 8000 }).catch(() => {}),
    ]);
    await page.waitForTimeout(1200);
  }
  await page.waitForURL(/\/app\//, { timeout: 20000 });
  console.log("signed in");

  await page.goto(`${BASE}/app/terminals`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  console.log("heading:", await page.locator("h1").first().innerText());
  await page.screenshot({ path: `${SHOTS}/08-terminals-empty.png`, fullPage: true });

  const code = `BAR${Date.now() % 100000}`;
  await page.getByRole("button", { name: "Add terminal" }).first().click();
  await page.getByLabel("Code").fill(code);
  await page.getByLabel("Name").fill("Bar till");
  await page.waitForTimeout(2000);

  console.log("menu scope BEFORE:", await page.getByTestId("menu-scope-summary").innerText());
  console.log("station set BEFORE:", await page.getByTestId("station-set-summary").innerText());

  const menu = page.getByTestId("menu-scope-picker");
  const cats = await menu.locator("label").allInnerTexts();
  console.log("categories offered:", JSON.stringify(cats));
  if (cats.length > 0) await menu.locator("input[type=checkbox]").first().check();

  const st = page.getByTestId("station-set-picker");
  const stationLabels = await st.locator("label").allInnerTexts();
  console.log("stations offered:", JSON.stringify(stationLabels));
  const barBox = st.getByLabel(/Main bar/);
  if (await barBox.isVisible().catch(() => false)) await barBox.check();

  console.log("menu scope AFTER :", await page.getByTestId("menu-scope-summary").innerText());
  console.log("station set AFTER:", await page.getByTestId("station-set-summary").innerText());
  await page.screenshot({ path: `${SHOTS}/09-terminal-form-scoped.png` });

  await page.getByRole("button", { name: "Add terminal" }).last().click();
  await page.waitForTimeout(3000);
  const err = await page.getByTestId("terminal-form-error").innerText().catch(() => null);
  if (err) console.log("FORM ERROR:", err);

  await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2000);
  const rows = await page.getByTestId("terminal-row").count();
  console.log("terminal rows:", rows);
  const summaries = await page.getByTestId("terminal-menu-summary").allInnerTexts();
  console.log("row summaries:", JSON.stringify(summaries));
  await page.screenshot({ path: `${SHOTS}/10-terminals-created.png`, fullPage: true });
  console.log("RESULT_CODE=" + code);
} catch (err) {
  console.error("FAILED:", err.message);
  await page.screenshot({ path: `${SHOTS}/98-terminal-failure.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
