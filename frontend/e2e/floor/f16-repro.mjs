/*
 * F16 REPRO — is there any sales-tax configuration, and does the menu carry a coherent rate?
 *   node e2e/floor/f16-repro.mjs
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, log } from "../shift/lib.mjs";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F16");
mkdirSync(OUT, { recursive: true });
const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  log(`    shot: ${name}.png`);
};

const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);

const nav = await owner.evaluate(() =>
  Array.from(document.querySelectorAll("nav a")).map((a) => ({
    href: a.getAttribute("href"),
    text: (a.textContent || "").trim(),
  })),
);
log("OWNER nav entries matching tax/fiscal:", JSON.stringify(nav.filter((n) => /tax|fiscal|vat|gst/i.test(n.href + n.text))));
log("OWNER nav count:", nav.length);

for (const route of ["/app/settings/tax", "/app/settings/taxes", "/app/finance/tax", "/app/menu/tax", "/app/settings"]) {
  const t = await go(owner, route, { waitMs: 2500, allowTrouble: true });
  const body = await owner.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 260));
  log(`\n${route} -> bad=${JSON.stringify(t.bad)}`);
  log(`   body: ${body}`);
  await shot(owner, `repro-${route.replace(/\//g, "_")}`);
}

// The menu's actual tax data, read with the owner's own bearer.
const items = await apiGet(owner, "/api/v1/pos/menu/items?size=200");
const rows = items.body?.data?.content ?? items.body?.content ?? items.body?.data ?? items.body ?? [];
const list = Array.isArray(rows) ? rows : [];
log(`\nGET /pos/menu/items -> ${items.status}, ${list.length} items`);
log(
  "  rate/code per item: " +
    JSON.stringify(
      list.map((i) => ({ n: i.name?.slice(0, 22), pct: i.taxRatePct, code: i.taxRateCode })),
      null,
      1,
    ),
);
const cats = await apiGet(owner, "/api/v1/pos/menu/categories");
const clist = cats.body?.data ?? cats.body ?? [];
log(`\nGET /pos/menu/categories -> ${cats.status}: ${JSON.stringify((Array.isArray(clist)?clist:[]).map((c) => ({ id: c.id?.slice(0,8), name: c.name, keys: Object.keys(c) })), null, 1)}`);

await browser.close();
