/* Recon: what exists now, before the day starts. Read-only. */
import { newBrowser, newPage, login, PEOPLE, go, apiGet, saveState, log } from "./lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);
await login(page, PEOPLE.owner);

const out = { routes: {}, api: {} };

const routes = [
  "/app/audit",
  "/app/settings/tax",
  "/app/settings/printers",
  "/app/settings/roles",
  "/app/settings/branches",
  "/app/menu/modifiers",
  "/app/menu/items",
  "/app/settings/service-charge",
  "/app/finance/takings",
  "/app/kds",
];
for (const r of routes) {
  const t = await go(page, r, { waitMs: 2500, allowTrouble: true });
  const txt = await page.evaluate(() => (document.body.innerText || "").slice(0, 220).replace(/\s+/g, " "));
  out.routes[r] = { bad: t.bad, url: t.url, head: txt };
  log(`  ${r} -> ${t.bad.length ? t.bad.join(",") : "ok"} :: ${txt.slice(0, 110)}`);
}

const apis = [
  "/api/v1/pos/tax-classes",
  "/api/v1/pos/modifier-groups",
  "/api/v1/pos/tills/active",
  "/api/v1/pos/terminals",
  "/api/v1/menu/items?size=3",
  "/api/v1/audit/events?size=2",
];
for (const a of apis) {
  const r = await apiGet(page, a);
  const b = JSON.stringify(r.body ?? {}).slice(0, 260);
  out.api[a] = { status: r.status, body: b };
  log(`  API ${a} -> ${r.status} ${b.slice(0, 150)}`);
}

// nav entries the owner actually sees
await go(page, "/app", { waitMs: 2500, allowTrouble: true });
out.nav = await page.evaluate(() =>
  Array.from(document.querySelectorAll("nav a, aside a")).map((a) => `${(a.textContent || "").trim()}|${a.getAttribute("href")}`),
);
log("  nav:", out.nav.length, "entries");

saveState({ recon: out });
console.log(JSON.stringify(out.nav, null, 0).slice(0, 3000));
await browser.close();
