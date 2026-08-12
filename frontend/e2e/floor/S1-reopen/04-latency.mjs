/*
 * S1 RE-OPEN 04 — is "the row did not move" a stale screen or a slow refetch?
 * Poll the row for 45s after a save, and time the GET the screen depends on.
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
      selected: row.querySelector('[data-testid="item-station-select"]')?.selectedOptions?.[0]?.textContent,
    };
  }, name);
}

try {
  await login(page, PEOPLE.owner);

  // time every routing GET
  const timings = [];
  page.on("request", (r) => {
    if (r.url().includes("/pos/menu/routing")) r.__t0 = Date.now();
  });
  page.on("response", async (r) => {
    if (r.url().includes("/pos/menu/routing")) {
      const t0 = r.request().__t0;
      timings.push({ status: r.status(), ms: t0 ? Date.now() - t0 : null });
    }
  });

  const t = await go(page, "/app/menu/routing", { waitMs: 8000 });
  log("page:", JSON.stringify(t));
  log("initial GET timings:", JSON.stringify(timings));
  out.initialTimings = [...timings];

  // Chicken Samosa is currently ITEM->GRILL (set in step 03). Clear it and poll.
  const before = await rowState("Chicken Samosa");
  log("before clear:", JSON.stringify(before));
  timings.length = 0;

  const t0 = Date.now();
  await page
    .locator('[data-testid="routing-item"][data-item-name="Chicken Samosa"] [data-testid="item-station-select"]')
    .selectOption({ label: "Follow category — Cold prep (PANTRY1)" });

  const trail = [];
  let settledAt = null;
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(1000);
    const s = await rowState("Chicken Samosa");
    trail.push({ sec: i + 1, ...s });
    if (s && s.source === "CATEGORY" && settledAt === null) {
      settledAt = Date.now() - t0;
      break;
    }
  }
  log("clear trail:", JSON.stringify(trail.filter((x, i) => i < 3 || i % 5 === 0 || i === trail.length - 1)));
  log("row settled after ms:", settledAt);
  log("refetch timings:", JSON.stringify(timings));
  out.clearTrail = trail;
  out.settledAfterMs = settledAt;
  out.refetchTimings = [...timings];
  await shot(page, "04a-after-clear-poll");

  // put it back to GRILL and poll again
  timings.length = 0;
  const t1 = Date.now();
  await page
    .locator('[data-testid="routing-item"][data-item-name="Chicken Samosa"] [data-testid="item-station-select"]')
    .selectOption({ label: "Hot line (GRILL)" });
  let settled2 = null;
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(1000);
    const s = await rowState("Chicken Samosa");
    if (s && s.source === "ITEM") {
      settled2 = Date.now() - t1;
      break;
    }
  }
  log("re-set settled after ms:", settled2, "timings:", JSON.stringify(timings));
  out.reSetSettledMs = settled2;
  out.reSetTimings = [...timings];
  await shot(page, "04b-after-set-poll");

  writeFileSync(`${OUT}/04-latency.json`, JSON.stringify(out, null, 2));
} catch (e) {
  console.error("FAILED:", e.message);
  writeFileSync(`${OUT}/04-latency.json`, JSON.stringify({ ...out, error: e.message }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
