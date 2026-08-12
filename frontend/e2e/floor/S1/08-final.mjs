/*
 * S1 step 8 — the whole chain again, end to end, against a kitchen-service that
 * `check-stale-jars.sh` reports `ok`.
 *
 * Steps 2–5 were driven against the previous kitchen-service process; another agent restarted it
 * mid-session. Rather than argue about whether that mattered, the chain is re-driven in one run:
 *
 *   owner clears a dish's route and watches it fall back    (the CLEAR branch of the control)
 *   owner sets it again                                     (the SET branch)
 *   cashier rings drink + grilled dish + curry and fires it
 *   the three boards each carry their own line, PANTRY1 carries none
 *   the BAR-only bartender signs in and sees the drink
 */
import {
  PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, apiGet, log, BASE,
} from "./lib.mjs";

const st = loadState();
const BARTENDER = st.bartender;
if (!BARTENDER) throw new Error("run 05-bartender.mjs first");

const browser = await newBrowser();
const result = {};

async function rowState(page, itemName) {
  return page.evaluate((n) => {
    const row = Array.from(document.querySelectorAll('[data-testid="routing-item"]')).find(
      (r) => r.getAttribute("data-item-name") === n,
    );
    return row
      ? {
          effective: row.getAttribute("data-effective-station"),
          source: row.getAttribute("data-route-source"),
          text: row.querySelector('[data-testid="routing-item-destination"]')?.textContent?.trim(),
        }
      : null;
  }, itemName);
}
const toasts = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-sonner-toast]")).map((t) =>
      (t.textContent || "").trim(),
    ),
  );

try {
  // ── 1. the owner, both directions of the item control ────────────────────────────
  const owner = await newPage(browser);
  await login(owner, PEOPLE.owner);
  await go(owner, "/app/menu/routing", { waitMs: 9000 });
  await owner.locator('[data-testid="routing-item"]').first().waitFor({ timeout: 30000 });

  const kebab = owner.locator(
    '[data-testid="routing-item"][data-item-name="Seekh Kebab"] [data-testid="item-station-select"]',
  );
  await kebab.selectOption({ index: 0 }); // "Follow category — Cold prep (PANTRY1)"
  await owner.waitForTimeout(2500);
  result.clearToast = await toasts(owner);
  result.afterClear = await rowState(owner, "Seekh Kebab");
  log("  clear:", JSON.stringify(result.clearToast), JSON.stringify(result.afterClear));
  await shot(owner, "08a-kebab-cleared");
  await owner.waitForTimeout(6000);

  await kebab.selectOption({ label: "Hot line (GRILL)" });
  await owner.waitForTimeout(2500);
  result.setToast = await toasts(owner);
  result.afterSet = await rowState(owner, "Seekh Kebab");
  log("  set:", JSON.stringify(result.setToast), JSON.stringify(result.afterSet));
  await shot(owner, "08b-kebab-set-again");

  // ── 2. the cashier rings the mixed check ─────────────────────────────────────────
  const cash = await newPage(browser);
  await login(cash, PEOPLE.cashier);
  await go(cash, "/app/pos", { waitMs: 8000 });
  await cash.locator("[data-testid=order-type-dine_in]").click().catch(() => {});
  await cash.waitForTimeout(600);

  const search = cash.locator('input[placeholder*="Search" i], input[aria-label*="Search" i]');
  for (const name of ["Pinacolada", "Seekh Kebab", "Chicken Karahi"]) {
    if (await search.count()) {
      await search.first().fill(name);
      await cash.waitForTimeout(1500);
    }
    await cash
      .locator('[data-testid="menu-grid"] button[aria-pressed]')
      .filter({ hasText: name })
      .first()
      .click();
    await cash.waitForTimeout(700);
    if (await search.count()) {
      await search.first().fill("");
      await cash.waitForTimeout(1200);
    }
  }
  await shot(cash, "08c-cart");
  await cash.locator("[data-testid=send-to-kitchen-button]").click();
  await cash.waitForTimeout(9000);
  const orderNo = await cash.evaluate(() => {
    const m = (document.body.innerText || "").match(/ORD-\d{8}-\d+/);
    return m ? m[0] : null;
  });
  result.orderNo = orderNo;
  log("  fired:", orderNo);
  await shot(cash, "08d-fired");

  // ── 3. the three boards ──────────────────────────────────────────────────────────
  const cook = await newPage(browser);
  await login(cook, PEOPLE.kitchen);
  result.boards = {};
  for (const code of ["BAR", "GRILL", "DEFAULT", "PANTRY1"]) {
    await go(cook, `/app/kitchen/${code}`, { waitMs: 6000, allowTrouble: true });
    result.boards[code] = await cook.evaluate((ord) => {
      const cards = Array.from(document.querySelectorAll('[data-testid="kds-ticket-card"]'));
      return {
        h1: document.querySelector("h1")?.textContent?.trim() ?? null,
        mine: cards
          .filter((c) => (c.innerText || "").includes(ord))
          .map((c) => (c.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200)),
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
          (n.textContent || "").trim().slice(0, 120),
        ),
      };
    }, orderNo);
    log(`  ${code}:`, JSON.stringify(result.boards[code]));
    await shot(cook, `08e-${code.toLowerCase()}`);
  }

  // ── 4. the BAR-only bartender ────────────────────────────────────────────────────
  const bar = await newPage(browser);
  await bar.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await bar.waitForTimeout(1500);
  const toggle = bar.getByText(/Use a restaurant identifier instead/i);
  if (await toggle.count()) {
    await toggle.first().click();
    await bar.waitForTimeout(400);
  }
  const slug = bar.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(BARTENDER.slug);
  await bar.locator('input[name="email"], input#email').first().fill(BARTENDER.email);
  await bar.locator('input[name="password"], input#password').first().fill(BARTENDER.newPassword);
  await bar.locator('button[type="submit"]').first().click();
  await bar.waitForTimeout(7000);
  log("  bartender at:", bar.url());
  if (bar.url().includes("/login")) throw new Error("bartender could not sign back in");

  await go(bar, "/app/kitchen", { waitMs: 7000, allowTrouble: true });
  result.bartender = await bar.evaluate((ord) => {
    const cards = Array.from(document.querySelectorAll('[data-testid="kds-ticket-card"]'));
    return {
      url: location.href,
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
      headerLine: document.querySelector("h1")?.parentElement?.innerText?.replace(/\s+/g, " ").trim() ?? null,
      mine: cards
        .filter((c) => (c.innerText || "").includes(ord))
        .map((c) => (c.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200)),
      saysNoActiveStations: /No active stations configured/i.test(document.body.innerText || ""),
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
        (n.textContent || "").trim().slice(0, 120),
      ),
      mentionsSeekh: (document.body.innerText || "").includes("Seekh Kebab"),
      mentionsKarahi: (document.body.innerText || "").includes("Chicken Karahi"),
    };
  }, orderNo);
  log("  bartender board:", JSON.stringify(result.bartender));
  await shot(bar, "08f-bartender-board");

  const scope = await apiGet(bar, "/api/v1/kitchen/kds/stations?branchId=" + (st.recon?.board ? "" : ""));
  result.scopeProbeStatus = scope.status;

  saveState({ final: result });
  log("\n  SUMMARY");
  log("   order:", result.orderNo);
  for (const [k, v] of Object.entries(result.boards)) log(`   ${k}: ${JSON.stringify(v.mine)}`);
  log("   bartender sees:", JSON.stringify(result.bartender.mine));
  log("   bartender told 'No active stations configured':", result.bartender.saysNoActiveStations);
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
