// (f) literal: a BAR-scoped account. What does a bartender actually see?
import { chromium } from "@playwright/test";
import { login, openAndCheck, shot, BASE } from "./lib-login.mjs";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const stamp = Date.now() % 100000;
const email = `bartend${stamp}@terrace.local`;
try {
  await login(page, { email: "admin@terrace.local", password: "Terrace#Admin1" });
  await openAndCheck(page, "/app/users", { settle: 3000 });
  await page.getByRole("button", { name: /add user/i }).first().click();
  await page.waitForTimeout(1800);
  const dlg = page.locator('[role="dialog"]').first();
  await dlg.getByLabel(/email address/i).fill(email);
  await dlg.getByLabel(/full name/i).fill(`Bar Tender ${stamp}`);
  await dlg.getByLabel(/branch/i).first().selectOption({ label: "Floating Terrace HQ (HQ)" });
  await page.waitForTimeout(2500);
  await dlg.getByLabel(/role/i).first().selectOption({ label: "Kitchen Staff" });
  await page.waitForTimeout(1000);
  const sf = page.getByTestId("station-assignment-field");
  const labels = await sf.locator("label").allInnerTexts();
  const idx = labels.findIndex((l) => /main bar/i.test(l));
  console.log("ticking BAR station:", labels[idx]);
  await sf.locator("input[type=checkbox]").nth(idx).check();
  await dlg.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
  const codes = await page.locator("code").allInnerTexts();
  const temp = codes[codes.length - 1];
  console.log("EMAIL=" + email, "TEMP=" + temp);
  console.log("PASTE: node e2e/diag/10-scoped-login.mjs '" + email + "' '" + temp + "'");
} catch (e) { console.error("FAILED:", e.message); } finally { await browser.close(); }
