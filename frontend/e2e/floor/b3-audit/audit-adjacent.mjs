/*
 * B3 RE-OPEN — the adjacent paths. Everything the implementer did NOT claim.
 *  - a reasonless request straight at the API (server-side, not just the button)
 *  - the WRONG persona: waiter, kitchen
 *  - ANOTHER TENANT: control-bistro reaching a Floating Terrace check
 *  - FLAT (amount off) as well as PERCENT
 *  - re-apply to the same line: replace, not stack
 *  - can a discount be TAKEN OFF again once given?
 *  - an OPEN (unfired) check, and a SERVED check
 *  - a line carrying priced modifiers: does the on-screen preview match the server?
 *  - a discount that would exceed the line / the check
 *  - takings + Discount Summary + the journal entry
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const GW = "http://localhost:8080";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/B3-audit");
mkdirSync(OUT, { recursive: true });

const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };
const MANAGER = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };
const WAITER  = { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" };
const KITCHEN = { slug: "floating-terrace", email: "kitchen@terrace.local", password: "Terrace#Kitchen1" };
const OTHER   = { slug: "control-bistro-isolation-test-tenant", email: "manager@control.local", password: "Control#Manager1" };

const log = (...a) => console.log(...a);
const J = { fails: [], notes: [] };
const FAIL = (k, v) => { J.fails.push({ k, v }); log("  ✗ FAIL", k, JSON.stringify(v)); };
const OK = (k, v) => log("  ✓", k, v === undefined ? "" : JSON.stringify(v));

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.__console = [];
  page.on("console", (m) => m.type() === "error" && page.__console.push(m.text().slice(0, 200)));
  return page;
}
async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  if (page.url().includes("/login")) throw new Error(`login failed ${who.email}`);
  page.__token = await freshToken(page);
  if (!page.__token) throw new Error(`no token for ${who.email}`);
  log("  signed in as", who.email);
}
async function freshToken(page) {
  return page.evaluate(async (gw) => {
    const r = await fetch(`${gw}/api/v1/auth/refresh`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  }, GW);
}
/** Token cached per page — refreshing on every call rotates the cookie and races itself. */
async function api(page, method, path, payload) {
  let out = await call(page, method, path, payload, page.__token);
  if (out.status === 401) { page.__token = await freshToken(page); out = await call(page, method, path, payload, page.__token); }
  return out;
}
function call(page, m, p, b, t) {
  return page.evaluate(async ({ m, p, b, t, gw }) => {
    const r = await fetch(`${gw}${p}`, { method: m, credentials: "include",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: b === undefined ? undefined : JSON.stringify(b) });
    let body = null; try { body = await r.json(); } catch {}
    return { status: r.status, body };
  }, { m, p, b, t, gw: GW });
}
const msgOf = (r) => (r.body?.error?.message ?? r.body?.detail ?? r.body?.message ?? JSON.stringify(r.body ?? {}).slice(0, 220));
const shot = async (p, n) => { await p.screenshot({ path: `${OUT}/${n}.png` }); log("    shot:", n); };
async function go(page, route, waitMs = 6500) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(waitMs);
  const t = await page.evaluate(() => {
    const txt = document.body.innerText || "";
    return { bad: /Couldn.t load|Something went wrong|Failed to fetch|Unexpected Application Error/i.test(txt) ? ["load-failure"] : [],
             denied: /Access denied|You do not have permission/i.test(txt),
             alerts: [...document.querySelectorAll('[role="alert"]')].map(n => (n.textContent||"").trim()).filter(Boolean) };
  });
  if (t.bad.length) { log("    ! retry", route); await page.reload({ waitUntil: "domcontentloaded" }); await page.waitForTimeout(waitMs + 2500); }
  return t;
}

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });

const mgr = await newPage(browser); await login(mgr, MANAGER);
const claims = JSON.parse(Buffer.from(mgr.__token.split(".")[1], "base64").toString("utf8"));
const branchId = claims.branch_id ?? claims.branchId;
const cash = await newPage(browser); await login(cash, CASHIER);

// ── build a fresh fired check, as the cashier, through the UI ────────────────
async function ringCheck(page, { fire, withModifier }) {
  await go(page, "/app/pos", 9000);
  await page.locator("[data-testid=order-type-dine_in]").click(); await page.waitForTimeout(500);
  await page.locator("[data-testid=table-select-trigger]").click(); await page.waitForTimeout(1500);
  const opts = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="table-option-"]')]
    .map(n => ({ id: n.getAttribute("data-testid"), disabled: n.getAttribute("aria-disabled") === "true" })));
  const free = opts.find(o => !o.disabled);
  if (!free) throw new Error("no free table");
  await page.locator(`[data-testid="${free.id}"]`).click(); await page.waitForTimeout(1200);
  const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 25000 });
  await tiles.nth(3).click(); await page.waitForTimeout(600);
  const dlg = page.locator('[role="dialog"]');
  if (await dlg.count()) {
    if (withModifier) {
      const opt = dlg.locator('input[type=checkbox], [role="checkbox"], button[aria-pressed="false"]');
      if (await opt.count()) { await opt.first().click().catch(()=>{}); await page.waitForTimeout(400); }
    }
    const done = dlg.locator('button:has-text("Add"), button:has-text("Done"), button:has-text("Confirm")');
    if (await done.count()) { await done.first().click().catch(()=>{}); await page.waitForTimeout(900); }
  }
  await tiles.nth(9).click(); await page.waitForTimeout(1200);
  const dlg2 = page.locator('[role="dialog"] button:has-text("Add"), [role="dialog"] button:has-text("Done")');
  if (await dlg2.count()) { await dlg2.first().click().catch(()=>{}); await page.waitForTimeout(900); }
  if (fire) { await page.locator("[data-testid=send-to-kitchen-button]").click(); await page.waitForTimeout(8000); }
  const list = await api(page, "GET", `/api/v1/pos/orders?branchId=${branchId}&size=30`);
  return (list.body?.data ?? [])[0];
}

log("\n=== A. a fresh fired check ===");
const t1 = await ringCheck(cash, { fire: true });
const A = (await api(cash, "GET", `/api/v1/pos/orders/${t1.orderId}?branchId=${branchId}`)).body.data;
log("  ", t1.orderNo, A.status, "subtotal", A.subtotalPaisa, "total", A.totalPaisa);
const aItem = A.items[0];

// ── A1. reasonless request, straight at the API (server, not the button) ─────
log("\n=== A1. server-side reason enforcement ===");
for (const [label, body] of [
  ["no reason field", { scope: "LINE", orderItemId: aItem.id, type: "PERCENT", value: 10 }],
  ["empty reason", { scope: "LINE", orderItemId: aItem.id, type: "PERCENT", value: 10, reason: "" }],
  ["whitespace reason", { scope: "LINE", orderItemId: aItem.id, type: "PERCENT", value: 10, reason: "   " }],
  ["two-char reason", { scope: "LINE", orderItemId: aItem.id, type: "PERCENT", value: 10, reason: "ok" }],
]) {
  const r = await api(cash, "POST", `/api/v1/pos/orders/${t1.orderId}/discounts`, body);
  (J.reasonApi ??= {})[label] = { status: r.status, msg: msgOf(r).slice(0, 140) };
  OK(label, (J.reasonApi)[label]);
  if (r.status < 400) FAIL(`api-accepted-${label.replace(/ /g,"-")}`, (J.reasonApi)[label]);
}

// ── A2. bad scope / bad type — the free strings the register named ───────────
log("\n=== A2. unvalidated free strings ===");
for (const [label, body] of [
  ["scope WHOLE", { scope: "WHOLE", type: "PERCENT", value: 10, reason: "probing scope" }],
  ["type BOGUS", { scope: "LINE", orderItemId: aItem.id, type: "BOGUS", value: 10, reason: "probing type" }],
  ["percent 200", { scope: "LINE", orderItemId: aItem.id, type: "PERCENT", value: 200, reason: "probing overshoot" }],
  ["negative value", { scope: "LINE", orderItemId: aItem.id, type: "PERCENT", value: -10, reason: "probing negative" }],
]) {
  const r = await api(cash, "POST", `/api/v1/pos/orders/${t1.orderId}/discounts`, body);
  (J.badInput ??= {})[label] = { status: r.status, msg: msgOf(r).slice(0, 160) };
  OK(label, (J.badInput)[label]);
}
{
  const o = (await api(cash, "GET", `/api/v1/pos/orders/${t1.orderId}?branchId=${branchId}`)).body.data;
  J.afterBadInput = { discountPaisa: o.discountPaisa, totalPaisa: o.totalPaisa, rows: o.discounts?.length };
  OK("check after all the bad input", J.afterBadInput);
  if (o.totalPaisa !== A.totalPaisa) FAIL("bad-input-moved-the-bill", { was: A.totalPaisa, now: o.totalPaisa, rows: o.discounts });
}

// ── A3. FLAT (amount off) ───────────────────────────────────────────────────
log("\n=== A3. FLAT — an amount off, not a percentage ===");
await go(cash, `/app/pos/orders/${t1.orderId}/charge`, 7000);
await cash.locator("[data-testid=add-discount-button]").click(); await cash.waitForTimeout(900);
await cash.locator("[data-testid=discount-line-select]").selectOption(aItem.id); await cash.waitForTimeout(400);
const flatBtn = cash.locator('[data-testid="discount-type-flat"]');
J.flatControlExists = await flatBtn.count() > 0;
if (J.flatControlExists) {
  await flatBtn.first().click(); await cash.waitForTimeout(400);
  await cash.locator("[data-testid=discount-value-input]").fill("50");
  await cash.locator("[data-testid=discount-reason-input]").fill("Goodwill, flat amount");
  await cash.waitForTimeout(800);
  J.flatPreview = await cash.evaluate(() => document.querySelector('[data-testid="discount-preview"]')?.innerText.replace(/\s+/g," ").trim() ?? null);
  await shot(cash, "b01-flat-ready");
  await cash.locator("[data-testid=apply-discount-submit]").click(); await cash.waitForTimeout(4000);
  const o = (await api(cash, "GET", `/api/v1/pos/orders/${t1.orderId}?branchId=${branchId}`)).body.data;
  J.flat = { preview: J.flatPreview, discountPaisa: o.discountPaisa, expected: 5000, rows: o.discounts?.map(d => ({ s: d.scope, t: d.type, a: d.amountPaisa })) };
  OK("FLAT", J.flat);
  if (o.discountPaisa !== 5000) FAIL("flat-discount-wrong-paisa", J.flat);
  await shot(cash, "b02-flat-applied");
} else FAIL("no-flat-amount-control", "only percentage discounts can be given from the screen");

// ── A4. re-apply to the same line: replace, not stack ───────────────────────
log("\n=== A4. re-apply to the same line ===");
{
  const beforeR = (await api(cash, "GET", `/api/v1/pos/orders/${t1.orderId}?branchId=${branchId}`)).body.data;
  const r = await api(cash, "POST", `/api/v1/pos/orders/${t1.orderId}/discounts`, { scope: "LINE", orderItemId: aItem.id, type: "PERCENT", value: 10, reason: "replacing the flat one" });
  const o = (await api(cash, "GET", `/api/v1/pos/orders/${t1.orderId}?branchId=${branchId}`)).body.data;
  const lineRows = (o.discounts ?? []).filter(d => d.scope === "LINE" && d.orderItemId === aItem.id);
  J.reapply = { status: r.status, rowsOnThatLine: lineRows.length, amounts: lineRows.map(d => d.amountPaisa), discountPaisaBefore: beforeR.discountPaisa, discountPaisaAfter: o.discountPaisa };
  OK("re-apply", J.reapply);
  if (lineRows.length > 1) FAIL("discounts-stack-instead-of-replacing", J.reapply);
}

// ── A5. can a discount be TAKEN OFF again? ──────────────────────────────────
log("\n=== A5. removing a discount ===");
await go(cash, `/app/pos/orders/${t1.orderId}/charge`, 7000);
J.removeControls = await cash.evaluate(() => {
  const scope = document.querySelector('[data-testid="applied-discounts"]') ?? document.body;
  return {
    inAppliedBlock: [...scope.querySelectorAll('button,a,[role=button]')].map(n => (n.innerText||n.getAttribute("aria-label")||"").replace(/\s+/g," ").trim()).filter(Boolean),
    anyRemoveWord: /remove|delete|undo|clear|take off|×/i.test((document.querySelector('[data-testid="applied-discounts"]')?.innerText) || ""),
  };
});
OK("controls inside the applied-discounts block", J.removeControls);
{
  const o = (await api(cash, "GET", `/api/v1/pos/orders/${t1.orderId}?branchId=${branchId}`)).body.data;
  const row = (o.discounts ?? [])[0];
  const del = await api(cash, "DELETE", `/api/v1/pos/orders/${t1.orderId}/discounts/${row?.id}`);
  J.deleteEndpoint = { status: del.status, msg: msgOf(del).slice(0, 120) };
  OK("DELETE discount endpoint", J.deleteEndpoint);
}
if (!J.removeControls.anyRemoveWord && J.deleteEndpoint.status === 404)
  J.notes.push("A discount cannot be taken off once given — no control on screen and no endpoint. The only escape is to re-apply a smaller one, and a 0% discount is refused.");

// ── A6. an OPEN (unfired) check still discountable ──────────────────────────
log("\n=== A6. an OPEN, unfired check ===");
{
  const t2 = await ringCheck(cash, { fire: false });
  const o0 = (await api(cash, "GET", `/api/v1/pos/orders/${t2.orderId}?branchId=${branchId}`)).body.data;
  const r = await api(cash, "POST", `/api/v1/pos/orders/${t2.orderId}/discounts`, { scope: "LINE", orderItemId: o0.items[0].id, type: "PERCENT", value: 10, reason: "Unfired check, still discountable" });
  const o1 = (await api(cash, "GET", `/api/v1/pos/orders/${t2.orderId}?branchId=${branchId}`)).body.data;
  J.openCheck = { statusAtDiscount: o0.status, apiStatus: r.status, discountPaisa: o1.discountPaisa };
  OK("OPEN check", J.openCheck);
  if (r.status >= 400) FAIL("regression-open-check-no-longer-discountable", J.openCheck);
  J.openOrderId = t2.orderId;
}

// ── A7. a SERVED check ──────────────────────────────────────────────────────
log("\n=== A7. a SERVED check ===");
{
  await api(mgr, "POST", `/api/v1/pos/orders/${t1.orderId}/serve`, {});
  const o = (await api(mgr, "GET", `/api/v1/pos/orders/${t1.orderId}?branchId=${branchId}`)).body.data;
  const r = await api(mgr, "POST", `/api/v1/pos/orders/${t1.orderId}/discounts`, { scope: "ORDER", type: "PERCENT", value: 5, reason: "Served, then discounted" });
  J.servedCheck = { status: o.status, apiStatus: r.status, msg: msgOf(r).slice(0, 140) };
  OK("SERVED check", J.servedCheck);
}

// ── A8. WRONG PERSONA — waiter and kitchen, server side ─────────────────────
log("\n=== A8. wrong personas, server side ===");
for (const who of [WAITER, KITCHEN]) {
  const p = await newPage(browser);
  try {
    await login(p, who);
    const c = JSON.parse(Buffer.from(p.__token.split(".")[1], "base64").toString("utf8"));
    const rl = await api(p, "POST", `/api/v1/pos/orders/${t1.orderId}/discounts`, { scope: "LINE", orderItemId: aItem.id, type: "PERCENT", value: 50, reason: "wrong persona, line scope" });
    const ro = await api(p, "POST", `/api/v1/pos/orders/${t1.orderId}/discounts`, { scope: "ORDER", type: "PERCENT", value: 50, reason: "wrong persona, order scope" });
    (J.personas ??= {})[who.email] = { perms: (c.permissions ?? []).filter(x => /discount/.test(x)), line: { s: rl.status, m: msgOf(rl).slice(0,110) }, order: { s: ro.status, m: msgOf(ro).slice(0,110) } };
    OK(who.email, (J.personas)[who.email]);
    if (rl.status < 400 || ro.status < 400) FAIL(`persona-${who.email}-could-discount`, (J.personas)[who.email]);
  } catch (e) { (J.personas ??= {})[who.email] = { error: String(e).slice(0,160) }; log("  ", who.email, "probe error:", e.message); }
  await p.close();
}

// ── A9. ANOTHER TENANT ──────────────────────────────────────────────────────
log("\n=== A9. another tenant reaching this check ===");
{
  const p = await newPage(browser);
  try {
    await login(p, OTHER);
    const rd = await api(p, "GET", `/api/v1/pos/orders/${t1.orderId}?branchId=${branchId}`);
    const rw = await api(p, "POST", `/api/v1/pos/orders/${t1.orderId}/discounts`, { scope: "ORDER", type: "PERCENT", value: 90, reason: "cross-tenant probe" });
    J.crossTenant = { read: { s: rd.status, m: msgOf(rd).slice(0,120) }, write: { s: rw.status, m: msgOf(rw).slice(0,120) } };
    OK("control-bistro manager", J.crossTenant);
    if (rd.status === 200) FAIL("cross-tenant-read-of-another-tenants-check", J.crossTenant);
    if (rw.status < 400) FAIL("cross-tenant-discount-applied", J.crossTenant);
    const after = (await api(mgr, "GET", `/api/v1/pos/orders/${t1.orderId}?branchId=${branchId}`)).body.data;
    J.crossTenantMovedBill = after.discountPaisa;
  } catch (e) { J.crossTenant = { error: String(e).slice(0,200) }; log("  cross-tenant probe error:", e.message); }
  await p.close();
}

// ── A10. settle t1 and check the money surfaces ─────────────────────────────
log("\n=== A10. settle, then takings / report / ledger ===");
const finalT1 = (await api(mgr, "GET", `/api/v1/pos/orders/${t1.orderId}?branchId=${branchId}`)).body.data;
J.t1Final = { subtotal: finalT1.subtotalPaisa, discount: finalT1.discountPaisa, tax: finalT1.taxPaisa, sc: finalT1.serviceChargePaisa, total: finalT1.totalPaisa,
  identity: finalT1.subtotalPaisa - finalT1.discountPaisa + finalT1.taxPaisa + (finalT1.serviceChargePaisa ?? 0) === finalT1.totalPaisa };
OK("t1 final", J.t1Final);
{
  const pay = await api(cash, "POST", `/api/v1/pos/orders/${t1.orderId}/payments`, { method: "CASH", amountPaisa: finalT1.totalPaisa, tenderedPaisa: finalT1.totalPaisa });
  const close = await api(cash, "POST", `/api/v1/pos/orders/${t1.orderId}/close`, {});
  J.settleT1 = { pay: pay.status, close: close.status, closeMsg: close.status >= 400 ? msgOf(close).slice(0,140) : null };
  OK("settle", J.settleT1);
}
await new Promise(r => setTimeout(r, 9000));

await go(mgr, "/app/finance/takings", 9000);
await shot(mgr, "b03-takings");
J.takings = await mgr.evaluate(() => {
  const t = (document.body.innerText||"").replace(/ /g," ");
  const grab = (l) => new RegExp(`${l}\\s*\\n?\\s*(-?Rs [\\d,]+\\.\\d\\d)`, "i").exec(t)?.[1] ?? null;
  return { gross: grab("GROSS SALES"), discounts: grab("DISCOUNTS"), comps: grab("COMPS"), net: grab("NET SALES"),
           saysNotKnown: /Not known/i.test(t), raw: t.replace(/\s+/g," ").slice(0, 700) };
});
OK("takings", { gross: J.takings.gross, discounts: J.takings.discounts, comps: J.takings.comps, net: J.takings.net, notKnown: J.takings.saysNotKnown });
if (!J.takings.discounts || J.takings.discounts === "Rs 0.00") FAIL("takings-discounts-zero-or-absent", J.takings.raw.slice(0,300));

await go(mgr, "/app/reports/discount-summary", 10000);
{ const run = mgr.locator('button:has-text("Run"), button:has-text("Generate")'); if (await run.count()) { await run.first().click(); await mgr.waitForTimeout(6000); } }
await shot(mgr, "b04-discount-summary");
J.report = await mgr.evaluate(() => ({
  headers: [...document.querySelectorAll("th")].map(n => n.textContent.trim()),
  rows: [...document.querySelectorAll("tbody tr")].slice(0, 6).map(r => [...r.querySelectorAll("td")].map(c => c.textContent.trim())),
  mentionsOurReasons: /Kebab arrived cold|Regular of twenty|Goodwill, flat amount|replacing the flat one/i.test(document.body.innerText || ""),
  text: (document.body.innerText||"").replace(/\s+/g," ").slice(0, 800),
}));
OK("report headers", J.report.headers);
OK("report rows", J.report.rows);
OK("report mentions one of our reasons", J.report.mentionsOurReasons);
if (!J.report.mentionsOurReasons) FAIL("discount-summary-does-not-list-the-reason", J.report.text.slice(0,400));

// journal entry for the closed check
{
  const je = await api(mgr, "GET", `/api/v1/finance/journal-entries?branchId=${branchId}&size=10`);
  const rows = (je.body?.data ?? []).slice(0, 5);
  J.journal = { status: je.status, entries: rows.map(e => ({ ref: e.reference ?? e.sourceRef, desc: e.description, debit: e.totalDebitPaisa, credit: e.totalCreditPaisa, balanced: e.totalDebitPaisa === e.totalCreditPaisa })) };
  OK("journal entries", J.journal);
  const unbalanced = J.journal.entries.filter(e => e.debit !== undefined && !e.balanced);
  if (unbalanced.length) FAIL("journal-entry-unbalanced", unbalanced);
}

J.consoleErrors = { cashier: cash.__console.slice(0,4), manager: mgr.__console.slice(0,4) };
writeFileSync(`${OUT}/audit-adjacent.json`, JSON.stringify(J, null, 2));
log("\n=== FAILS:", J.fails.length, "===");
J.fails.forEach(f => log("  ✗", f.k, JSON.stringify(f.v).slice(0, 300)));
J.notes.forEach(n => log("  · note:", n));
log("journal →", `${OUT}/audit-adjacent.json`);
log("T1=" + t1.orderId);
await browser.close();
