// ATTACK 8: silence is not a verdict. Sweep every route in the domain the other agent never
// named — vendors, vendor items/prices, scorecards, order suggestions, analytics, payments,
// coverage, setup — plus the routes it declared 404, to confirm.
import { chromium, newCtx, login, probe, shot, assertSession } from "./lib.mjs";

const persona = process.argv[2] ?? "manager";

const ROUTES = [
  "/app/purchasing", "/app/purchasing/vendors", "/app/purchasing/purchase-orders",
  "/app/purchasing/order-suggestions", "/app/purchasing/invoices",
  "/app/purchasing/payments", "/app/purchasing/analytics",
  "/app/inventory", "/app/inventory/ingredients", "/app/inventory/categories",
  "/app/inventory/recipes", "/app/inventory/coverage", "/app/inventory/stock",
  "/app/inventory/setup",
  // claimed absent by the other agent — reconfirm
  "/app/inventory/wastage", "/app/inventory/valuation", "/app/inventory/movements",
  "/app/inventory/counts", "/app/inventory/transfers", "/app/inventory/expiry",
  "/app/purchasing/goods-receipt", "/app/purchasing/receiving",
];

async function main() {
  const browser = await chromium.launch();
  const { page } = await newCtx(browser, { width: 1440, height: 950 });
  if (!(await login(page, persona))) { console.log("LOGIN FAILED"); process.exit(1); }

  for (const route of ROUTES) {
    let r;
    // The token lives ~15 min. A sweep that outlives it reports every remaining route as empty.
    // Re-authenticate and RE-PROBE rather than filing a logged-out page as evidence.
    for (let tries = 0; tries < 3; tries++) {
      try { r = await probe(page, route); break; }
      catch (e) {
        console.log(`  !! ${route}: ${e.message} — re-authenticating and re-probing`);
        if (!(await login(page, persona))) { console.log("  RE-LOGIN FAILED"); break; }
      }
    }
    if (!r) { console.log(`\n${route}\n  !! unmeasurable`); continue; }
    await assertSession(page, route);
    const dom = await page.evaluate(() => {
      const t = document.querySelector("table");
      return {
        headers: t ? [...t.querySelectorAll("th")].map((x) => x.innerText.trim()) : [],
        rows: t ? t.querySelectorAll("tbody tr").length : 0,
        buttons: [...document.querySelectorAll("button")].map((b) => b.innerText.trim())
          .filter((x) => x && !/Collapse|Search|Floating|^F$|^[A-Z ]{3,}$/.test(x)).slice(0, 10),
        links: [...document.querySelectorAll("main a, table a")].map((a) => a.getAttribute("href"))
          .filter((h) => h && !/^\/app\/(purchasing|inventory)\/?$/.test(h)).slice(0, 6),
      };
    });
    const flag = r.is404 ? "404" : r.denied ? "DENIED" : r.failed ? "ERROR" : r.alerts.length ? "ALERT" : "ok";
    console.log(`\n${route}  [${flag}] attempt=${r.attempt}`);
    console.log(`  h: ${r.h1.slice(0, 3).join(" | ")}`);
    if (r.alerts.length) console.log(`  ALERTS: ${JSON.stringify(r.alerts)}`);
    if (dom.headers.length) console.log(`  cols(${dom.rows} rows): ${JSON.stringify(dom.headers)}`);
    if (dom.buttons.length) console.log(`  buttons: ${JSON.stringify(dom.buttons)}`);
    if (dom.links.length) console.log(`  links: ${JSON.stringify([...new Set(dom.links)])}`);
    if (flag === "ok") console.log(`  text: ${r.text.slice(0, 260).replace(/\n+/g, " | ")}`);
    await shot(page, `sweep-${persona}-${route.replace(/\//g, "_")}`);
  }
  await browser.close();
}
main();
