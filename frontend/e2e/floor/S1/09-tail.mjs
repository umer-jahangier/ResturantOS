/*
 * S1 step 9 — the tail of step 8, which lost its execution context to a client-side redirect on
 * the PANTRY1 board. Same order, same personas, one page at a time.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, saveState, loadState, log, BASE } from "./lib.mjs";

const st = loadState();
const BARTENDER = st.bartender;
const ORDER = process.env.ORDER_NO || st.final?.orderNo;
if (!BARTENDER || !ORDER) throw new Error("run 05 and 08 first");
log("  order:", ORDER, "· bartender:", BARTENDER.email);

const browser = await newBrowser();
const out = {};

async function board(page, ord) {
  await page.waitForTimeout(2500);
  return page.evaluate((o) => {
    const cards = Array.from(document.querySelectorAll('[data-testid="kds-ticket-card"]'));
    return {
      url: location.href,
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
      cardCount: cards.length,
      mine: cards
        .filter((c) => (c.innerText || "").includes(o))
        .map((c) => (c.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200)),
      saysNoActiveStations: /No active stations configured/i.test(document.body.innerText || ""),
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
        (n.textContent || "").trim().slice(0, 140),
      ),
      mentionsSeekh: (document.body.innerText || "").includes("Seekh Kebab"),
      mentionsKarahi: (document.body.innerText || "").includes("Chicken Karahi"),
      mentionsPinacolada: (document.body.innerText || "").includes("Pinacolada"),
    };
  }, ord);
}

try {
  // PANTRY1 must NOT carry the kebab any more — the per-item exception moved it off its
  // category's board, which is the half of routing a category-only screen could never express.
  const cook = await newPage(browser);
  await login(cook, PEOPLE.kitchen);
  await go(cook, "/app/kitchen/PANTRY1", { waitMs: 7000, allowTrouble: true });
  out.pantry = await board(cook, ORDER);
  log("  PANTRY1:", JSON.stringify(out.pantry));
  await shot(cook, "09a-pantry1");

  // The bartender, signed in as themselves, on their own scoped screen.
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
  await bar.waitForTimeout(8000);
  log("  bartender landed at:", bar.url());
  if (bar.url().includes("/login")) throw new Error("bartender could not sign back in");

  await go(bar, "/app/kitchen", { waitMs: 8000, allowTrouble: true });
  out.bartender = await board(bar, ORDER);
  log("  bartender:", JSON.stringify(out.bartender));
  await shot(bar, "09b-bartender-board");

  saveState({ tail: { order: ORDER, ...out } });
  log("\n  bartender told 'No active stations configured':", out.bartender.saysNoActiveStations);
  log("  bartender has the drink:", JSON.stringify(out.bartender.mine));
  log("  bartender can see the grill's work:", out.bartender.mentionsSeekh);
  log("  bartender can see the curry:", out.bartender.mentionsKarahi);
} catch (e) {
  console.error("FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
