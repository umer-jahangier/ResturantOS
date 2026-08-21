/*
 * S1 re-open, step 9 — the last DONE MEANS clause, driven as a DIFFERENT station than the
 * claimant used. They hired a bartender scoped to BAR. I hire a line cook scoped to GRILL and
 * ONLY GRILL, so the scope mechanism has to be real rather than a BAR-shaped special case, and
 * the negative control is the station they proved (BAR), which this account must NOT reach.
 *
 * Pass = the GRILL board carries MY check's Chicken Karahi, "No active stations configured"
 * appears nowhere, and BAR is refused.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, log, writeJson, loadState, BASE } from "./lib.mjs";

const STAMP = Date.now().toString().slice(-6);
const NEW = {
  slug: "floating-terrace",
  email: `cook.reopen.${STAMP}@terrace.local`,
  fullName: `Line Cook Reopen ${STAMP}`,
  newPassword: "Grill#Cook1234",
};
const ORDER_NO = process.env.ORDER_NO || "ORD-20260812-0353";

const browser = await newBrowser();
const out = { email: NEW.email, orderNo: ORDER_NO };
log("  hiring:", NEW.email);

async function fillLogin(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const toggle = page.getByText(/Use a restaurant identifier instead/i);
  if (await toggle.count()) {
    await toggle.first().click();
    await page.waitForTimeout(400);
  }
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(NEW.slug);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
}

const owner = await newPage(browser);
let hire;
try {
  await login(owner, PEOPLE.owner);
  await go(owner, "/app/users", { waitMs: 5000 });
  await owner.getByRole("button", { name: /add (a )?user|new user/i }).first().click();
  await owner.waitForTimeout(1500);

  await owner.locator("input[type=email]").first().fill(NEW.email);
  const nameInput = owner.locator('input[placeholder="Optional"]');
  if (await nameInput.count()) await nameInput.first().fill(NEW.fullName);

  const branchSel = owner.locator("#create-user-branch");
  const branchOpts = await branchSel.locator("option").allTextContents();
  const mainIdx = branchOpts.findIndex((t) => /HQ|Floating Terrace$/i.test(t.trim()));
  await branchSel.selectOption({ index: mainIdx > 0 ? mainIdx : 1 });
  await owner.waitForTimeout(900);

  const roleSel = owner.locator("[data-testid=role-select], #create-user-role");
  const roleOpts = await roleSel.first().locator("option").allTextContents();
  await roleSel.first().selectOption({ label: roleOpts.find((t) => /kitchen/i.test(t)) });
  await owner.waitForTimeout(900);

  const field = owner.locator("[data-testid=station-assignment-field]");
  await field.waitFor({ timeout: 15000 });
  out.stationsOffered = await owner.evaluate(() =>
    Array.from(document.querySelectorAll("[data-testid=station-assignment-field] li label")).map((l) =>
      (l.innerText || "").replace(/\s+/g, " ").trim(),
    ),
  );
  log("  station checkboxes offered:", JSON.stringify(out.stationsOffered));
  await field.locator("li label").filter({ hasText: "Hot line" }).first().locator("input[type=checkbox]").check();
  await owner.waitForTimeout(600);
  out.scopeSummary = await owner
    .locator("[data-testid=station-assignment-summary]")
    .innerText()
    .catch(() => null);
  log("  scope summary:", JSON.stringify(out.scopeSummary));
  await shot(owner, "09a-hire-grill-only");

  await owner.getByRole("button", { name: /^Create user$/i }).click();
  await owner.waitForTimeout(5500);
  const otp = await owner.evaluate(
    () => document.querySelector("[data-testid=one-time-password-value]")?.textContent?.trim() ?? null,
  );
  await shot(owner, "09b-created");
  if (!otp) throw new Error("no one-time password panel");
  log("  one-time password issued");
  await owner.getByRole("button", { name: /^Done$/i }).click().catch(() => {});

  // --- the cook signs in for real ---
  hire = await newPage(browser);
  await fillLogin(hire, NEW.email, otp);
  log("  first login landed at:", hire.url());
  const onChange =
    hire.url().includes("change-password") ||
    (await hire.locator("[data-testid=forced-password-change]").count()) > 0;
  if (onChange) {
    const inputs = hire.locator("input[type=password]");
    const n = await inputs.count();
    const byName = async (re, val) => {
      for (let i = 0; i < n; i++) {
        const nm = (await inputs.nth(i).getAttribute("name")) ?? "";
        const id = (await inputs.nth(i).getAttribute("id")) ?? "";
        if (re.test(nm) || re.test(id)) {
          await inputs.nth(i).fill(val);
          return true;
        }
      }
      return false;
    };
    const a = await byName(/current|old/i, otp);
    await byName(/^newPassword$|new(?!.*confirm)/i, NEW.newPassword);
    await byName(/confirm/i, NEW.newPassword);
    if (!a && n === 3) {
      await inputs.nth(0).fill(otp);
      await inputs.nth(1).fill(NEW.newPassword);
      await inputs.nth(2).fill(NEW.newPassword);
    }
    await shot(hire, "09c-forced-change");
    await hire
      .locator("[data-testid=forced-password-change] button[type=submit]")
      .first()
      .click()
      .catch(async () => {
        await hire.locator('button[type="submit"]').first().click();
      });
    await hire.waitForTimeout(9000);
    log("  after change-password:", hire.url());
  }
  if (hire.url().includes("/login")) await fillLogin(hire, NEW.email, NEW.newPassword);
  if (hire.url().includes("/login")) throw new Error("the cook could not sign in");

  // --- the station index ---
  await go(hire, "/app/kitchen", { waitMs: 8000, allowTrouble: true });
  out.index = await hire.evaluate(() => ({
    url: location.href,
    tiles: Array.from(document.querySelectorAll('[data-testid^="station-tile-"]')).map((t) =>
      t.getAttribute("data-testid").replace("station-tile-", ""),
    ),
    noActive: /No active stations configured/i.test(document.body.innerText || ""),
    h1: document.querySelector("h1")?.textContent?.trim() ?? null,
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim().slice(0, 200)),
    head: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 250),
  }));
  log("  /app/kitchen:", JSON.stringify(out.index));
  await shot(hire, "09d-station-index");

  // --- the GRILL board, reached the way a cook would ---
  const tile = hire.locator('[data-testid="station-tile-GRILL"]');
  out.clickedTile = false;
  if (await tile.count()) {
    await tile.first().click();
    await hire.waitForTimeout(7000);
    out.clickedTile = hire.url().includes("/app/kitchen/GRILL");
  }
  if (!out.clickedTile) await go(hire, "/app/kitchen/GRILL", { waitMs: 7000, allowTrouble: true });
  out.grill = await hire.evaluate((no) => {
    const text = (document.body.innerText || "").replace(/\s+/g, " ");
    return {
      url: location.href,
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
      hasMyOrder: text.includes(no),
      hasKarahi: /Chicken Karahi/.test(text),
      leakedBar: /Pinacolada|Fresh Lime|Mutton Biryani/.test(text),
      noActive: /No active stations configured/i.test(text),
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim().slice(0, 200)),
      head: text.slice(0, 260),
    };
  }, ORDER_NO);
  log("  GRILL board:", JSON.stringify(out.grill));
  await shot(hire, "09e-grill-board");

  // --- negative control: the station this account was NOT given ---
  await go(hire, "/app/kitchen/BAR", { waitMs: 7000, allowTrouble: true });
  out.barDenied = await hire.evaluate(() => {
    const text = (document.body.innerText || "").replace(/\s+/g, " ");
    return {
      url: location.href,
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
      refused: /No such station|not one of yours|don.t have access|Access denied/i.test(text),
      showsDrinks: /Pinacolada|Fresh Lime/.test(text),
      head: text.slice(0, 300),
    };
  });
  log("  BAR (should be refused):", JSON.stringify(out.barDenied));
  await shot(hire, "09f-bar-denied");

  writeJson("09-scoped-cook.json", out);
} catch (e) {
  console.error("FAILED:", e.message);
  writeJson("09-scoped-cook.json", { ...out, fatal: e.message });
  process.exitCode = 1;
} finally {
  await browser.close();
}
