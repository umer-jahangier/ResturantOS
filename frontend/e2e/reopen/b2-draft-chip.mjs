/* Is the DRAFT half of the B2 fix reachable by a real cashier? */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/B2-reopen");
mkdirSync(OUT, { recursive: true });
const R = {};
const rec = (k, v) => { R[k] = v; console.log(`  · ${k}:`, typeof v === "string" ? v : JSON.stringify(v)); };
const WHO = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
try {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.locator('input#email, input[name=email]').first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(2500);
  const s = page.locator('input#tenantSlug, input[name=tenantSlug]');
  if (await s.count()) await s.first().fill(WHO.slug);
  const e = page.locator('input#email, input[name=email]').first();
  const p = page.locator('input#password, input[name=password]').first();
  for (let i = 0; i < 5; i++) {
    await e.fill(WHO.email); await p.fill(WHO.password); await page.waitForTimeout(400);
    if ((await e.inputValue()) === WHO.email) break;
  }
  await page.locator('button[type=submit]').first().click();
  for (let i = 0; i < 30 && page.url().includes("/login"); i++) await page.waitForTimeout(1000);

  let tok = null;
  for (let i = 0; i < 8 && !tok; i++) {
    tok = await page.evaluate(async () => {
      const r = await fetch("http://localhost:8080/api/v1/auth/refresh", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json().catch(() => null); return j?.accessToken ?? j?.data?.accessToken ?? null;
    });
    if (!tok) await page.waitForTimeout(4000);
  }
  if (!tok) throw new Error("could not mint a bearer from the tab's own session");
  const branch = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString()).branch_id;
  const drafts = await page.evaluate(async ({ t, b }) => {
    const r = await fetch(`http://localhost:8080/api/v1/pos/orders?branchId=${b}&status=DRAFT&size=20`, { headers: { Authorization: `Bearer ${t}` } });
    const j = await r.json().catch(() => null);
    return (j?.data ?? []).map((o) => ({ orderNo: o.orderNo, id: o.orderId ?? o.id, status: o.status }));
  }, { t: tok, b: branch });
  rec("server-has-drafts", drafts.length);
  rec("their-order-numbers", drafts.slice(0, 5).map((d) => d.orderNo));

  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(8000);
  const tab = page.getByText("Order Management", { exact: true });
  try {
    await tab.waitFor({ timeout: 60000 });
  } catch {
    await page.screenshot({ path: `${OUT}/06-no-tabs.png` });
    rec("pos-page-said", await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400)));
    throw new Error("POS tabs never rendered");
  }
  await tab.click();
  await page.waitForTimeout(5000);
  await page.locator("[data-testid=status-filter-DRAFT]").click();
  await page.waitForTimeout(6000);
  const rows = await page.locator('[data-testid^="open-order-"]').count();
  const cancels = await page.locator('[data-testid^="cancel-draft-"]').count();
  const body = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  rec("draft-chip-rows", rows);
  rec("cancel-draft-controls", cancels);
  rec("empty-copy", (body.match(/No [a-z ]*orders[^.]*\./i) || [])[0] ?? body.slice(body.indexOf("Draft"), body.indexOf("Draft") + 260));
  await page.screenshot({ path: `${OUT}/06-draft-chip.png` });
} catch (err) {
  R.fatal = String(err?.stack ?? err);
  console.log("FATAL", R.fatal);
  await page.screenshot({ path: `${OUT}/06-fatal.png` }).catch(() => {});
} finally {
  writeFileSync(`${OUT}/draft-chip.json`, JSON.stringify(R, null, 2));
  await browser.close();
}
