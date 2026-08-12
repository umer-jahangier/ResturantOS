/* B2 re-open, stage 5 on its own: the cashier closes their own drawer, in the browser. */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/B2-reopen");
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(...a);
const R = { steps: [] };
const rec = (k, v) => { R.steps.push({ k, v }); log(`  · ${k}:`, typeof v === "string" ? v : JSON.stringify(v)); };

const WHO = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await ctx.newPage();
page.__net = [];
page.on("response", (r) => {
  const u = r.url();
  if (u.startsWith("http://localhost:8080")) page.__net.push({ m: r.request().method(), s: r.status(), u: u.replace("http://localhost:8080", "") });
});

try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.locator('input[name="email"], input#email').first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(WHO.slug);
  const e = page.locator('input[name="email"], input#email').first();
  const p = page.locator('input[name="password"], input#password').first();
  for (let i = 0; i < 5; i++) {
    await e.fill(WHO.email); await p.fill(WHO.password); await page.waitForTimeout(400);
    if ((await e.inputValue()) === WHO.email && (await p.inputValue()) === WHO.password) break;
  }
  await page.locator('button[type="submit"]').first().click();
  for (let i = 0; i < 30 && page.url().includes("/login"); i++) await page.waitForTimeout(1000);
  rec("signed-in-as", WHO.email);

  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${OUT}/05b-strip-before.png` });
  const strip = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 260));
  rec("till-strip", strip);

  await page.locator("[data-testid=close-till-button]").waitFor({ timeout: 30000 });
  await page.locator("[data-testid=close-till-button]").click();
  await page.waitForTimeout(3000);
  const expected = (await page.locator("[data-testid=close-till-expected]").first().textContent())?.trim();
  rec("expected-cash-on-panel", expected);
  const num = Number((expected || "").replace(/[^0-9.]/g, ""));
  await page.locator("[data-testid=close-till-panel] input[type=number]").fill(num.toFixed(2));
  await page.waitForTimeout(1200);
  const variance = await page.locator("[data-testid=close-till-variance]").count()
    ? (await page.locator("[data-testid=close-till-variance]").first().textContent())?.trim() : null;
  rec("variance-preview", variance);
  await page.screenshot({ path: `${OUT}/05b-close-panel.png` });

  page.__net.length = 0;
  await page.locator("[data-testid=close-till-confirm-button]").click();
  await page.waitForTimeout(8000);
  rec("close-network", page.__net.filter((r) => /\/close$/.test(r.u)));
  await page.screenshot({ path: `${OUT}/05b-after-close.png` });
  rec("screen-after-close", await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 300)));

  // Reload — does it persist?
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(8000);
  rec("screen-after-reload", await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 300)));
  await page.screenshot({ path: `${OUT}/05b-after-reload.png` });

  const tok = await page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
  const sub = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString()).sub;
  const back = await page.evaluate(async ({ t, s }) => {
    const r = await fetch(`http://localhost:8080/api/v1/pos/tills?cashierId=${s}&status=CLOSED`, { headers: { Authorization: `Bearer ${t}` } });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, { t: tok, s: sub });
  const rows = back.body?.data ?? [];
  rec("closed-tills-readback", rows.slice(0, 2).map((x) => ({ id: x.id, status: x.status, expected: x.expectedClosingPaisa, declared: x.declaredClosingPaisa, variance: x.variancePaisa, closedAt: x.closedAt })));
} catch (err) {
  R.fatal = String(err?.stack ?? err);
  log("FATAL", R.fatal);
  await page.screenshot({ path: `${OUT}/05b-fatal.png` }).catch(() => {});
} finally {
  writeFileSync(`${OUT}/close-till.json`, JSON.stringify(R, null, 2));
  await browser.close();
}
