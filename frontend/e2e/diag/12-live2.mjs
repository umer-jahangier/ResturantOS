// (e) LIVE test, single manager session, two tabs: watch the board in tab B while tab A fires.
import { chromium } from "@playwright/test";
import { login, openAndCheck, shot, BASE } from "./lib-login.mjs";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const posPage = await ctx.newPage();

try {
  await login(posPage, { email: "manager@terrace.local", password: "Terrace#Manager1" });
  console.log("manager signed in");

  const boardPage = await ctx.newPage();
  const k = await openAndCheck(boardPage, "/app/kitchen/DEFAULT", { settle: 6000 });
  console.log("board h1:", k.h1, "| denied:", k.denied, "| failed:", k.failed);
  const before = await boardPage.getByTestId("kds-ticket-card").count();
  const badge = /\bLIVE\b/.test(k.body) ? "LIVE" : /POLLING/.test(k.body) ? "POLLING" : "?";
  console.log(`ticket cards BEFORE = ${before}, connection badge = ${badge}`);
  await shot(boardPage, "h1-board-before");

  const p = await openAndCheck(posPage, "/app/pos", { settle: 5000 });
  console.log("pos h1:", p.h1, "| denied:", p.denied, "| failed:", p.failed);
  const names = await posPage.getByTestId("menu-grid").locator("button").allInnerTexts().catch(() => []);
  console.log("menu grid items:", JSON.stringify(names.map((n) => n.split("\n")[0])));
  if (!names.length) { console.log("NO MENU GRID — pos body:", p.body.replace(/\n+/g, " | ").slice(0, 500)); throw new Error("no menu grid"); }

  await posPage.getByTestId("menu-grid").getByRole("button").filter({ hasText: /Mutton Biryani/i }).first().click();
  await posPage.waitForTimeout(700);
  await posPage.getByTestId("menu-grid").getByRole("button").filter({ hasText: /Pinacolada/i }).first().click();
  await posPage.waitForTimeout(700);
  await shot(posPage, "h2-cart");

  const t0 = Date.now();
  await posPage.getByRole("button", { name: /send to kitchen/i }).first().click();
  console.log("pressed Send to Kitchen");

  let appeared = null;
  for (let i = 0; i < 25; i += 1) {
    const n = await boardPage.getByTestId("kds-ticket-card").count().catch(() => before);
    if (n > before) { appeared = Date.now() - t0; console.log(`  cards ${before} -> ${n} after ${appeared}ms, NO RELOAD`); break; }
    await boardPage.waitForTimeout(1000);
  }
  if (appeared === null) console.log("  !! board did not grow within 25s without a reload");

  const kText = await boardPage.locator("main").innerText();
  console.log("  board mentions Mutton Biryani:", /Mutton Biryani/.test(kText));
  console.log("  board mentions Pinacolada:", /Pinacolada/.test(kText));
  await shot(boardPage, "h3-board-after-live");

  console.log("\n=== split-ticket check (D-28-04): is the drink on its OWN ticket? ===");
  const cards = boardPage.getByTestId("kds-ticket-card");
  for (let i = 0; i < Math.min(await cards.count(), 3); i += 1) {
    console.log(`  card[${i}]: ${(await cards.nth(i).innerText()).replace(/\n+/g, " | ").slice(0, 240)}`);
  }
  const b = await openAndCheck(boardPage, "/app/kitchen/BAR", { settle: 4000 });
  console.log("  BAR board cards:", await boardPage.getByTestId("kds-ticket-card").count());
  console.log("  BAR board mentions Pinacolada:", /Pinacolada/.test(b.body));
  await shot(boardPage, "h4-bar-board-after");
} catch (err) {
  console.error("FAILED:", err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
