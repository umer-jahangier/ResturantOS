/*
 * F19 — shared harness for "a new hire who sets their password must retype it".
 *
 * Everything here is a MEASUREMENT helper. Nothing asserts; the individual scripts do.
 */
import { PEOPLE, newBrowser, newPage, login, BASE, API, log } from "../../shift/lib.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export { PEOPLE, newBrowser, newPage, login, BASE, API, log };

export const OUT = resolve(process.cwd(), "../.planning/audits/floor/F19");
mkdirSync(OUT, { recursive: true });

export async function shot(page, name) {
  const p = `${OUT}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false });
  log(`    shot: ${name}.png`);
  return p;
}

/**
 * Sign in as the owner, retrying through the optimistic-lock clash that ten agents sharing
 * one database occasionally produce on the user row.
 */
export async function ownerSignedIn(browser) {
  const owner = await newPage(browser);
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await login(owner, PEOPLE.owner);
      return owner;
    } catch (e) {
      log(`  owner login attempt ${attempt} failed: ${e.message}`);
      await owner.waitForTimeout(4000);
    }
  }
  throw new Error("owner could not sign in after 4 attempts");
}

/**
 * Drive `/app/users` → Add a user → Cashier on the main branch, and return the one-time
 * password the hand-over dialog shows exactly once.
 *
 * Retried, because ten agents share this machine and this is not the thing under test: a
 * user-service that is a second slow, or a dialog that has not painted, must not be scored as a
 * finding about the login flow.
 */
export async function hireCashier(owner, hire, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await hireCashierOnce(owner, hire);
    } catch (e) {
      last = e;
      log(`  hire attempt ${i} failed: ${e.message}`);
      await owner.keyboard.press("Escape").catch(() => {});
      await owner.waitForTimeout(4000);
    }
  }
  throw last;
}

async function hireCashierOnce(owner, { email, fullName }) {
  await owner.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(5000);
  await owner
    .getByRole("button", { name: /add (a )?user|new user/i })
    .first()
    .click();
  await owner.waitForTimeout(1200);
  await owner.locator("input[type=email]").first().fill(email);
  const nameInput = owner.locator('input[placeholder="Optional"]');
  if (await nameInput.count()) await nameInput.first().fill(fullName);
  const branchSel = owner.locator("#create-user-branch");
  const branchOpts = await branchSel.locator("option").allTextContents();
  const mainIdx = branchOpts.findIndex((t) => /HQ|Floating Terrace$/i.test(t.trim()));
  await branchSel.selectOption({ index: mainIdx > 0 ? mainIdx : 1 });
  await owner.waitForTimeout(500);
  const roleSel = owner.locator("[data-testid=role-select]");
  const roleOpts = await roleSel.locator("option").allTextContents();
  await roleSel.selectOption({ label: roleOpts.find((t) => /cashier/i.test(t)) });
  await owner.waitForTimeout(400);
  await owner
    .getByRole("button", { name: /^Create user$/i })
    .first()
    .click();
  // Wait for the hand-over panel rather than guessing at how long user-service takes.
  await owner.waitForSelector("[data-testid=one-time-password-value]", { timeout: 20_000 });
  const otp = await owner.evaluate(
    () =>
      document.querySelector("[data-testid=one-time-password-value]")?.textContent?.trim() ?? null,
  );
  if (!otp) throw new Error("no one-time password panel — cannot continue");
  await owner
    .getByRole("button", { name: /^Done$/i })
    .first()
    .click();
  await owner.waitForTimeout(1500);
  return otp;
}

/**
 * What a human would see and what the tab actually holds, at one instant.
 *
 * `signedIn` is NOT read off the URL: a page can be at `/app/dashboard` while the session
 * store is empty and the next fetch 401s. It spends the HttpOnly refresh cookie the way
 * every other probe in this repo does, which is the only honest answer to "is there a
 * session".
 */
export async function measure(page) {
  const view = await page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const visibleText = (document.body.innerText || "").replace(/\s+/g, " ").trim();
    return {
      href: location.href,
      search: location.search,
      passwordPrompts: document.querySelectorAll('input[type="password"]').length,
      hasSignInButton: Array.from(document.querySelectorAll("button")).some(
        (b) => (b.textContent || "").trim() === "Sign in",
      ),
      status: q('[role="status"]')?.textContent?.trim() ?? null,
      alert: q('[role="alert"]')?.textContent?.trim() ?? null,
      heading: q("h1")?.textContent?.trim() ?? null,
      changePanel: document.querySelectorAll("[data-testid=forced-password-change]").length,
      snippet: visibleText.slice(0, 220),
    };
  });
  const session = await page.evaluate(async (api) => {
    const r = await fetch(`${api}/api/v1/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    let body = null;
    try {
      body = await r.json();
    } catch {
      body = null;
    }
    return {
      refreshStatus: r.status,
      hasAccessToken: Boolean(body?.accessToken ?? body?.data?.accessToken),
    };
  }, API);
  return { ...view, ...session };
}

export function reporter() {
  const fails = [];
  return {
    fails,
    check(ok, what, detail) {
      log(`  ${ok ? "PASS" : "FAIL"}  ${what}${detail ? ` — ${detail}` : ""}`);
      if (!ok) fails.push(what);
    },
  };
}
