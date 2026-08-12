/*
 * S1 step 5 — THE STEP THE REGISTER COULD NOT DRIVE.
 *
 * Register §4.1: "A bartender created exactly as documented (/app/users → Role Kitchen Staff →
 * tick 'Main bar / Bar — Bar screen') signs in and sees `No active stations configured`."
 * Register §7 weakness #10 admits that fix was proved BY INFERENCE — kitchen-service and
 * pos-service went down before the bartender's own scoped screen could be re-checked.
 *
 * So: hire one, for real, through the screen the register names, sign in as them, and look at
 * what a bartender actually sees.
 *
 * The pass condition is NOT "the page loaded". It is: the station index offers BAR and only BAR,
 * the BAR board carries the drink from the check rung in step 3, and the words
 * "No active stations configured" appear nowhere.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, log, BASE } from "./lib.mjs";

const STAMP = Date.now().toString().slice(-6);
const NEW = {
  slug: "floating-terrace",
  email: `bartender.s1.${STAMP}@terrace.local`,
  fullName: `Bartender S1 ${STAMP}`,
  // 12+ characters: the forced-change form's own schema is `min(12)`.
  newPassword: "Bar#Tender1234",
};

const browser = await newBrowser();
log("  the new bartender will be:", NEW.email);

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
  // ── the owner hires a bartender, scoped to the bar ─────────────────────────────
  await login(owner, PEOPLE.owner);
  const tr = await go(owner, "/app/users", { waitMs: 5000 });
  log("  /app/users:", JSON.stringify(tr));

  await owner.getByRole("button", { name: /add (a )?user|new user/i }).first().click();
  await owner.waitForTimeout(1400);

  await owner.locator("input[type=email]").first().fill(NEW.email);
  const nameInput = owner.locator('input[placeholder="Optional"]');
  if (await nameInput.count()) await nameInput.first().fill(NEW.fullName);

  const branchSel = owner.locator("#create-user-branch");
  const branchOpts = await branchSel.locator("option").allTextContents();
  log("  branch options:", JSON.stringify(branchOpts));
  const mainIdx = branchOpts.findIndex((t) => /HQ|Floating Terrace$/i.test(t.trim()));
  await branchSel.selectOption({ index: mainIdx > 0 ? mainIdx : 1 });
  await owner.waitForTimeout(900);

  const roleSel = owner.locator("[data-testid=role-select], #create-user-role");
  const roleOpts = await roleSel.first().locator("option").allTextContents();
  log("  role options:", JSON.stringify(roleOpts));
  await roleSel.first().selectOption({ label: roleOpts.find((t) => /kitchen/i.test(t)) });
  await owner.waitForTimeout(800);

  // The station picker — tick "Main bar" ONLY.
  const field = owner.locator("[data-testid=station-assignment-field]");
  await field.waitFor({ timeout: 15000 });
  const rows = await owner.evaluate(() =>
    Array.from(
      document.querySelectorAll("[data-testid=station-assignment-field] li label"),
    ).map((l) => (l.innerText || "").replace(/\s+/g, " ").trim()),
  );
  log("  station checkboxes offered:", JSON.stringify(rows));
  const barLabel = field.locator("li label").filter({ hasText: "Main bar" }).first();
  await barLabel.locator("input[type=checkbox]").check();
  await owner.waitForTimeout(500);
  const summary = await owner
    .locator("[data-testid=station-assignment-summary]")
    .innerText()
    .catch(() => null);
  log("  scope summary on the form:", JSON.stringify(summary));
  await shot(owner, "05a-create-bartender-filled");

  await owner.getByRole("button", { name: /^Create user$/i }).click();
  await owner.waitForTimeout(5000);
  const otp = await owner.evaluate(
    () =>
      document.querySelector("[data-testid=one-time-password-value]")?.textContent?.trim() ?? null,
  );
  log("  one-time password:", otp);
  await shot(owner, "05b-bartender-created");
  if (!otp) {
    const d = await owner.evaluate(
      () => document.querySelector("[role=dialog]")?.innerText?.replace(/\s+/g, " ").trim() ?? null,
    );
    throw new Error(`no one-time password — dialog said: ${d}`);
  }
  await owner.getByRole("button", { name: /^Done$/i }).click().catch(() => {});
  await owner.waitForTimeout(1200);

  // ── the bartender signs in ─────────────────────────────────────────────────────
  hire = await newPage(browser);
  await fillLogin(hire, NEW.email, otp);
  log("  first login landed at:", hire.url());
  await shot(hire, "05c-bartender-first-login");

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
    const b = await byName(/^newPassword$|new(?!.*confirm)/i, NEW.newPassword);
    const c = await byName(/confirm/i, NEW.newPassword);
    if (!a && n === 3) {
      await inputs.nth(0).fill(otp);
      await inputs.nth(1).fill(NEW.newPassword);
      await inputs.nth(2).fill(NEW.newPassword);
    }
    log("  filled cur/new/confirm:", a, b, c, "(fields:", n, ")");
    await shot(hire, "05c2-change-password-filled");
    await hire
      .locator("[data-testid=forced-password-change] button[type=submit]")
      .first()
      .click()
      .catch(async () => {
        await hire.locator('button[type="submit"]').first().click();
      });
    await hire.waitForTimeout(8000);
    log("  after change-password, at:", hire.url());
    const panelErr = await hire.evaluate(() => {
      const p = document.querySelector("[data-testid=forced-password-change]");
      return p ? (p.innerText || "").replace(/\s+/g, " ").trim().slice(0, 400) : null;
    });
    if (panelErr) log("  change panel still up:", JSON.stringify(panelErr));
    await shot(hire, "05c3-after-change");
  }
  if (hire.url().includes("/login")) {
    await fillLogin(hire, NEW.email, NEW.newPassword);
    log("  re-login landed at:", hire.url());
  }
  if (hire.url().includes("/login")) throw new Error("bartender could not sign in");

  // ── what a bartender sees ──────────────────────────────────────────────────────
  const st = loadState();
  const orderNo = process.env.ORDER_NO || st.boards?.orderNo || st.ring?.orderNo;
  log("  looking for", orderNo);

  const idxTrouble = await go(hire, "/app/kitchen", { waitMs: 7000 });
  const index = await hire.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll('[data-testid^="station-tile-"]')).map((t) =>
      t.getAttribute("data-testid").replace("station-tile-", ""),
    );
    return {
      tiles,
      noStationsPanel: !!document.querySelector('[data-testid="kds-no-stations"]'),
      noStationsTitle:
        document.querySelector('[data-testid="kds-no-stations-title"]')?.textContent?.trim() ??
        null,
      bodyMentionsNoActive: /No active stations configured/i.test(document.body.innerText || ""),
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
        (n.textContent || "").trim().slice(0, 200),
      ),
    };
  });
  log("  /app/kitchen index:", JSON.stringify({ ...idxTrouble, ...index }));
  await shot(hire, "05d-bartender-station-index");

  // Click the BAR tile the way a bartender would, rather than typing the URL.
  let clicked = false;
  const barTile = hire.locator('[data-testid="station-tile-BAR"]');
  if (await barTile.count()) {
    await barTile.first().click();
    await hire.waitForTimeout(6000);
    clicked = hire.url().includes("/app/kitchen/BAR");
  }
  log("  reached the BAR board by clicking its tile:", clicked, "-", hire.url());
  if (!clicked) await go(hire, "/app/kitchen/BAR", { waitMs: 6000 });

  const board = await hire.evaluate((ord) => {
    const cards = Array.from(document.querySelectorAll('[data-testid="kds-ticket-card"]'));
    return {
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
      cardCount: cards.length,
      mine: cards
        .filter((c) => (c.innerText || "").includes(ord))
        .map((c) => (c.innerText || "").replace(/\s+/g, " ").trim().slice(0, 260)),
      bodyMentionsNoActive: /No active stations configured/i.test(document.body.innerText || ""),
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
        (n.textContent || "").trim().slice(0, 200),
      ),
      mentionsPinacolada: (document.body.innerText || "").includes("Pinacolada"),
    };
  }, orderNo ?? "ORD-");
  log("  BAR board as the bartender:", JSON.stringify(board));
  await shot(hire, "05e-bartender-bar-board");

  // And the negative control: a station they do NOT work must not hand them its tickets.
  await go(hire, "/app/kitchen/GRILL", { waitMs: 6000, allowTrouble: true });
  const grill = await hire.evaluate(() => ({
    h1: document.querySelector("h1")?.textContent?.trim() ?? null,
    cardCount: document.querySelectorAll('[data-testid="kds-ticket-card"]').length,
    mentionsKebab: (document.body.innerText || "").includes("Seekh Kebab"),
  }));
  log("  GRILL board as the bartender (must be empty):", JSON.stringify(grill));
  await shot(hire, "05f-bartender-grill-denied");

  saveState({ bartender: { ...NEW, tempPassword: otp, rows, summary, index, board, grill, clicked } });
} catch (e) {
  console.error("FAILED:", e.message);
  await shot(owner, "05z-owner-failure");
  if (hire) await shot(hire, "05z-hire-failure");
  process.exitCode = 1;
} finally {
  await browser.close();
}
