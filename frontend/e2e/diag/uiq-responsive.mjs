/*
 * Stage 3 — responsive (390/768/1440), dark mode, and dialog behaviour at phone width.
 * A dialog that renders off-screen or clips its footer at 390 cannot be completed by a waiter.
 */
import { chromium } from "@playwright/test";
import { login, settle, shot, saveJson, PROBE } from "./uiq-lib.mjs";

const WIDTHS = [
  { w: 390, h: 844, tag: "390" },
  { w: 768, h: 1024, tag: "768" },
  { w: 1440, h: 900, tag: "1440" },
];

const ROUTES = [
  ["dashboard", "/app/dashboard"],
  ["pos", "/app/pos"],
  ["menu-items", "/app/menu/items"],
  ["inv-ingredients", "/app/inventory/ingredients"],
  ["pur-pos", "/app/purchasing/purchase-orders"],
  ["fin-expenses", "/app/finance/expenses"],
  ["hr-employees", "/app/hr/employees"],
  ["users", "/app/users"],
];

// dialogs opened at every width, because a modal is where small screens actually break
const DIALOGS = [
  ["tables-add", "/app/tables", "Add table"],
  ["ingredient-add", "/app/inventory/ingredients", "Add ingredient"],
  ["po-new", "/app/purchasing/purchase-orders", "New Purchase Order"],
  ["employee-new", "/app/hr/employees", "New employee"],
];

const DLG = () => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return { open: false };
  const r = d.getBoundingClientRect();
  const btns = [...d.querySelectorAll("button")];
  const lastBtn = btns.length ? btns[btns.length - 1].getBoundingClientRect() : null;
  return {
    open: true,
    w: Math.round(r.width), h: Math.round(r.height),
    top: Math.round(r.top), bottom: Math.round(r.bottom),
    viewportH: window.innerHeight, viewportW: window.innerWidth,
    clippedTop: r.top < 0 ? Math.round(-r.top) : 0,
    clippedBottom: r.bottom > window.innerHeight ? Math.round(r.bottom - window.innerHeight) : 0,
    widerThanViewport: Math.max(0, Math.round(r.width - window.innerWidth)),
    innerScroll: d.scrollHeight > d.clientHeight + 2,
    // can the primary action actually be reached?
    submitVisible: lastBtn ? lastBtn.bottom <= window.innerHeight && lastBtn.top >= 0 : null,
    fieldCount: d.querySelectorAll("input,select,textarea").length,
  };
};

const browser = await chromium.launch();
const out = { routes: [], dialogs: [], dark: [] };

for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme });
  const page = await ctx.newPage();
  if (!(await login(page, "owner")).ok) { console.log(`LOGIN FAILED (${theme})`); continue; }
  console.log(`\n=== theme=${theme} ===`);
  for (const [name, route] of ROUTES) {
    const st = await settle(page, route, "owner");
    const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    if (isDark !== (theme === "dark")) { console.log(`  !! theme did not apply on ${name}`); }
    const probe = await page.evaluate(PROBE);
    await shot(page, `${name}-${theme}`, "theme");
    out.dark.push({ name, theme, clean: st.clean, isDark, bodyBg: await page.evaluate(() => getComputedStyle(document.body).backgroundColor) });
    console.log(`  ${st.clean ? "OK  " : "FAIL"} ${name.padEnd(16)} dark=${isDark} contrastPairs=n/a fonts=${probe.distinctFontSizes}`);
  }
  await ctx.close();
}

// ---- widths ----
for (const V of WIDTHS) {
  const ctx = await browser.newContext({ viewport: { width: V.w, height: V.h }, colorScheme: "light", hasTouch: V.w < 900, isMobile: V.w < 500 });
  const page = await ctx.newPage();
  if (!(await login(page, "owner")).ok) { console.log(`LOGIN FAILED @${V.tag}`); continue; }
  console.log(`\n=== width ${V.tag} ===`);
  for (const [name, route] of ROUTES) {
    const st = await settle(page, route, "owner");
    const probe = await page.evaluate(PROBE);
    await shot(page, `${name}-${V.tag}`, `w${V.tag}`);
    out.routes.push({ name, width: V.w, clean: st.clean, overflowX: probe.overflowX, worst: probe.widestOverflower, tap: probe.touchTargets, tables: probe.tables });
    console.log(`  ${st.clean ? "OK  " : "FAIL"} ${name.padEnd(16)} overflowX=${String(probe.overflowX).padStart(4)} ` +
      `worst=${probe.widestOverflower ? probe.widestOverflower.over + "px " + probe.widestOverflower.tag : "-"} ` +
      `tapUnder44=${probe.touchTargets.under44}/${probe.touchTargets.n} tables=${probe.tables.n}`);
  }
  for (const [name, route, trigger] of DIALOGS) {
    const st = await settle(page, route, "owner");
    if (!st.clean) { console.log(`  SKIP dialog ${name}`); continue; }
    const btn = page.locator(`button:has-text("${trigger}")`).first();
    if (!(await btn.count())) { console.log(`  SKIP dialog ${name}: no trigger @${V.tag}`); continue; }
    await btn.click().catch(() => {});
    await page.waitForTimeout(1300);
    const d = await page.evaluate(DLG);
    await shot(page, `dlg-${name}-${V.tag}`, `w${V.tag}`);
    out.dialogs.push({ name, width: V.w, ...d });
    console.log(`  DLG ${name.padEnd(16)} ${d.open ? `${d.w}x${d.h} vp=${d.viewportW}x${d.viewportH} clipTop=${d.clippedTop} clipBottom=${d.clippedBottom} wider=${d.widerThanViewport} innerScroll=${d.innerScroll} submitVisible=${d.submitVisible}` : "DID NOT OPEN"}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
  await ctx.close();
}

saveJson("responsive.json", out);
await browser.close();
