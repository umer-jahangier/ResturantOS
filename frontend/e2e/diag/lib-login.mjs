// Shared sign-in helper for the stations/KDS/terminals diagnosis.
import { execFileSync } from "node:child_process";

export const REPO = "/Users/muhammadumer/Documents/Projects/ResturantOS";
export const SHOTS = `${REPO}/.planning/audits/diagnosis/stations-kds-terminals`;
export const BASE = "http://localhost:3000";

export function totp(email) {
  const out = execFileSync("python3", [`${REPO}/scripts/generate_totp.py`, email], {
    cwd: REPO,
    encoding: "utf8",
  });
  return out.match(/TOTP code:\s*(\d{6})/)[1];
}

export async function login(page, { email, password, tenant = "floating-terrace", needsTotp = false }) {
  await page.goto(`${BASE}/login?tenant=${tenant}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const totpField = page.getByTestId("totp-code");
  for (let attempt = 0; attempt < 6 && !/\/app\/|\/platform\//.test(page.url()); attempt += 1) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    if (await totpField.isVisible().catch(() => false)) {
      await totpField.fill(totp(email));
    }
    await page.getByTestId("login-submit").click();
    await Promise.race([
      page.waitForURL(/\/app\/|\/platform\//, { timeout: 8000 }).catch(() => {}),
      totpField.waitFor({ state: "visible", timeout: 8000 }).catch(() => {}),
    ]);
    await page.waitForTimeout(1200);
  }
  await page.waitForURL(/\/app\/|\/platform\//, { timeout: 20000 });
  return page.url();
}

/**
 * Navigate and REPORT whether we landed on an error/denied state rather than a real screen.
 * Retries once on an alert, because a screenshot of a transient failure looks like a missing feature.
 */
export async function openAndCheck(page, path, { settle = 2200 } = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(settle);
    const body = await page.locator("body").innerText().catch(() => "");
    const alerts = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
    const denied = /access denied|not authorized|don't have permission|do not have permission|403/i.test(body);
    const failed = /couldn'?t load|failed to load|something went wrong|unexpected error/i.test(body);
    if (attempt === 0 && (alerts.length || failed)) {
      console.log(`  [retry] ${path} showed an alert/error on attempt 1: ${JSON.stringify(alerts).slice(0, 200)}`);
      await page.waitForTimeout(2500);
      continue;
    }
    const h1 = await page.locator("h1").first().innerText().catch(() => "(no h1)");
    return { url: page.url(), h1, denied, failed, alerts, body };
  }
}

export async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  console.log(`  shot: ${name}.png`);
}
