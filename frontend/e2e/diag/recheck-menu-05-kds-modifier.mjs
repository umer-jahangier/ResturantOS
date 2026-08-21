// RECHECK — does the fabricated modifier UUID actually render on a cook's screen?
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const BASE = "http://localhost:3000";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/menu-recheck";
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill("floating-terrace");
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
  log("   login ->", page.url());
}

const ORDER = process.argv[2] ?? "ORD-20260812-0021";

async function main() {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
  await login(page, "kitchen@terrace.local", "Terrace#Kitchen1");
  await page.goto(`${BASE}/app/kitchen`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/R40-kds-landing.png` });
  log("1. kds landing:", await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400)));

  // Drill into the DEFAULT station board if the landing is a station picker
  const link = page.getByRole("link", { name: /DEFAULT|Default|Main|Kitchen/i });
  if (await link.count()) { await link.first().click(); await page.waitForTimeout(5000); }
  await page.screenshot({ path: `${OUT}/R41-kds-board.png` });

  const found = await page.evaluate((o) => {
    const txt = document.body.innerText;
    const idx = txt.indexOf(o);
    return {
      url: location.pathname,
      orderOnScreen: idx >= 0,
      around: idx >= 0 ? txt.slice(Math.max(0, idx - 60), idx + 320).replace(/\s+/g, " ") : null,
      deadbeefOnScreen: /deadbeef-0000-4000-8000-00000000abcd/.test(txt),
      anyUuidOnScreen: (txt.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || []).slice(0, 5),
    };
  }, ORDER);
  log("2. KDS board:", JSON.stringify(found, null, 1));

  // Also try the ticket detail route
  if (found.orderOnScreen) {
    const card = page.getByText(ORDER).first();
    await card.click({ trial: true }).catch(() => {});
    await card.click().catch(() => {});
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${OUT}/R42-kds-ticket-detail.png` });
    log("3. detail:", await page.evaluate(() => ({ url: location.pathname, deadbeef: /deadbeef/.test(document.body.innerText), text: document.body.innerText.replace(/\s+/g, " ").slice(0, 800) })));
  }
  await b.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
