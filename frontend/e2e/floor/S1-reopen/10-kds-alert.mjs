/*
 * S1 RE-OPEN 10 — the alert I saw on EVERY KDS page as kitchen@terrace.local:
 *   [role="alert"] "Could not load branches. Retry"
 * Which request fails, and is it S1's screen or the app shell? Measured, not guessed.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, log, OUT } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const browser = await newBrowser();
const out = {};

try {
  for (const key of ["kitchen", "cashier", "owner"]) {
    const p = await newPage(browser);
    const failures = [];
    p.on("response", (r) => {
      if (r.url().includes("localhost:8080") && r.status() >= 400) {
        failures.push({ s: r.status(), u: r.url().replace("http://localhost:8080", "") });
      }
    });
    await login(p, PEOPLE[key]);
    const routes = key === "owner" ? ["/app/menu/routing", "/app/kitchen/BAR"] : ["/app/kitchen/BAR", "/app/dashboard"];
    const seen = {};
    for (const route of routes) {
      failures.length = 0;
      await go(p, route, { waitMs: 7000, allowTrouble: true });
      const alerts = await p.evaluate(() =>
        Array.from(document.querySelectorAll('[role="alert"]')).map((n) => (n.textContent || "").trim().slice(0, 140)),
      );
      seen[route] = { alerts, failedRequests: [...failures] };
      log(`${key} ${route}:`, JSON.stringify(seen[route]));
    }
    out[key] = seen;
    await shot(p, `10-${key}`);
    await p.close();
  }
  writeFileSync(`${OUT}/10-kds-alert.json`, JSON.stringify(out, null, 2));
} catch (e) {
  console.error("FAILED:", e.message);
  writeFileSync(`${OUT}/10-kds-alert.json`, JSON.stringify({ ...out, error: e.message }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
