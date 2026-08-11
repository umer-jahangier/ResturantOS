/**
 * Phase 38 audit — interaction surfaces that a route screenshot cannot reach:
 * the POS Floor View and Order Management tabs, the command palette, a create dialog,
 * a destructive action, and toast/confirmation behaviour.
 *
 * Run: node e2e/audit-38-interactions.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/phases/38-erp-design-transformation/evidence");
const BASE = "http://localhost:3000";
const MANAGER = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };

async function login(page, { slug, email, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const sf = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (slug && (await sf.count())) await sf.first().fill(slug);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
  return !page.url().includes("/login");
}

async function shot(page, name) {
  const f = `${OUT}/shots/${name}.png`;
  mkdirSync(dirname(f), { recursive: true });
  await page.screenshot({ path: f, fullPage: false });
}

const DIALOG_PROBE = () => {
  const d = document.querySelector('[role="dialog"], [data-slot="dialog-content"]');
  if (!d) return { present: false };
  const cs = getComputedStyle(d);
  const inputs = Array.from(d.querySelectorAll("input,select,textarea"));
  const overlay = document.querySelector('[data-slot="dialog-overlay"]');
  return {
    present: true,
    role: d.getAttribute("role"),
    ariaModal: d.getAttribute("aria-modal"),
    labelled: !!(d.getAttribute("aria-labelledby") || d.getAttribute("aria-label")),
    described: !!d.getAttribute("aria-describedby"),
    width: Math.round(d.getBoundingClientRect().width),
    height: Math.round(d.getBoundingClientRect().height),
    radius: cs.borderRadius,
    shadow: cs.boxShadow.slice(0, 90),
    overlayBackdrop: overlay ? getComputedStyle(overlay).backdropFilter : "no-overlay",
    inputCount: inputs.length,
    inputsWithoutLabel: inputs.filter((i) => i.type !== "hidden" && !(i.labels && i.labels.length) && !i.getAttribute("aria-label")).map((i) => i.name || i.type),
    placeholderOnlyLabels: inputs.filter((i) => !(i.labels && i.labels.length) && !!i.placeholder).map((i) => i.placeholder),
    focusInside: d.contains(document.activeElement),
    activeElement: document.activeElement ? document.activeElement.tagName + "." + String(document.activeElement.className).slice(0, 30) : null,
    nativeSelects: d.querySelectorAll("select").length,
    requiredMarked: Array.from(d.querySelectorAll("label")).filter((l) => /\*|required/i.test(l.textContent || "")).length,
  };
};

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await ctx.newPage();
  const out = {};
  let li=false; for(let a=0;a<5&&!li;a++){ li=await login(page, MANAGER); if(!li){console.log("login attempt "+(a+1)+" failed, retrying"); await page.waitForTimeout(4000);} } if(!li){console.log("LOGIN FAILED after 5"); process.exit(1);}

  // ── POS tabs (Floor View, Order Management) ────────────────────────────────
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  for (const tab of ["Floor View", "Order Management"]) {
    const t = page.getByRole("tab", { name: tab }).or(page.getByRole("button", { name: tab })).or(page.getByText(tab, { exact: true }));
    if (await t.count()) {
      await t.first().click();
      await page.waitForTimeout(3500);
      await shot(page, `pos-${tab.toLowerCase().replace(/ /g, "-")}-desktop-light`);
      console.log(`captured POS ${tab}`);
    } else console.log(`POS tab NOT FOUND: ${tab}`);
  }

  // ── Command palette (⌘K) ───────────────────────────────────────────────────
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await page.keyboard.press("Meta+k");
  await page.waitForTimeout(1500);
  out.commandPalette = await page.evaluate(DIALOG_PROBE);
  if (out.commandPalette.present) {
    await shot(page, "command-palette-desktop-light");
    await page.keyboard.type("ord");
    await page.waitForTimeout(1200);
    out.commandPaletteResults = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return d ? { text: d.innerText.slice(0, 400), items: d.querySelectorAll('[role="option"], [cmdk-item]').length } : null;
    });
    await shot(page, "command-palette-query-desktop-light");
  }
  console.log("command palette:", JSON.stringify(out.commandPalette).slice(0, 200));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // ── A create dialog: New Purchase Order ────────────────────────────────────
  await page.goto(`${BASE}/app/purchasing/purchase-orders`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const btn = page.getByRole("button", { name: /new purchase order/i });
  if (await btn.count()) {
    await btn.first().click();
    await page.waitForTimeout(2000);
    out.poDialog = await page.evaluate(DIALOG_PROBE);
    await shot(page, "dialog-new-po-desktop-light");
    console.log("PO dialog:", JSON.stringify(out.poDialog));
    await page.keyboard.press("Escape");
  } else console.log("New Purchase Order button NOT FOUND");

  // ── Add table dialog (a simpler form) + destructive menu ───────────────────
  await page.goto(`${BASE}/app/tables`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const addT = page.getByRole("button", { name: /add table/i });
  if (await addT.count()) {
    await addT.first().click();
    await page.waitForTimeout(1500);
    out.tableDialog = await page.evaluate(DIALOG_PROBE);
    await shot(page, "dialog-add-table-desktop-light");
    console.log("table dialog:", JSON.stringify(out.tableDialog));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  }
  const rowMenu = page.getByRole("button", { name: /more|actions|⋯/i });
  if (await rowMenu.count()) {
    await rowMenu.first().click();
    await page.waitForTimeout(1200);
    out.rowMenu = await page.evaluate(() => {
      const m = document.querySelector('[role="menu"]');
      return m ? { items: Array.from(m.querySelectorAll('[role="menuitem"]')).map((i) => (i.textContent || "").trim()) } : { items: [] };
    });
    await shot(page, "row-actions-menu-desktop-light");
    console.log("row menu:", JSON.stringify(out.rowMenu));
    await page.keyboard.press("Escape");
  }

  // ── Keyboard focus visibility on the PO table ──────────────────────────────
  await page.goto(`${BASE}/app/purchasing/purchase-orders`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const focusTrail = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(120);
    focusTrail.push(await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return { tag: "BODY" };
      const cs = getComputedStyle(a);
      const r = a.getBoundingClientRect();
      return {
        tag: a.tagName,
        text: (a.textContent || "").trim().slice(0, 28),
        outline: cs.outlineWidth + " " + cs.outlineStyle,
        inView: r.top >= 0 && r.bottom <= window.innerHeight,
        size: `${Math.round(r.width)}x${Math.round(r.height)}`,
      };
    }));
  }
  out.focusTrail = focusTrail;
  await shot(page, "keyboard-focus-po-desktop-light");
  console.log("focus trail:", JSON.stringify(focusTrail.slice(0, 8)));

  writeFileSync(`${OUT}/audit-interactions.json`, JSON.stringify(out, null, 2));
  await browser.close();
  console.log("\ninteractions →", OUT);
}

main().catch((e) => { console.error(e); process.exit(1); });
