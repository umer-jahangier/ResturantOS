/*
 * DIAGNOSIS ONLY — is the realtime dashboard's "Live" badge telling the truth?
 * Phase 12 UAT test 3 recorded this as a MAJOR failed gap (socket stuck "Reconnecting…").
 * Instruments window.WebSocket before any app code runs and records every url/open/close.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/nlq-reporting";
const BASE = "http://localhost:3000";

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  await ctx.addInitScript(() => {
    window.__ws = [];
    const Real = window.WebSocket;
    window.WebSocket = function (url, protos) {
      const rec = { url: String(url).replace(/token=[^&]+/, "token=<jwt>"), opened: false, closed: null, messages: 0 };
      window.__ws.push(rec);
      const s = protos ? new Real(url, protos) : new Real(url);
      s.addEventListener("open", () => (rec.opened = true));
      s.addEventListener("close", (e) => (rec.closed = `code=${e.code} clean=${e.wasClean}`));
      s.addEventListener("message", () => (rec.messages += 1));
      return s;
    };
    window.WebSocket.prototype = Real.prototype;
    Object.assign(window.WebSocket, Real);
  });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill("floating-terrace");
  await page.locator('input[name="email"]').first().fill("manager@terrace.local");
  await page.locator('input[name="password"]').first().fill("Terrace#Manager1");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3500);

  await page.goto(`${BASE}/app/dashboard/realtime`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(15000);

  const ws = await page.evaluate(() => window.__ws);
  const body = await page.locator("body").innerText();
  const badge = (body.match(/Live|Reconnecting[^\n]*|Offline/g) || []).join(", ");
  console.log("WS sockets opened by the page:");
  console.log(JSON.stringify(ws, null, 2));
  console.log("badge text on screen:", badge);
  await page.screenshot({ path: `${OUT}/15-realtime-ws-probe.png`, fullPage: true });
  await browser.close();
}
main();
