/* DAY 2 — step 2: SERVICE. Dine-in check for a table, several items, one WITH a modifier.
 * Fire it. Then a takeaway. Then a late add. */
import { PEOPLE, newBrowser, newPage, go, shot, saveState, loadState, finding, apiGet, log, BASE } from "./lib.mjs";

const S = loadState();
const NEW = S.newCashier;
const browser = await newBrowser();

async function loginCashier(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(NEW.slug);
  await page.locator('input[name="email"], input#email').first().fill(NEW.email);
  await page.locator('input[name="password"], input#password').first().fill(NEW.newPassword);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  if (page.url().includes("/login")) throw new Error("cashier login failed");
  log("  ✓ signed in as", NEW.email);
}

async function cart(page) {
  return page.evaluate(() => {
    const t = document.body.innerText;
    return {
      lines: Array.from(document.querySelectorAll('button[aria-label^="Decrease "][aria-label$=" quantity"]')).map((n) =>
        n.getAttribute("aria-label").replace(/^Decrease | quantity$/g, ""),
      ),
      mods: Array.from(document.querySelectorAll("[data-testid=cart-line-modifiers]")).map((n) => n.innerText.replace(/\s+/g, " ").trim()),
      subtotal: /Subtotal\s*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
      tax: /Tax[^\n]*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
      total: /Total[^\n]*\n?\s*(Rs [\d,]+\.\d\d)/.exec(t)?.[1] ?? null,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.innerText.trim()),
      orderNos: Array.from(new Set(Array.from(t.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0]))),
    };
  });
}

const cash = await newPage(browser);
await loginCashier(cash);
let tr = await go(cash, "/app/pos", { waitMs: 8000 });
log("  /app/pos trouble:", JSON.stringify(tr.bad));

// ── dine-in + table ──────────────────────────────────────────────────────────
await cash.locator("[data-testid=order-type-dine_in]").click();
await cash.waitForTimeout(400);
await cash.locator("[data-testid=table-select-trigger]").click();
await cash.waitForTimeout(1200);
const opts = await cash.evaluate(() =>
  Array.from(document.querySelectorAll('[data-testid^="table-option-"]')).map((n) => ({
    id: n.getAttribute("data-testid"),
    t: n.innerText.replace(/\s+/g, " ").trim(),
  })),
);
const free = opts.find((o) => /AVAILABLE/i.test(o.t)) ?? opts[0];
log("  table:", JSON.stringify(free));
await cash.locator(`[data-testid="${free.id}"]`).click();
await cash.waitForTimeout(900);
await shot(cash, "02a-table-chosen");

// ── search the dish that carries modifiers ───────────────────────────────────
const search = cash.locator('input[type=search], input[placeholder*="Search" i]').first();
await search.fill("Audit Item 52235");
await cash.waitForTimeout(1500);
const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
log("  tiles matching:", await tiles.count());
await shot(cash, "02b-searched-modifier-dish");
await tiles.first().click();
await cash.waitForTimeout(1500);

const dlg = await cash.evaluate(() => {
  const d = document.querySelector("[data-testid=modifier-dialog]");
  if (!d) return null;
  return {
    text: d.innerText.replace(/\s+/g, " ").trim().slice(0, 900),
    options: Array.from(d.querySelectorAll('[data-testid^="modifier-option-"]')).map((o) => ({
      id: o.getAttribute("data-testid"),
      t: o.innerText.replace(/\s+/g, " ").trim(),
      checked: o.getAttribute("aria-checked"),
    })),
    total: d.querySelector("[data-testid=modifier-dialog-total]")?.innerText.replace(/\s+/g, " ").trim(),
    addDisabled: d.querySelector("[data-testid=modifier-dialog-add]")?.getAttribute("aria-disabled"),
    blocked: d.querySelector("[data-testid=modifier-dialog-blocked]")?.innerText.replace(/\s+/g, " ").trim(),
  };
});
log("  MODIFIER DIALOG:", JSON.stringify(dlg, null, 1));
await shot(cash, "02c-modifier-dialog");
if (!dlg) {
  finding({ id: "D2-MOD", sev: "blocker", what: "tapping a dish with modifier groups opened no dialog" });
} else {
  // try to add without choosing the required group — the button must refuse
  await cash.locator("[data-testid=modifier-dialog-add]").click({ force: true }).catch(() => {});
  await cash.waitForTimeout(700);
  const refused = await cash.evaluate(() => ({
    blocked: document.querySelector("[data-testid=modifier-dialog-blocked]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
    blockedRole: document.querySelector("[data-testid=modifier-dialog-blocked]")?.getAttribute("role") ?? null,
    groupErrors: Array.from(document.querySelectorAll('[data-testid^="modifier-group-error-"]')).map((n) => n.innerText.trim()).filter(Boolean),
    stillOpen: !!document.querySelector("[data-testid=modifier-dialog]"),
  }));
  log("  add without required group ->", JSON.stringify(refused));
  await shot(cash, "02d-modifier-required-refusal");

  // choose one option per group: a required one, plus a paid extra
  const spice = dlg.options.find((o) => /mild|medium|hot|spice/i.test(o.t)) ?? dlg.options[dlg.options.length - 1];
  const cheese = dlg.options.find((o) => /cheese/i.test(o.t));
  if (spice) { await cash.locator(`[data-testid="${spice.id}"]`).click(); await cash.waitForTimeout(400); }
  if (cheese) { await cash.locator(`[data-testid="${cheese.id}"]`).click(); await cash.waitForTimeout(400); }
  const after = await cash.evaluate(() => ({
    total: document.querySelector("[data-testid=modifier-dialog-total]")?.innerText.replace(/\s+/g, " ").trim(),
    addDisabled: document.querySelector("[data-testid=modifier-dialog-add]")?.getAttribute("aria-disabled"),
    blocked: document.querySelector("[data-testid=modifier-dialog-blocked]")?.innerText.replace(/\s+/g, " ").trim() ?? null,
  }));
  log("  after choosing:", JSON.stringify(after), "picked:", spice?.t, "|", cheese?.t);
  await shot(cash, "02e-modifier-chosen");
  saveState({ modifierPick: { spice: spice?.t, cheese: cheese?.t, dialogTotal: after.total } });
  await cash.locator("[data-testid=modifier-dialog-add]").click();
  await cash.waitForTimeout(1500);
}

// two more plain dishes
await search.fill("");
await cash.waitForTimeout(1500);
const tiles2 = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
const names = await cash.evaluate(() =>
  Array.from(document.querySelectorAll('[data-testid="menu-grid"] button[aria-pressed]')).slice(0, 8).map((b) => b.innerText.replace(/\s+/g, " ").trim()),
);
log("  grid names:", JSON.stringify(names.slice(0, 6)));
// avoid re-tapping the modifier dish
let added = 0;
for (let i = 0; i < 10 && added < 2; i++) {
  const n = names[i] ?? "";
  if (/52235|60568/.test(n)) continue;
  await tiles2.nth(i).click();
  await cash.waitForTimeout(500);
  added++;
  if (added === 1) { await tiles2.nth(i).click(); await cash.waitForTimeout(500); } // qty 2
}
const c1 = await cart(cash);
log("  CART BEFORE FIRE:", JSON.stringify(c1, null, 1));
await shot(cash, "02f-order1-cart");
saveState({ order1Cart: c1, order1Table: free.t });

// ── fire ─────────────────────────────────────────────────────────────────────
const fire = cash.getByRole("button", { name: /send to kitchen/i });
log("  fire button:", await fire.count());
await fire.first().click();
await cash.waitForTimeout(6000);
await shot(cash, "02g-order1-fired");
const c2 = await cart(cash);
log("  AFTER FIRE:", JSON.stringify(c2, null, 1));
const ord1 = c2.orderNos[0] ?? c1.orderNos[0] ?? null;
log("  ORDER 1:", ord1);

// read it back on the cashier's own bearer
const list = await apiGet(cash, "/api/v1/pos/orders?size=5&sort=createdAt,desc");
const rows = list.body?.data ?? list.body?.content ?? [];
const mine = rows.find((r) => r.orderNo === ord1) ?? rows[0];
log("  server row:", JSON.stringify({
  orderNo: mine?.orderNo, status: mine?.status, type: mine?.type ?? mine?.orderType,
  table: mine?.tableName, total: mine?.totalPaisa, sub: mine?.subtotalPaisa, tax: mine?.taxPaisa,
  items: (mine?.items ?? []).map((i) => ({ n: i.menuItemName ?? i.name, q: i.quantity, p: i.unitPricePaisa, line: i.lineTotalPaisa, mods: i.modifiers ?? i.selectedModifiers })),
}, null, 1).slice(0, 1800));
saveState({ order1: { no: ord1, id: mine?.id, server: mine } });
await browser.close();
