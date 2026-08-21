/* PROBE 1b — OWNER only, slow, with auth watching. Is there a printer surface in settings? */
import { chromium } from "@playwright/test";
import { login, visit, shot, watchAuth, BASE } from "./printlib.mjs";

const ROUTES = [
  "/app/settings", "/app/settings/printers", "/app/settings/hardware",
  "/app/terminals", "/app/stations",
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
watchAuth(page, "[owner]");
if (!(await login(page, "owner"))) { console.log("ABORT: owner login failed"); await browser.close(); process.exit(1); }
console.log("signed in as OWNER, url:", page.url());

// Prove the persona really is privileged — not an access-denied audit.
await page.goto(`${BASE}/app/settings`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
const settingsBody = await page.locator("body").innerText();
console.log("--- /app/settings body (owner) ---");
console.log(settingsBody.slice(0, 1200));
console.log("--- refusal? ", /Access denied|do not have permission/i.test(settingsBody));
console.log("--- /printer/i on settings:", /printer/i.test(settingsBody));
await shot(page, "p1b-owner-settings");

for (const route of ROUTES) {
  const r = await visit(page, route, { settle: 5000, retries: 2 });
  console.log(`\n${route} -> ${r.url.replace(BASE, "")} refused=${r.refused} 404=${r.notfound} alerts=${r.alerts} printerWord=${/printer/i.test(r.body)}`);
  const heads = await page.evaluate(() => [...document.querySelectorAll("h1,h2,h3")].map((h) => h.textContent.trim()).filter(Boolean).slice(0, 10));
  console.log("   headings:", JSON.stringify(heads));
  await shot(page, `p1b-owner-${route.replace(/\//g, "_")}`);
  await page.waitForTimeout(2500);
}

// Open the terminal create dialog and enumerate its fields — printerRef exists on the API.
console.log("\n=== POS Terminal form: does it expose a printer field? ===");
await page.goto(`${BASE}/app/terminals`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
const btns = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean));
console.log("buttons:", JSON.stringify(btns.slice(0, 20)));
const addBtn = page.locator('button:has-text("Add"), button:has-text("New"), button:has-text("Create")').first();
if (await addBtn.count()) {
  await addBtn.click();
  await page.waitForTimeout(2500);
  const dlg = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return {
      width: Math.round(r.width), height: Math.round(r.height),
      labels: [...d.querySelectorAll("label")].map((l) => l.textContent.trim()),
      inputs: [...d.querySelectorAll("input,select,textarea")].map((i) => i.name || i.id || i.tagName),
      text: (d.textContent || "").slice(0, 600),
    };
  });
  console.log("terminal dialog:", JSON.stringify(dlg, null, 1));
  await shot(page, "p1b-owner-terminal-dialog");
}
await browser.close();
