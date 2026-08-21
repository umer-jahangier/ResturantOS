// ATTACK 12: the decisive three-way-match experiment. PO 02952ce0 was RECEIVED through the
// product's own receiving path minutes ago (SENT -> Partially received, real stock moved).
// Book an invoice against it. If the match table STILL shows "— @ —" and GRN 0, the matching
// engine is broken, not the seed data.
import { chromium, newCtx, login, probe, shot, assertSession, BASE } from "./lib.mjs";

const persona = process.argv[2] ?? "manager";
const stamp = Date.now().toString().slice(-6);

async function dstate(page) {
  return page.evaluate(() => {
    const ds = [...document.querySelectorAll('[role="dialog"]')]; const d = ds[ds.length - 1];
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return { size: `${Math.round(r.width)}x${Math.round(r.height)}`, title: (d.querySelector("h2,h3")?.innerText || "").trim(),
      labels: [...d.querySelectorAll("label")].map((l) => l.innerText.trim()).filter(Boolean),
      fields: [...d.querySelectorAll("input,textarea,select")].map((i) => ({ n: i.name || i.getAttribute("aria-label"), t: i.tagName, ty: i.type })),
      selects: [...d.querySelectorAll("select")].map((s) => ({ name: s.name, options: [...s.options].map((o) => o.innerText.trim()).slice(0, 6) })),
      buttons: [...d.querySelectorAll("button")].map((b) => `${b.innerText.trim()}${b.disabled ? "[DIS]" : ""}`).filter((t) => t && t !== "[DIS]"),
      text: d.innerText.slice(0, 400).replace(/\n+/g, " | ") };
  });
}

async function main() {
  const browser = await chromium.launch();
  const { page } = await newCtx(browser, { width: 1440, height: 950 });
  const api = [];
  page.on("response", (r) => { const u = r.url(); if (/\/purchasing\//.test(u) && r.request().method() !== "GET") api.push(`${r.request().method()} ${r.status()} ${u.split("/api/v1")[1]?.split("?")[0]}`); });
  if (!(await login(page, persona))) { console.log("LOGIN FAILED"); process.exit(1); }

  await probe(page, "/app/purchasing/invoices");
  await assertSession(page, "invoices");
  await page.locator('button:has-text("Book Invoice")').first().click();
  await page.waitForTimeout(2500);
  const d = await dstate(page);
  console.log("\n=== BOOK INVOICE DIALOG ===");
  console.log(JSON.stringify(d, null, 1).slice(0, 1800));
  await shot(page, "book-invoice-dialog");

  // Fill: vendor + PO 02952ce0 if selectable, invoice number, qty/price
  for (const s of d?.selects ?? []) {
    const el = page.locator(`[role="dialog"] select[name="${s.name}"]`);
    const opts = await el.evaluate((n) => [...n.options].map((o) => ({ v: o.value, t: o.innerText.trim() })));
    const po = opts.find((o) => o.t.includes("02952ce0") || o.v.startsWith("02952ce0"));
    const pick = po ?? opts.find((o) => o.v);
    if (pick) { await el.selectOption(pick.v); console.log(`  selected ${s.name} = ${pick.t}`); await page.waitForTimeout(1500); }
  }
  const setIf = async (sel, val) => { const f = page.locator(`[role="dialog"] ${sel}`); if (await f.count()) { await f.first().fill(val); return true; } return false; };
  console.log("  invoiceNo filled:", await setIf('input[name="invoiceNo"]', `RT-${stamp}`));
  console.log("  invoiceDate filled:", await setIf('input[name="invoiceDate"]', "2026-08-12"));
  // PO 02952ce0 lines: 2 PACK and 3.5 KG. Invoice line 0 at the ORDERED qty 2 — but only 1 was
  // received. A real three-way match must flag qty 2 invoiced against 1 received.
  await setIf('input[name="lines.0.qty"]', "2");
  await setIf('input[name="lines.0.unitPriceRupees"]', "6200.00");
  await setIf('input[name="lines.1.qty"]', "3.5");
  await setIf('input[name="lines.1.unitPriceRupees"]', "10500.00");
  await page.waitForTimeout(800);
  console.log("\n  after selections:", JSON.stringify(await dstate(page)).slice(0, 1200));
  await shot(page, "book-invoice-filled");

  api.length = 0;
  const submit = page.locator('[role="dialog"] button').filter({ hasText: /Book|Save|Create/ }).first();
  if (await submit.count()) {
    console.log("  submit disabled:", await submit.isDisabled());
    if (!(await submit.isDisabled())) { await submit.click(); await page.waitForTimeout(5000); }
  }
  const toast = await page.evaluate(() => [...document.querySelectorAll("[data-sonner-toast],[role=alert]")].map((t) => t.innerText.trim()).join(" ~ "));
  console.log("  toast:", toast, "| api:", JSON.stringify(api));
  console.log("  dialog after submit:", JSON.stringify(await dstate(page))?.slice(0, 600));
  await shot(page, "book-invoice-after");

  // find it and read the match
  const inv = await probe(page, "/app/purchasing/invoices");
  const row = await page.evaluate((s) => {
    const tr = [...document.querySelectorAll("table tbody tr")].find((r) => r.innerText.includes(s));
    return tr ? { cells: [...tr.querySelectorAll("td")].map((c) => c.innerText.trim()), href: tr.querySelector('a[href*="/invoices/"]')?.getAttribute("href") } : null;
  }, `RT-${stamp}`);
  console.log("\n  new invoice row:", JSON.stringify(row));
  if (row?.href) {
    await page.goto(`${BASE}${row.href}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    const m = await page.evaluate(() => {
      const tb = document.querySelector("table");
      return { body: document.body.innerText.split("Analytics")[1]?.slice(0, 700).replace(/\n+/g, " | "),
        head: tb ? [...tb.querySelectorAll("th")].map((x) => x.innerText.trim()) : [],
        rows: tb ? [...tb.querySelectorAll("tbody tr")].map((r) => [...r.querySelectorAll("td")].map((x) => x.innerText.trim())) : [] };
    });
    console.log("  MATCH TABLE on a genuinely-received PO:", JSON.stringify(m));
    await shot(page, "invoice-on-received-po");
  }
  await browser.close();
}
main();
