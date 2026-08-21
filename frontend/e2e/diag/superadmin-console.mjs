/**
 * DIAGNOSIS ONLY — SuperAdmin / platform console.
 * Drives the real console in Chromium as superadmin@softxlogic.com and records what
 * a platform operator can and cannot actually do.
 *
 * Run: node e2e/diag/superadmin-console.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/superadmin-platform");
const BASE = "http://localhost:3000";
const PLATFORM = { email: "superadmin@softxlogic.com", password: "Test@123!" };

mkdirSync(OUT, { recursive: true });
const log = [];
function note(...a) {
  const s = a.join(" ");
  console.log(s);
  log.push(s);
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  note("  [shot]", `${name}.png`);
}

/** Retry-aware: an error state must never be mistaken for an empty product. */
async function errorState(page) {
  const alerts = page.locator('[role="alert"]');
  const n = await alerts.count();
  const texts = [];
  for (let i = 0; i < n; i++) texts.push((await alerts.nth(i).innerText()).trim());
  const body = await page.locator("body").innerText();
  const failWords = ["Couldn't load", "Could not load", "Something went wrong", "session expired"];
  const hit = failWords.filter((w) => body.includes(w));
  return { alerts: texts, failWords: hit, bad: texts.length > 0 || hit.length > 0 };
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.locator('input[name="email"], input#email').first().fill(PLATFORM.email);
  await page.locator('input[name="password"], input#password').first().fill(PLATFORM.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  note("after login URL:", page.url());
  return page.url();
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();

  const apiCalls = [];
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/")) apiCalls.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:3000", "").replace("http://localhost:8080", "")}`);
  });
  page.on("console", (m) => {
    if (m.type() === "error") note("  [console.error]", m.text().slice(0, 200));
  });

  // ---------- A. login ----------
  note("\n=== A. SuperAdmin login ===");
  const landed = await login(page);
  await shot(page, "01-after-login");
  note("dashboard heading:", await page.locator("h1").first().innerText().catch(() => "(none)"));
  note("error state:", JSON.stringify(await errorState(page)));

  // ---------- B. what nav exists ----------
  note("\n=== B. Console navigation surface ===");
  const navLinks = await page.locator('nav[aria-label="Platform"] a').allInnerTexts();
  note("platform nav items:", JSON.stringify(navLinks));
  const allLinks = await page.locator("a[href^='/platform']").evaluateAll((els) =>
    [...new Set(els.map((e) => e.getAttribute("href")))],
  );
  note("all /platform links on dashboard:", JSON.stringify(allLinks));
  note("dashboard body text:\n" + (await page.locator("main").innerText()));

  // ---------- C. reload survival ----------
  note("\n=== C. Does the platform session survive a reload / deep link? ===");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  note("URL after reload:", page.url());
  note("reload error state:", JSON.stringify(await errorState(page)));
  await shot(page, "02-after-reload");

  // must sign back in, client-side nav only from here
  if (page.url().includes("/login")) {
    note("!! platform session did NOT survive reload — signing back in");
    await login(page);
  }

  // ---------- D. tenants list ----------
  note("\n=== D. Tenant list ===");
  await page.locator('nav[aria-label="Platform"] a[href="/platform/tenants"]').click();
  await page.waitForTimeout(3500);
  note("URL:", page.url());
  let es = await errorState(page);
  if (es.bad) {
    note("!! error state on tenants, RETRYING");
    await page.waitForTimeout(3000);
    es = await errorState(page);
  }
  note("tenants error state:", JSON.stringify(es));
  await shot(page, "03-tenants-list");
  note("tenants main text:\n" + (await page.locator("main").innerText()).slice(0, 3000));

  // controls present on the list
  const btns = await page.locator("main button").allInnerTexts();
  note("buttons on tenant list:", JSON.stringify(btns));

  // ---------- E. create tenant dialog ----------
  note("\n=== E. Create tenant ===");
  const createBtn = page.locator("main button", { hasText: /new tenant|create tenant|add tenant/i }).first();
  if (await createBtn.count()) {
    await createBtn.click();
    await page.waitForTimeout(1500);
    const dlg = page.locator('[role="dialog"]').first();
    const box = await dlg.boundingBox().catch(() => null);
    note("dialog bounding box:", JSON.stringify(box));
    await shot(page, "04-create-tenant-dialog");
    const fields = await dlg.locator("input, select, textarea").evaluateAll((els) =>
      els.map((e) => `${e.tagName}:${e.getAttribute("name") || e.getAttribute("id") || "?"}:${e.getAttribute("type") || ""}`),
    );
    note("create-tenant fields:", JSON.stringify(fields));
    note("dialog text:\n" + (await dlg.innerText()));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  } else {
    note("!! no create-tenant button found on /platform/tenants");
  }

  // ---------- F. tenant detail ----------
  note("\n=== F. Tenant detail ===");
  const firstTenant = page.locator("main a[href^='/platform/tenants/']").first();
  const href = await firstTenant.getAttribute("href").catch(() => null);
  note("opening tenant:", href);
  if (href) {
    await firstTenant.click();
    await page.waitForTimeout(4000);
    let d = await errorState(page);
    if (d.bad) {
      note("!! error on tenant detail, RETRYING");
      await page.waitForTimeout(3500);
      d = await errorState(page);
    }
    note("tenant detail error state:", JSON.stringify(d));
    await shot(page, "05-tenant-detail");
    note("tenant detail text:\n" + (await page.locator("main").innerText()).slice(0, 6000));
    const dbtns = await page.locator("main button").allInnerTexts();
    note("buttons on tenant detail:", JSON.stringify(dbtns));
    const tabs = await page.locator('[role="tab"]').allInnerTexts();
    note("tabs:", JSON.stringify(tabs));
  }

  writeFileSync(`${OUT}/api-calls.txt`, [...new Set(apiCalls)].join("\n"));
  writeFileSync(`${OUT}/run-log.txt`, log.join("\n"));
  note("\n=== API calls observed ===\n" + [...new Set(apiCalls)].join("\n"));

  await browser.close();
}

main().catch(async (e) => {
  console.error("FATAL", e);
  writeFileSync(`${OUT}/run-log.txt`, log.join("\n") + "\nFATAL " + e.message);
  process.exit(1);
});
