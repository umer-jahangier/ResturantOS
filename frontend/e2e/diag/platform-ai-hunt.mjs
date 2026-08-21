/*
 * Could an AI-provider / model picker exist somewhere the tenant persona cannot see?
 * Drive the PLATFORM SuperAdmin console and scan every reachable page for it, plus look
 * for report export / scheduling / NLQ quota admin. Diagnose only.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/nlq-analytics-recheck";
const BASE = "http://localhost:3000";
mkdirSync(OUT, { recursive: true });
const AI = /claude|anthropic|gemini|openai|\bgpt\b|\bllm\b|ai provider|language model|model id|nlq|natural language/i;
const results = [];

const probe = (page) => page.evaluate(() => {
  const t = document.body.innerText;
  return {
    url: location.href,
    text: t,
    notFound: /this page doesn'?t exist|404/i.test(t),
    denied: /access denied|do not have permission/i.test(t),
    links: Array.from(document.querySelectorAll("a")).map((a) => `${a.innerText.replace(/\s+/g, " ").trim()} -> ${a.getAttribute("href")}`).filter((x) => !x.startsWith(" ->")),
    controls: Array.from(document.querySelectorAll("select,button,input")).map((e) => (e.innerText || e.getAttribute("aria-label") || e.name || "").replace(/\s+/g, " ").trim()).filter(Boolean),
  };
});

async function main() {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1600);
  await page.locator('input[name="email"]').first().fill("superadmin@softxlogic.com");
  await page.locator('input[name="password"]').first().fill("Test@123!");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
  console.log("superadmin url:", page.url());
  await page.screenshot({ path: `${OUT}/pa-00-after-login.png`, fullPage: true });

  const seen = new Set();
  const queue = ["/platform/dashboard"];
  while (queue.length && seen.size < 24) {
    const route = queue.shift();
    if (seen.has(route)) continue;
    seen.add(route);
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3200);
    let r = await probe(page);
    if (/couldn'?t load|something went wrong/i.test(r.text)) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);
      r = await probe(page);
      r.retried = true;
    }
    const hit = AI.test(r.text);
    console.log(`[${route}] 404=${r.notFound} denied=${r.denied} aiMention=${hit} retried=${!!r.retried}`);
    if (hit) console.log("   AI CONTEXT:", (r.text.match(new RegExp(`.{0,90}(${AI.source}).{0,90}`, "gi")) || []).slice(0, 5));
    results.push({ route, notFound: r.notFound, denied: r.denied, aiMention: hit, controls: r.controls.slice(0, 30), links: r.links.slice(0, 40), retried: !!r.retried });
    await page.screenshot({ path: `${OUT}/pa-${route.replace(/\//g, "_")}.png`, fullPage: true });
    for (const l of r.links) {
      const href = l.split(" -> ").pop();
      if (href && href.startsWith("/platform") && !seen.has(href)) queue.push(href);
    }
  }

  // explicit guesses
  for (const r of ["/platform/settings", "/platform/ai", "/platform/nlq", "/platform/models", "/platform/integrations", "/platform/tiers", "/platform/usage"]) {
    if (seen.has(r)) continue;
    await page.goto(`${BASE}${r}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2600);
    const p = await probe(page);
    console.log(`[guess ${r}] 404=${p.notFound} denied=${p.denied} aiMention=${AI.test(p.text)}`);
    results.push({ route: r, guess: true, notFound: p.notFound, denied: p.denied, aiMention: AI.test(p.text), controls: p.controls.slice(0, 25) });
  }

  writeFileSync(`${OUT}/platform-ai-hunt.json`, JSON.stringify(results, null, 2));
  await b.close();
}
main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(1); });
