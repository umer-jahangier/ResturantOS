// Shared sign-in / observation helpers for the S0-03 (menu edit erases tax code) repair evidence.
//
// Mirrors e2e/repair/s0-03's sibling s1-01-lib.mjs so a reviewer comparing the "before" probe
// with the "after" proof is comparing the same instrument, not two different ones.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

export const REPO = "/Users/muhammadumer/Documents/Projects/ResturantOS";
export const SHOTS = `${REPO}/.planning/audits/repair/S0-03`;
export const BASE = "http://localhost:3000";
export const GATEWAY = "http://localhost:8080";

export function totp(email) {
  const out = execFileSync("python3", [`${REPO}/scripts/generate_totp.py`, email], {
    cwd: REPO,
    encoding: "utf8",
  });
  return out.match(/TOTP code:\s*(\d{6})/)[1];
}

/**
 * Capture the app's OWN Authorization header off the wire.
 *
 * The access token lives in an in-memory zustand store that is not reachable from `window`, and
 * re-POSTing /auth/refresh to mint a second one would rotate the refresh cookie out from under
 * the signed-in page. Wrapping XHR's setRequestHeader observes the token the app is already
 * sending — the read that follows is genuinely "in the same browser session as the user", which
 * is what DONE MEANS asks for.
 */
export async function captureBearer(context) {
  await context.addInitScript(() => {
    const original = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      if (String(name).toLowerCase() === "authorization") {
        window.__bearer = value;
      }
      return original.call(this, name, value);
    };
  });
}

export async function login(page, { email, password, tenant = "floating-terrace" }) {
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
 * An error state read as an empty state is the single most expensive mistake in this audit,
 * so this retries once and says so.
 */
export async function openAndCheck(page, path, { settle = 2500 } = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(settle);
    const body = await page.locator("body").innerText().catch(() => "");
    const alerts = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
    const denied =
      /access denied|not authorized|don't have permission|do not have permission|403/i.test(body);
    const failed = /couldn'?t load|failed to load|something went wrong|unexpected error/i.test(body);
    const missing = /this page doesn'?t exist|404/i.test(body);
    if (attempt === 0 && (alerts.length || failed)) {
      console.log(
        `  [retry] ${path} showed an alert/error on attempt 1: ${JSON.stringify(alerts).slice(0, 200)}`,
      );
      await page.waitForTimeout(3000);
      continue;
    }
    const h1 = await page.locator("h1").first().innerText().catch(() => "(no h1)");
    return { url: page.url(), h1, denied, failed, missing, alerts, body };
  }
}

/** Independent read of the item, from inside the signed-in page, with the app's own Bearer. */
export async function readItemOverHttp(page, itemId) {
  return page.evaluate(
    async ([gateway, id]) => {
      const token = window.__bearer;
      if (!token) return { error: "no bearer captured" };
      const res = await fetch(`${gateway}/api/v1/pos/menu/items/${id}`, {
        headers: { Authorization: token },
        credentials: "include",
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, body: json };
    },
    [GATEWAY, itemId],
  );
}

export async function shot(page, name, { fullPage = true } = {}) {
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage });
  console.log(`  shot: ${name}.png`);
}
