// (e) LIVE test: kitchen watches the board in one browser while the cashier fires in another.
// No reload on the kitchen side. Does the ticket appear by itself?
import { chromium } from "@playwright/test";
import { login, openAndCheck, shot, BASE } from "./lib-login.mjs";

const browser = await chromium.launch({ headless: true });
const kitchenPage = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const posPage = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();

try {
  // --- kitchen watches DEFAULT ---
  await login(kitchenPage, { email: "kitchen@terrace.local", password: "Terrace#Kitchen1" });
  const k = await openAndCheck(kitchenPage, "/app/kitchen/DEFAULT", { settle: 4000 });
  const before = await kitchenPage.getByTestId("kds-ticket-card").count();
  const liveBadge = /LIVE/.test(k.body) ? "LIVE" : /POLLING/.test(k.body) ? "POLLING" : "?";
  console.log(`kitchen board open. ticket cards BEFORE = ${before}, connection badge = ${liveBadge}`);
  await shot(kitchenPage, "h1-board-before");

  // --- cashier fires ---
  await login(posPage, { email: "cashier@terrace.local", password: "Terrace#Cashier1" });
  await openAndCheck(posPage, "/app/pos", { settle: 3500 });
  const marker = "Mutton Biryani";
  await posPage.getByRole("button").filter({ hasText: new RegExp(marker, "i") }).first().click();
  await posPage.waitForTimeout(800);
  await posPage.getByRole("button").filter({ hasText: /Pinacolada/i }).first().click();
  await posPage.waitForTimeout(800);
  const t0 = Date.now();
  await posPage.getByRole("button", { name: /send to kitchen/i }).first().click();
  console.log("cashier pressed Send to Kitchen");
  await posPage.waitForTimeout(3000);
  await shot(posPage, "h2-pos-sent");

  // --- watch the kitchen board WITHOUT reloading ---
  let appeared = null;
  for (let i = 0; i < 20; i += 1) {
    const n = await kitchenPage.getByTestId("kds-ticket-card").count();
    if (n > before) { appeared = Date.now() - t0; console.log(`  ticket count ${before} -> ${n} after ${appeared}ms (NO RELOAD)`); break; }
    await kitchenPage.waitForTimeout(1000);
  }
  if (appeared === null) console.log("  !! board never grew in 20s without a reload");
  const kText = await kitchenPage.locator("main").innerText();
  console.log("  board now mentions Mutton Biryani:", /Mutton Biryani/.test(kText));
  console.log("  board now mentions Pinacolada:", /Pinacolada/.test(kText));
  console.log("  top of board:", kText.replace(/\n+/g, " | ").slice(0, 400));
  await shot(kitchenPage, "h3-board-after-live");

  // --- did it SPLIT? food and drink on separate tickets? ---
  console.log("\n=== split-ticket check (D-28-04) ===");
  const cards = kitchenPage.getByTestId("kds-ticket-card");
  const n = await cards.count();
  for (let i = 0; i < Math.min(n, 3); i += 1) {
    const t = (await cards.nth(i).innerText()).replace(/\n+/g, " | ");
    console.log(`  card[${i}]: ${t.slice(0, 220)}`);
  }
  // and the BAR board
  const b = await openAndCheck(kitchenPage, "/app/kitchen/BAR", { settle: 3500 });
  console.log("  BAR board tickets:", await kitchenPage.getByTestId("kds-ticket-card").count());
  console.log("  BAR board mentions Pinacolada:", /Pinacolada/.test(b.body));
  await shot(kitchenPage, "h4-bar-board-after");
} catch (err) {
  console.error("FAILED:", err.message);
  await shot(kitchenPage, "zz-live-failure").catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
