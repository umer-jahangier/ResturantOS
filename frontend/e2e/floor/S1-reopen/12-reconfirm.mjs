/*
 * S1 RE-OPEN 12 — another agent restarted pos-service mid-session onto a different jar.
 * Re-confirm the load-bearing facts against whatever is answering NOW, from the screen.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, log, OUT } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const browser = await newBrowser();
const page = await newPage(browser);
const out = {};

async function rowState(name) {
  return page.evaluate((n) => {
    const row = Array.from(document.querySelectorAll('[data-testid="routing-item"]')).find(
      (r) => r.getAttribute("data-item-name") === n,
    );
    if (!row) return null;
    return {
      effective: row.getAttribute("data-effective-station"),
      source: row.getAttribute("data-route-source"),
      text: row.querySelector('[data-testid="routing-item-destination"]')?.textContent?.replace(/\s+/g, " ").trim(),
    };
  }, name);
}

try {
  await login(page, PEOPLE.owner);
  const link = page.locator('a[href="/app/menu/routing"]').first();
  await go(page, "/app/dashboard", { waitMs: 4000 });
  const clickable = await link.count();
  await link.click();
  await page.waitForTimeout(7000);
  const t = await go(page, "/app/menu/routing", { waitMs: 6000 });
  out.page = { clickableFromSidebar: clickable, ...t, url: page.url() };
  out.head = await page.evaluate(() => ({
    h1: document.querySelector("h1")?.textContent?.trim() ?? null,
    summary: document.querySelector('[data-testid="routing-summary"]')?.textContent?.trim() ?? null,
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
  }));
  out.rows = {
    pinacolada: await rowState("Pinacolada"),
    freshLime: await rowState("Fresh Lime"),
    chickenSamosa: await rowState("Chicken Samosa"),
    auditItem: await rowState("Audit Item 52235"),
  };
  log("page:", JSON.stringify(out.page));
  log("head:", JSON.stringify(out.head));
  log("rows:", JSON.stringify(out.rows, null, 1));
  await shot(page, "12a-reconfirm-routing");

  // and the boards still hold my two checks
  await page.close();
  const kp = await newPage(browser);
  await login(kp, PEOPLE.kitchen);
  const boards = {};
  for (const code of ["BAR", "GRILL", "DEFAULT"]) {
    await go(kp, `/app/kitchen/${code}`, { waitMs: 8000, allowTrouble: true });
    boards[code] = await kp.evaluate(() => {
      const txt = document.body.innerText || "";
      return {
        h1: document.querySelector("h1")?.textContent?.trim() ?? null,
        alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim().slice(0, 120)),
        has0415: txt.includes("ORD-20260812-0415"),
        has0418: txt.includes("ORD-20260812-0418"),
      };
    });
    log(`${code}:`, JSON.stringify(boards[code]));
    await shot(kp, `12b-${code.toLowerCase()}`);
  }
  out.boards = boards;
  writeFileSync(`${OUT}/12-reconfirm.json`, JSON.stringify(out, null, 2));
} catch (e) {
  console.error("FAILED:", e.message);
  writeFileSync(`${OUT}/12-reconfirm.json`, JSON.stringify({ ...out, error: e.message }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
