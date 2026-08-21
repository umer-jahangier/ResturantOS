// RECHECK (adversarial) — menu/products/images/modifiers/recipes, admin half.
// Drives the real UI as manager@terrace.local (holds pos.menu.manage). Read-mostly;
// creates one category + one item, then deactivates the item at the end.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000";
const OUT = "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/menu-recheck";
const IMG = "/private/tmp/claude-501/-Users-muhammadumer-Documents-Projects-ResturantOS/b8e6f92e-7d80-4d4f-b270-4f05a9458825/scratchpad/dish.png";
const STAMP = String(Date.now()).slice(-6);
mkdirSync(OUT, { recursive: true });

const log = (...a) => console.log(...a);

async function shot(page, n) {
  await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
  log("   shot", n);
}

async function health(page, label) {
  // A page in an error state photographs like an empty product. Retry once, and SAY SO.
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.waitForTimeout(2500);
    const info = await page.evaluate(() => {
      const alerts = [...document.querySelectorAll('[role="alert"]')]
        .map((e) => e.textContent.trim())
        .filter(Boolean);
      const body = document.body.innerText;
      return {
        alerts,
        bad: /Couldn.t load|Access denied|Something went wrong|doesn.t exist|Unauthorized/i.test(body),
        snippet: body.slice(0, 200).replace(/\s+/g, " "),
      };
    });
    if (!info.bad && info.alerts.length === 0) return { ok: true, attempt, ...info };
    if (attempt === 1) {
      log(`   !! ${label} looked unhealthy on attempt 1 (${JSON.stringify(info.alerts)} bad=${info.bad}) — reloading`);
      await page.reload({ waitUntil: "domcontentloaded" });
      continue;
    }
    return { ok: false, attempt, ...info };
  }
}

async function login(page, { slug, email, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slugField = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (slug && (await slugField.count())) await slugField.first().fill(slug);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  log("   after login url:", page.url());
  return !page.url().includes("/login");
}

/** Enumerate every form control actually rendered inside the open dialog. */
async function dialogFields(page) {
  return page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    const ctrl = [...d.querySelectorAll("input,select,textarea")].map((e) => ({
      tag: e.tagName.toLowerCase(),
      type: e.type || null,
      name: e.name || null,
      aria: e.getAttribute("aria-label"),
      placeholder: e.placeholder || null,
    }));
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      controls: ctrl,
      labels: [...d.querySelectorAll("label")].map((l) => l.textContent.trim()).filter(Boolean),
      text: d.innerText.replace(/\s+/g, " ").slice(0, 400),
    };
  });
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const netFail = [];
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().includes("/api/")) netFail.push(`${r.status()} ${r.url()}`);
  });

  if (!(await login(page, { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" }))) {
    log("LOGIN FAILED"); await browser.close(); return;
  }

  // ---------------------------------------------------------------- 1. menu items page
  await page.goto(`${BASE}/app/menu/items`, { waitUntil: "domcontentloaded" });
  const h1 = await health(page, "/app/menu/items");
  log("1. /app/menu/items health:", JSON.stringify(h1));
  await shot(page, "R01-menu-items");

  // ---------------------------------------------------------------- 2. Add category
  await page.getByRole("button", { name: "Add category", exact: true }).first().click();
  await page.waitForTimeout(1200);
  const catDlg = await dialogFields(page);
  log("2. category dialog:", JSON.stringify(catDlg));
  await shot(page, "R02-category-dialog");
  const CAT = `Recheck Cat ${STAMP}`;
  const nameIn = page.locator('[role="dialog"] input').first();
  await nameIn.fill(CAT);
  await page.locator('[role="dialog"] button[type="submit"], [role="dialog"] button:has-text("Add category"), [role="dialog"] button:has-text("Save")').last().click();
  await page.waitForTimeout(3000);
  await shot(page, "R03-after-category");

  // PERSISTENCE: hard reload, not just optimistic cache
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const catPersists = await page.evaluate((c) => document.body.innerText.includes(c), CAT);
  log(`2b. category "${CAT}" survives reload:`, catPersists);

  // ---------------------------------------------------------------- 3. Add item + image
  const group = page.locator(`[role="group"][aria-label="${CAT} category"]`);
  await group.getByRole("button", { name: "Add item" }).click();
  await page.waitForTimeout(1500);
  const itemDlg = await dialogFields(page);
  log("3. item dialog:", JSON.stringify(itemDlg));
  await shot(page, "R04-item-dialog");

  const ITEM = `Recheck Dish ${STAMP}`;
  await page.locator('[role="dialog"] input[placeholder="Chicken Karahi"]').fill(ITEM);
  await page.locator('[role="dialog"] input[placeholder="Optional"]').fill("adversarial recheck");
  await page.locator('[role="dialog"] input[placeholder="450"]').fill("911");
  const fileIn = page.locator('[role="dialog"] input[type="file"]');
  log("3b. file inputs in dialog:", await fileIn.count());
  if (await fileIn.count()) {
    await fileIn.first().setInputFiles(IMG);
    await page.waitForTimeout(4000);
    const afterUpload = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return { imgs: d.querySelectorAll("img").length, text: d.innerText.replace(/\s+/g, " ").slice(0, 300) };
    });
    log("3c. dialog after upload:", JSON.stringify(afterUpload));
    await shot(page, "R05-item-dialog-uploaded");
  }
  await page.locator('[role="dialog"] button:has-text("Add item")').last().click();
  await page.waitForTimeout(3500);
  await shot(page, "R06-after-item");

  // PERSISTENCE: reload and look for the row + a real <img> whose src is a file URL
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const rowState = await page.evaluate((n) => {
    const rows = [...document.querySelectorAll("div")].filter((d) => d.textContent.trim().startsWith(n) && d.querySelector("img,svg"));
    const imgs = [...document.querySelectorAll("img")].map((i) => ({ src: i.src, w: i.naturalWidth, h: i.naturalHeight, complete: i.complete }));
    return { present: document.body.innerText.includes(n), rowCount: rows.length, imgs };
  }, ITEM);
  log("3d. after reload:", JSON.stringify(rowState));
  await shot(page, "R07-list-persisted");

  // ---------------------------------------------------------------- 4. item action menu (Delete?)
  await page.getByRole("button", { name: `Actions for ${ITEM}` }).click();
  await page.waitForTimeout(900);
  const menuItems = await page.evaluate(() =>
    [...document.querySelectorAll('[role="menuitem"]')].map((e) => e.textContent.trim()));
  log("4. item action menu options:", JSON.stringify(menuItems));
  await shot(page, "R08-item-actions");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // ---------------------------------------------------------------- 5. edit dialog round-trip
  await page.getByRole("button", { name: `Actions for ${ITEM}` }).click();
  await page.waitForTimeout(700);
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.waitForTimeout(1800);
  const editDlg = await dialogFields(page);
  const editImgs = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return [...d.querySelectorAll("img")].map((i) => ({ src: i.src.slice(0, 90), nw: i.naturalWidth }));
  });
  log("5. edit dialog:", JSON.stringify(editDlg));
  log("5b. edit dialog images:", JSON.stringify(editImgs));
  await shot(page, "R09-edit-dialog");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // ---------------------------------------------------------------- 6. hunt for modifier/variant/combo screens
  for (const route of [
    "/app/menu", "/app/menu/modifiers", "/app/menu/modifier-groups", "/app/menu/variants",
    "/app/menu/combos", "/app/menu/options", "/app/menu/pricing", "/app/menu/categories",
    "/app/settings/menu", "/app/menu/engineering",
  ]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const t = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 130));
    log(`6. ${route} -> ${page.url().replace(BASE, "")} :: ${t}`);
  }

  // ---------------------------------------------------------------- 7. sidebar: what does Menu actually offer
  await page.goto(`${BASE}/app/menu/items`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const nav = await page.evaluate(() =>
    [...document.querySelectorAll("nav a, aside a")].map((a) => `${a.textContent.trim()} -> ${a.getAttribute("href")}`));
  log("7. sidebar links:", JSON.stringify(nav, null, 0));

  log("NETFAIL:", JSON.stringify(netFail.slice(0, 20)));
  log(`CREATED: category="${CAT}" item="${ITEM}"`);
  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
