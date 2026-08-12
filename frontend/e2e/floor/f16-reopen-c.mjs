/*
 * F16 RE-OPEN — Stage C. The WRONG persona, and the OTHER tenant.
 *
 *   C1  CASHIER  — can she reach /app/settings/tax? can she POST a rate over the API?
 *   C2  MANAGER  — holds pos.menu.manage but NOT pos.tax.manage. Screen? Write? And can he
 *                  still classify a dish (which the commit says he must keep being able to do)?
 *   C3  KITCHEN  — reads nothing of the sort.
 *   C4  TENANT B (control.local) — can its OWNER see or mutate Floating Terrace's classes?
 *                  Both by id (the IDOR shape) and by list.
 *   C5  Did anything get WIDENED — can the cashier now write a menu item's tax class?
 */
import { newBrowser, newPage, login, go, apiGet as rawGet, apiSend as rawSend, tokenOf, log } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F16-reopen");
mkdirSync(OUT, { recursive: true });
const A = JSON.parse(readFileSync(`${OUT}/stage-a.json`, "utf8"));
const S = A.S, CAT = A.CAT, STD = A.STD, ZERO = A.ZERO;
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); log(`    shot ${n}`); };
const F = {};
const rec = (k, v) => { F[k] = v; log(`  > ${k}: ${JSON.stringify(v)}`); };

const TERRACE = {
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  kitchen: { slug: "floating-terrace", email: "kitchen@terrace.local", password: "Terrace#Kitchen1" },
};
const CONTROL_OWNER = {
  slug: "control-bistro-isolation-test-tenant", email: "owner@control.local", password: "Control#Owner1",
  totpSecret: "77YCNG564SWVW7YPUCJRGDSE6ZSCC3GQ",
};

const browser = await newBrowser();

async function probe(who, tag, { crossTenant = false } = {}) {
  const p = await newPage(browser);
  try { await login(p, who); }
  catch (e) { rec(`${tag}_login`, `FAILED: ${String(e.message).slice(0, 90)}`); await p.close(); return; }
  const tok = await tokenOf(p);
  const get = (path) => rawGet(p, path, tok);
  const send = (m, path, b) => rawSend(p, m, path, b, tok);

  // the screen
  const t = await go(p, "/app/settings/tax", { waitMs: 3500, allowTrouble: true });
  rec(`${tag}_screen`, { trouble: t.bad, url: t.url });
  rec(`${tag}_navHasSalesTax`, await p.evaluate(() =>
    Array.from(document.querySelectorAll("nav a")).some((a) => a.getAttribute("href") === "/app/settings/tax")));
  await shot(p, `c-${tag}-tax-screen`);

  // read the catalogue
  const list = await get("/api/v1/pos/tax-classes");
  const body = list.body?.data ?? list.body ?? [];
  rec(`${tag}_listClasses`, {
    status: list.status,
    count: Array.isArray(body) ? body.length : null,
    sawTerraceCode: Array.isArray(body) ? body.some((c) => String(c.code).includes(S)) : null,
  });

  // WRITE a new rate
  const created = await send("POST", "/api/v1/pos/tax-classes", {
    code: `HACK-${tag}-${Date.now().toString().slice(-5)}`, name: `hack ${tag}`, ratePct: 99,
  });
  rec(`${tag}_createClass`, { status: created.status, err: created.body?.error?.code ?? null });

  // MUTATE the terrace 17% class by id — the IDOR shape
  if (STD?.id) {
    const upd = await send("PUT", `/api/v1/pos/tax-classes/${STD.id}`, {
      code: `RX-STD-${S}`, name: "PWNED", ratePct: 1,
    });
    rec(`${tag}_updateTerraceClassById`, { status: upd.status, err: upd.body?.error?.code ?? null });
    const del = await send("DELETE", `/api/v1/pos/tax-classes/${STD.id}`);
    rec(`${tag}_deleteTerraceClassById`, { status: del.status, err: del.body?.error?.code ?? null });
  }

  // CLASSIFY a dish (pos.menu.manage, which MANAGER should still hold)
  if (!crossTenant && A.ids?.beta) {
    const item = await get(`/api/v1/pos/menu/items/${A.ids.beta}`);
    const cur = item.body?.data ?? item.body ?? {};
    const put = await send("PUT", `/api/v1/pos/menu/items/${A.ids.beta}`, {
      categoryId: CAT, name: cur.name, description: cur.description,
      basePricePaisa: cur.basePricePaisa, taxClassId: ZERO?.id ?? null,
    });
    rec(`${tag}_classifyDish`, { status: put.status, err: put.body?.error?.code ?? null });
    if (put.status === 200) {
      const back = await get(`/api/v1/pos/menu/items/${A.ids.beta}`);
      const b2 = back.body?.data ?? back.body ?? {};
      rec(`${tag}_classifyDishResult`, { rate: b2.effectiveTaxRatePct, code: b2.effectiveTaxRateCode, src: b2.taxSource });
      // put it back
      await send("PUT", `/api/v1/pos/menu/items/${A.ids.beta}`, {
        categoryId: CAT, name: cur.name, description: cur.description,
        basePricePaisa: cur.basePricePaisa, taxClassId: null,
      });
    }
  }
  await p.close();
}

log("\n=== C1 cashier ===");   await probe(TERRACE.cashier, "cashier");
log("\n=== C2 manager ===");   await probe(TERRACE.manager, "manager");
log("\n=== C3 kitchen ===");   await probe(TERRACE.kitchen, "kitchen");
log("\n=== C4 tenant B owner ==="); await probe(CONTROL_OWNER, "tenantB", { crossTenant: true });

writeFileSync(`${OUT}/stage-c.json`, JSON.stringify(F, null, 2));
log("\nSTAGE C written");
await browser.close();
