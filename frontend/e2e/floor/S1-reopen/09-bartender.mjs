/*
 * S1 RE-OPEN 09 — my own bartender. Hired through /app/users, scoped to "Main bar" ONLY,
 * on a checked=16 stale=0 stack. Pass condition: the BAR board carries MY drink from
 * ORD-20260812-0415, "No active stations configured" appears nowhere, and the GRILL board —
 * which now holds Chicken Samosa — hands them nothing.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, log, BASE, OUT } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const STAMP = Date.now().toString().slice(-6);
const NEW = {
  slug: "floating-terrace",
  email: `reopen.bar.${STAMP}@terrace.local`,
  fullName: `Reopen Bartender ${STAMP}`,
  newPassword: "Bar#Reopen1234",
};
const ORDER = process.env.ORDER_NO || "ORD-20260812-0415";

const browser = await newBrowser();
const out = { email: NEW.email, order: ORDER };
log("hiring:", NEW.email, "looking for", ORDER);

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
  await page.waitForTimeout(7000);
}

const owner = await newPage(browser);
try {
  await login(owner, PEOPLE.owner);
  const tr = await go(owner, "/app/users", { waitMs: 6000 });
  log("/app/users:", JSON.stringify(tr));

  await owner.getByRole("button", { name: /add (a )?user|new user/i }).first().click();
  await owner.waitForTimeout(1600);
  await owner.locator("input[type=email]").first().fill(NEW.email);
  const nameInput = owner.locator('input[placeholder="Optional"]');
  if (await nameInput.count()) await nameInput.first().fill(NEW.fullName);

  const branchSel = owner.locator("#create-user-branch");
  const branchOpts = await branchSel.locator("option").allTextContents();
  const hqIdx = branchOpts.findIndex((t) => /HQ/i.test(t));
  await branchSel.selectOption({ index: hqIdx > 0 ? hqIdx : 1 });
  await owner.waitForTimeout(1000);
  log("branch chosen:", branchOpts[hqIdx > 0 ? hqIdx : 1]);

  const roleSel = owner.locator("[data-testid=role-select], #create-user-role").first();
  const roleOpts = await roleSel.locator("option").allTextContents();
  await roleSel.selectOption({ label: roleOpts.find((t) => /kitchen/i.test(t)) });
  await owner.waitForTimeout(900);

  const field = owner.locator("[data-testid=station-assignment-field]");
  await field.waitFor({ timeout: 20000 });
  const rows = await owner.evaluate(() =>
    Array.from(document.querySelectorAll("[data-testid=station-assignment-field] li label")).map((l) =>
      (l.innerText || "").replace(/\s+/g, " ").trim(),
    ),
  );
  log("station checkboxes offered:", JSON.stringify(rows));
  await field.locator("li label").filter({ hasText: "Main bar" }).first().locator("input[type=checkbox]").check();
  await owner.waitForTimeout(600);
  const summary = await owner.locator("[data-testid=station-assignment-summary]").innerText().catch(() => null);
  log("scope summary:", JSON.stringify(summary));
  out.stationRows = rows;
  out.summary = summary;
  await shot(owner, "09a-create-filled");

  await owner.getByRole("button", { name: /^Create user$/i }).click();
  await owner.waitForTimeout(6000);
  const otp = await owner.evaluate(
    () => document.querySelector("[data-testid=one-time-password-value]")?.textContent?.trim() ?? null,
  );
  log("one-time password:", otp);
  await shot(owner, "09b-created");
  if (!otp) throw new Error("no one-time password issued");
  await owner.getByRole("button", { name: /^Done$/i }).click().catch(() => {});

  // ── the bartender signs in ────────────────────────────────────────────────
  const hire = await newPage(browser);
  await fillLogin(hire, NEW.email, otp);
  log("first login at:", hire.url());
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
        if (re.test(nm) || re.test(id)) { await inputs.nth(i).fill(val); return true; }
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
    await hire.locator("[data-testid=forced-password-change] button[type=submit]").first().click()
      .catch(async () => { await hire.locator('button[type="submit"]').first().click(); });
    await hire.waitForTimeout(9000);
    log("after change-password:", hire.url());
  }
  if (hire.url().includes("/login")) await fillLogin(hire, NEW.email, NEW.newPassword);
  if (hire.url().includes("/login")) throw new Error("bartender could not sign in");
  await shot(hire, "09c-signed-in");

  // ── the station index ─────────────────────────────────────────────────────
  const idxT = await go(hire, "/app/kitchen", { waitMs: 8000 });
  const index = await hire.evaluate(() => ({
    url: location.href,
    tiles: Array.from(document.querySelectorAll('[data-testid^="station-tile-"]')).map((t) =>
      t.getAttribute("data-testid").replace("station-tile-", ""),
    ),
    noActive: /No active stations configured/i.test(document.body.innerText || ""),
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => (n.textContent || "").trim().slice(0, 160)),
    h1: document.querySelector("h1")?.textContent?.trim() ?? null,
  }));
  log("/app/kitchen as the bartender:", JSON.stringify({ ...idxT, ...index }));
  out.index = { ...idxT, ...index };
  await shot(hire, "09d-station-index");

  // ── the BAR board ─────────────────────────────────────────────────────────
  let clicked = false;
  const tile = hire.locator('[data-testid="station-tile-BAR"]');
  if (await tile.count()) {
    await tile.first().click();
    await hire.waitForTimeout(7000);
    clicked = hire.url().includes("/app/kitchen/BAR");
  }
  if (!clicked) await go(hire, "/app/kitchen/BAR", { waitMs: 7000 });
  const board = await hire.evaluate((ord) => {
    const txt = document.body.innerText || "";
    const cards = Array.from(document.querySelectorAll('[data-testid="kds-ticket-card"]'));
    return {
      url: location.href,
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
      cardCount: cards.length,
      mine: cards.filter((c) => (c.innerText || "").includes(ord)).map((c) => (c.innerText || "").replace(/\s+/g, " ").trim().slice(0, 240)),
      noActive: /No active stations configured/i.test(txt),
      mentionsPinacolada: txt.includes("Pinacolada"),
      mentionsSamosa: txt.includes("Chicken Samosa"),
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => (n.textContent || "").trim().slice(0, 160)),
    };
  }, ORDER);
  log("BAR board as the bartender:", JSON.stringify(board, null, 1));
  out.board = { clickedTile: clicked, ...board };
  await shot(hire, "09e-bar-board");

  // ── negative control: GRILL now holds Chicken Samosa; they must not get it ──
  await go(hire, "/app/kitchen/GRILL", { waitMs: 7000, allowTrouble: true });
  const grill = await hire.evaluate(() => {
    const txt = document.body.innerText || "";
    return {
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
      cardCount: document.querySelectorAll('[data-testid="kds-ticket-card"]').length,
      mentionsSamosa: txt.includes("Chicken Samosa"),
      excerpt: txt.replace(/\s+/g, " ").slice(0, 320),
    };
  });
  log("GRILL as the bartender (must hand them nothing):", JSON.stringify(grill, null, 1));
  out.grill = grill;
  await shot(hire, "09f-grill-denied");

  writeFileSync(`${OUT}/09-bartender.json`, JSON.stringify(out, null, 2));
  saveState({ bartender: out });
} catch (e) {
  console.error("FAILED:", e.message);
  await shot(owner, "09z-failure");
  writeFileSync(`${OUT}/09-bartender.json`, JSON.stringify({ ...out, error: e.message }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
