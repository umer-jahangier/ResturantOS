/* DIAGNOSIS part 5 — count the tiles the cashier can actually see vs the tenant's real menu. */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/menu-management";
const BASE = "http://localhost:3000";
const log = []; const say = (...a) => { const s = a.join(" "); console.log(s); log.push(s); };
async function main() {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1100 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(1500);
  const s = p.locator('input[name="tenantSlug"], input#tenantSlug'); if (await s.count()) await s.first().fill("floating-terrace");
  await p.locator('input[name="email"]').first().fill("cashier@terrace.local");
  await p.locator('input[name="password"]').first().fill("Terrace#Cashier1");
  await p.locator('button[type="submit"]').first().click(); await p.waitForTimeout(6000);
  await p.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" }); await p.waitForTimeout(10000);
  const txt = await p.locator("body").innerText();
  const probes = (txt.match(/ZZPAGE Probe \d+/g) || []);
  say("ZZPAGE probes visible at the till: " + probes.length + " of 15 created -> " + JSON.stringify(probes));
  const tiles = await p.evaluate(() => {
    const m = document.body.innerText.match(/Rs\s[\d,]+\.\d\d/g) || [];
    return m.length;
  });
  say("price labels rendered on the grid ≈ " + tiles);
  say("grid shows 'Seekh Kebab' (alphabetically last real dish) = " + txt.includes("Seekh Kebab"));
  mkdirSync(OUT, { recursive: true });
  await p.screenshot({ path: `${OUT}/50-pos-truncated-menu.png`, fullPage: true });
  say("shot: 50-pos-truncated-menu.png");
  writeFileSync(`${OUT}/RUN-LOG-5.txt`, log.join("\n"));
  await b.close();
}
main();
