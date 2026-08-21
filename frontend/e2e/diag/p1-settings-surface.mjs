/* PROBE 1 — is there ANY printer surface, for ANY persona, at ANY route? */
import { chromium } from "@playwright/test";
import { login, visit, shot, BASE } from "./printlib.mjs";

const ROUTES = [
  "/app/settings",
  "/app/settings/printers",
  "/app/settings/hardware",
  "/app/settings/receipt",
  "/app/terminals",
  "/app/stations",
  "/settings/appearance",
  "/app/settings/branch",
];

const PERSONAS = ["owner", "admin"];

async function main() {
  const browser = await chromium.launch();
  for (const who of PERSONAS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const page = await ctx.newPage();
    if (!(await login(page, who))) { await ctx.close(); continue; }
    console.log(`\n=== ${who.toUpperCase()} ===`);

    // Sidebar nav inventory — what can this persona actually SEE?
    await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    const nav = await page.evaluate(() => {
      const set = new Set();
      document.querySelectorAll("nav a, aside a, [data-sidebar] a").forEach((a) => {
        const t = (a.textContent || "").trim();
        if (t) set.add(`${t} -> ${a.getAttribute("href")}`);
      });
      return [...set];
    });
    console.log(`  nav items (${nav.length}):`);
    for (const n of nav) console.log("    ", n);
    console.log(`  nav mentions printer/hardware? ${/print|hardware/i.test(nav.join("|"))}`);

    for (const route of ROUTES) {
      const r = await visit(page, route, { settle: 4000 });
      const hasPrinterWord = /printer/i.test(r.body);
      const flags = [
        r.refused ? "REFUSED" : null,
        r.notfound ? "404" : null,
        r.alerts > 0 ? `alert(${r.alerts})` : null,
        r.errorish ? "ERRORTEXT" : null,
      ].filter(Boolean).join(",") || "ok";
      console.log(`  ${route.padEnd(28)} [${flags}] /printer/i=${hasPrinterWord} url=${r.url.replace(BASE, "")}`);
      if (route === "/app/settings" || route === "/app/settings/printers" || route === "/app/terminals") {
        await shot(page, `p1-${who}-${route.replace(/\//g, "_")}`);
      }
      // headings, to prove which screen we are looking at
      if (!r.notfound && !r.refused) {
        const heads = await page.evaluate(() =>
          [...document.querySelectorAll("h1,h2,h3")].map((h) => h.textContent.trim()).filter(Boolean).slice(0, 12));
        console.log(`      headings: ${JSON.stringify(heads)}`);
      }
      await page.waitForTimeout(900); // pace, to stay under the gateway limiter
    }
    await ctx.close();
  }
  await browser.close();
}
main();
