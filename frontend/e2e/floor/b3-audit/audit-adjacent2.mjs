/* B3 RE-OPEN, part 2 — each probe on its own clean check. */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000", GW = "http://localhost:8080";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/B3-audit");
mkdirSync(OUT, { recursive: true });
const CASHIER = { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" };
const MANAGER = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };
const WAITER  = { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" };
const KITCHEN = { slug: "floating-terrace", email: "kitchen@terrace.local", password: "Terrace#Kitchen1" };
const OTHER   = { slug: "control-bistro-isolation-test-tenant", email: "manager@control.local", password: "Control#Manager1" };

const log = (...a) => console.log(...a);
const J = { fails: [], notes: [] };
const FAIL = (k, v) => { J.fails.push({ k, v }); log("  ✗ FAIL", k, JSON.stringify(v).slice(0, 400)); };
const OK = (k, v) => log("  ✓", k, v === undefined ? "" : JSON.stringify(v).slice(0, 400));

async function newPage(b) { const c = await b.newContext({ viewport: { width: 1440, height: 950 } }); const p = await c.newPage(); p.__console = []; p.on("console", m => m.type()==="error" && p.__console.push(m.text().slice(0,200))); return p; }
async function freshToken(page) { return page.evaluate(async gw => { const r = await fetch(`${gw}/api/v1/auth/refresh`, { method:"POST", credentials:"include", headers:{"Content-Type":"application/json"}, body:"{}" }); if(!r.ok) return null; const j = await r.json().catch(()=>null); return j?.accessToken ?? j?.data?.accessToken ?? null; }, GW); }
async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug'); if (await s.count()) await s.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(5000);
  if (page.url().includes("/login")) throw new Error("login failed " + who.email);
  page.__token = await freshToken(page); log("  signed in as", who.email);
}
function call(page, m, p, b, t) { return page.evaluate(async ({m,p,b,t,gw}) => { const r = await fetch(`${gw}${p}`, { method:m, credentials:"include", headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID(),...(t?{Authorization:`Bearer ${t}`}:{})}, body: b===undefined?undefined:JSON.stringify(b) }); let body=null; try{body=await r.json();}catch{} return { status:r.status, body }; }, {m,p,b,t,gw:GW}); }
async function api(page, m, p, b) { let o = await call(page,m,p,b,page.__token); if (o.status===401){ page.__token = await freshToken(page); o = await call(page,m,p,b,page.__token);} return o; }
const msgOf = r => (r.body?.error?.message ?? r.body?.detail ?? r.body?.message ?? JSON.stringify(r.body??{}).slice(0,200));
const shot = async (p,n) => { await p.screenshot({path:`${OUT}/${n}.png`}); log("    shot:", n); };
async function go(page, route, ms=6500) { await page.goto(`${BASE}${route}`,{waitUntil:"domcontentloaded"}); await page.waitForTimeout(ms);
  const t = await page.evaluate(()=>({ bad:/Couldn.t load|Something went wrong|Failed to fetch|Unexpected Application Error/i.test(document.body.innerText||""), denied:/Access denied|You do not have permission/i.test(document.body.innerText||"") }));
  if (t.bad) { log("    ! retry", route); await page.reload({waitUntil:"domcontentloaded"}); await page.waitForTimeout(ms+2500); } return t; }

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
const mgr = await newPage(browser); await login(mgr, MANAGER);
const claims = JSON.parse(Buffer.from(mgr.__token.split(".")[1],"base64").toString("utf8"));
const branchId = claims.branch_id ?? claims.branchId;
const cash = await newPage(browser); await login(cash, CASHIER);

async function ringCheck(page, fire = true) {
  await go(page, "/app/pos", 9000);
  await page.locator("[data-testid=order-type-dine_in]").click(); await page.waitForTimeout(500);
  await page.locator("[data-testid=table-select-trigger]").click(); await page.waitForTimeout(1600);
  const opts = await page.evaluate(()=>[...document.querySelectorAll('[data-testid^="table-option-"]')].map(n=>({id:n.getAttribute("data-testid"),disabled:n.getAttribute("aria-disabled")==="true"})));
  const free = opts.find(o=>!o.disabled); if(!free) throw new Error("no free table");
  await page.locator(`[data-testid="${free.id}"]`).click(); await page.waitForTimeout(1200);
  const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({timeout:25000});
  await tiles.nth(3).click(); await page.waitForTimeout(700);
  let d = page.locator('[role="dialog"] button:has-text("Add"), [role="dialog"] button:has-text("Done")');
  if (await d.count()) { await d.first().click().catch(()=>{}); await page.waitForTimeout(900); }
  await tiles.nth(9).click(); await page.waitForTimeout(1000);
  d = page.locator('[role="dialog"] button:has-text("Add"), [role="dialog"] button:has-text("Done")');
  if (await d.count()) { await d.first().click().catch(()=>{}); await page.waitForTimeout(900); }
  if (fire) { await page.locator("[data-testid=send-to-kitchen-button]").click(); await page.waitForTimeout(8000); }
  const list = await api(page, "GET", `/api/v1/pos/orders?branchId=${branchId}&size=30`);
  const o = (list.body?.data ?? [])[0];
  const full = (await api(page, "GET", `/api/v1/pos/orders/${o.orderId}?branchId=${branchId}`)).body.data;
  return full;
}

// ── B1. FLAT (amount off) on a clean check, through the screen ──────────────
log("\n=== B1. FLAT amount off, via the UI ===");
const c1 = await ringCheck(cash);
log("  ", c1.orderNo, c1.status, "subtotal", c1.subtotalPaisa, "total", c1.totalPaisa);
await go(cash, `/app/pos/orders/${c1.id}/charge`, 7000);
await cash.locator("[data-testid=add-discount-button]").click(); await cash.waitForTimeout(900);
await cash.locator("[data-testid=discount-line-select]").selectOption(c1.items[0].id); await cash.waitForTimeout(400);
const flat = cash.locator('[data-testid="discount-type-flat"]');
J.flatControlExists = (await flat.count()) > 0;
if (J.flatControlExists) {
  await flat.first().click(); await cash.waitForTimeout(400);
  await cash.locator("[data-testid=discount-value-input]").fill("50");
  await cash.locator("[data-testid=discount-reason-input]").fill("Goodwill, flat amount");
  await cash.waitForTimeout(900);
  J.flatPreview = await cash.evaluate(()=>document.querySelector('[data-testid="discount-preview"]')?.innerText.replace(/\s+/g," ").trim() ?? null);
  J.flatSubmitDisabled = await cash.evaluate(()=>document.querySelector('[data-testid="apply-discount-submit"]')?.disabled);
  OK("flat preview", { preview: J.flatPreview, disabled: J.flatSubmitDisabled });
  await shot(cash, "c01-flat-ready");
  if (!J.flatSubmitDisabled) {
    await cash.locator("[data-testid=apply-discount-submit]").click(); await cash.waitForTimeout(4000);
    const o = (await api(cash,"GET",`/api/v1/pos/orders/${c1.id}?branchId=${branchId}`)).body.data;
    J.flat = { discountPaisa: o.discountPaisa, expected: 5000, totalBefore: c1.totalPaisa, totalAfter: o.totalPaisa };
    OK("FLAT applied", J.flat);
    if (o.discountPaisa !== 5000) FAIL("flat-discount-wrong-paisa", J.flat);
    await shot(cash, "c02-flat-applied");
  } else FAIL("flat-submit-stuck-disabled", J.flatPreview);
} else FAIL("no-flat-amount-control", "only percentages can be given from the screen");

// ── B2. re-apply to the same line replaces, does not stack ──────────────────
log("\n=== B2. re-apply the same line ===");
{
  const r = await api(cash, "POST", `/api/v1/pos/orders/${c1.id}/discounts`, { scope:"LINE", orderItemId:c1.items[0].id, type:"PERCENT", value:10, reason:"replacing the flat amount" });
  const o = (await api(cash,"GET",`/api/v1/pos/orders/${c1.id}?branchId=${branchId}`)).body.data;
  const rows = (o.discounts??[]).filter(d=>d.scope==="LINE" && d.orderItemId===c1.items[0].id);
  J.reapply = { status:r.status, rowsOnLine:rows.length, amounts:rows.map(d=>d.amountPaisa), orderDiscountPaisa:o.discountPaisa };
  OK("re-apply", J.reapply);
  if (rows.length > 1) FAIL("line-discounts-stack", J.reapply);
}

// ── B3. can a discount be TAKEN OFF once given? ─────────────────────────────
log("\n=== B3. removing a discount ===");
await go(cash, `/app/pos/orders/${c1.id}/charge`, 7000);
await shot(cash, "c03-applied-block");
J.removal = await cash.evaluate(()=>{
  const blk = document.querySelector('[data-testid="applied-discounts"]');
  return { blockText: blk?.innerText.replace(/\s+/g," ").trim() ?? null,
           buttonsInBlock: blk ? [...blk.querySelectorAll('button,a,[role=button]')].map(n=>(n.innerText||n.getAttribute("aria-label")||"").trim()).filter(Boolean) : [],
           anyRemoveWordOnPage: /remove discount|delete discount|undo discount|take (the )?discount off/i.test(document.body.innerText||"") };
});
{
  const o = (await api(cash,"GET",`/api/v1/pos/orders/${c1.id}?branchId=${branchId}`)).body.data;
  const row = (o.discounts??[])[0];
  const del = await api(cash, "DELETE", `/api/v1/pos/orders/${c1.id}/discounts/${row?.id}`);
  const zero = await api(cash, "POST", `/api/v1/pos/orders/${c1.id}/discounts`, { scope:"LINE", orderItemId:c1.items[0].id, type:"FLAT", value:0, reason:"trying to cancel it with a zero" });
  J.removal.deleteEndpoint = { status: del.status, msg: msgOf(del).slice(0,120) };
  J.removal.zeroDiscount = { status: zero.status, msg: msgOf(zero).slice(0,120) };
}
OK("removal", J.removal);
if (!J.removal.buttonsInBlock.length && J.removal.deleteEndpoint.status >= 400 && J.removal.zeroDiscount.status >= 400)
  FAIL("a-discount-cannot-be-taken-back-off", J.removal);

// ── B4. can a cashier reach a whole-check discount one line at a time? ──────
log("\n=== B4. the permission split, tested by iteration ===");
{
  const c2 = await ringCheck(cash);
  let last = null;
  for (const it of c2.items) {
    const r = await api(cash, "POST", `/api/v1/pos/orders/${c2.id}/discounts`, { scope:"LINE", orderItemId:it.id, type:"PERCENT", value:100, reason:"comping this line" });
    last = r.status;
  }
  const o = (await api(cash,"GET",`/api/v1/pos/orders/${c2.id}?branchId=${branchId}`)).body.data;
  J.cashierZeroedCheck = { orderNo:c2.orderNo, lastStatus:last, subtotal:o.subtotalPaisa, discount:o.discountPaisa, total:o.totalPaisa,
    everyLineCompedByACashierWithoutAManager: o.discountPaisa === o.subtotalPaisa };
  OK("cashier comping every line", J.cashierZeroedCheck);
  J.zeroedOrderId = c2.id;
}

// ── B5. percent above 100 at the API ────────────────────────────────────────
log("\n=== B5. PERCENT above 100 ===");
{
  const c3 = await ringCheck(cash);
  const uiCheck = await (async () => {
    await go(cash, `/app/pos/orders/${c3.id}/charge`, 7000);
    await cash.locator("[data-testid=add-discount-button]").click(); await cash.waitForTimeout(800);
    await cash.locator("[data-testid=discount-line-select]").selectOption(c3.items[0].id); await cash.waitForTimeout(400);
    await cash.locator("[data-testid=discount-value-input]").fill("200");
    await cash.locator("[data-testid=discount-reason-input]").fill("Two hundred percent");
    await cash.waitForTimeout(800);
    await shot(cash, "c04-200-percent-ui");
    return cash.evaluate(()=>({ disabled: document.querySelector('[data-testid="apply-discount-submit"]')?.disabled,
                                msg: document.querySelector('[data-testid="discount-validation-error"]')?.textContent?.trim() ?? null }));
  })();
  const r = await api(cash, "POST", `/api/v1/pos/orders/${c3.id}/discounts`, { scope:"LINE", orderItemId:c3.items[0].id, type:"PERCENT", value:200, reason:"two hundred percent at the API" });
  const o = (await api(cash,"GET",`/api/v1/pos/orders/${c3.id}?branchId=${branchId}`)).body.data;
  J.percent200 = { uiBlocked: uiCheck, apiStatus: r.status, discountPaisa: o.discountPaisa, storedValue: (o.discounts??[])[0]?.value, lineGross: c3.items[0].unitPriceSnapshot*c3.items[0].quantity, totalBefore: c3.totalPaisa, totalAfter: o.totalPaisa };
  OK("200%", J.percent200);
  if (uiCheck.disabled === true && r.status === 200)
    FAIL("api-accepts-a-percentage-the-screen-refuses", J.percent200);
  J.percent200OrderId = c3.id;
}

// ── B6. wrong personas, server side ─────────────────────────────────────────
log("\n=== B6. wrong personas ===");
for (const who of [WAITER, KITCHEN]) {
  const p = await newPage(browser);
  try {
    await login(p, who);
    const c = JSON.parse(Buffer.from(p.__token.split(".")[1],"base64").toString("utf8"));
    const rl = await api(p, "POST", `/api/v1/pos/orders/${c1.id}/discounts`, { scope:"LINE", orderItemId:c1.items[0].id, type:"PERCENT", value:50, reason:"wrong persona line scope" });
    const ro = await api(p, "POST", `/api/v1/pos/orders/${c1.id}/discounts`, { scope:"ORDER", type:"PERCENT", value:50, reason:"wrong persona order scope" });
    (J.personas ??= {})[who.email] = { perms:(c.permissions??[]).filter(x=>/discount/.test(x)), line:{s:rl.status,m:msgOf(rl).slice(0,110)}, order:{s:ro.status,m:msgOf(ro).slice(0,110)} };
    OK(who.email, J.personas[who.email]);
    if (rl.status < 400 || ro.status < 400) FAIL(`persona-${who.email}-could-discount`, J.personas[who.email]);
  } catch(e) { (J.personas??={})[who.email] = { error:String(e).slice(0,160) }; log("  ", who.email, "error:", e.message); }
  await p.close();
}

// ── B7. another tenant ──────────────────────────────────────────────────────
log("\n=== B7. another tenant ===");
{
  const p = await newPage(browser);
  try {
    await login(p, OTHER);
    const rd = await api(p, "GET", `/api/v1/pos/orders/${c1.id}?branchId=${branchId}`);
    const rw = await api(p, "POST", `/api/v1/pos/orders/${c1.id}/discounts`, { scope:"ORDER", type:"PERCENT", value:90, reason:"cross tenant probe" });
    J.crossTenant = { read:{s:rd.status,m:msgOf(rd).slice(0,140)}, write:{s:rw.status,m:msgOf(rw).slice(0,140)} };
    OK("control-bistro manager", J.crossTenant);
    if (rd.status === 200) FAIL("cross-tenant-read", J.crossTenant);
    if (rw.status < 400) FAIL("cross-tenant-write", J.crossTenant);
  } catch(e) { J.crossTenant = { error:String(e).slice(0,200) }; log("  cross-tenant error:", e.message); }
  await p.close();
}

// ── B8. settle c1 and follow the money to takings / report / ledger ─────────
log("\n=== B8. settle, then the money surfaces ===");
const fin = (await api(mgr,"GET",`/api/v1/pos/orders/${c1.id}?branchId=${branchId}`)).body.data;
J.c1Final = { orderNo: fin.orderNo, subtotal:fin.subtotalPaisa, discount:fin.discountPaisa, tax:fin.taxPaisa, sc:fin.serviceChargePaisa, total:fin.totalPaisa,
  identity: fin.subtotalPaisa - fin.discountPaisa + fin.taxPaisa + (fin.serviceChargePaisa??0) === fin.totalPaisa };
OK("c1 final", J.c1Final);
if (!J.c1Final.identity) FAIL("money-identity-broken", J.c1Final);
{
  const pay = await api(cash, "POST", `/api/v1/pos/orders/${c1.id}/payments`, { method:"CASH", amountPaisa: fin.totalPaisa, tenderedPaisa: fin.totalPaisa });
  const close = await api(cash, "POST", `/api/v1/pos/orders/${c1.id}/close`, {});
  J.settle = { pay: pay.status, payMsg: pay.status>=400?msgOf(pay).slice(0,140):null, close: close.status, closeMsg: close.status>=400?msgOf(close).slice(0,140):null };
  OK("settle", J.settle);
  const back = (await api(cash,"GET",`/api/v1/pos/orders/${c1.id}?branchId=${branchId}`)).body.data;
  const pays = (await api(cash,"GET",`/api/v1/pos/orders/${c1.id}/payments?branchId=${branchId}`)).body?.data;
  J.settled = { status: back.status, total: back.totalPaisa, discount: back.discountPaisa,
    paidPaisa: (pays??[]).reduce((a,p)=>a+(p.amountPaisa??0),0) };
  OK("settled", J.settled);
  if (J.settled.status === "CLOSED" && J.settled.paidPaisa !== J.settled.total) FAIL("paid-does-not-equal-total", J.settled);
}
await new Promise(r=>setTimeout(r, 10000));

await go(mgr, "/app/finance/takings", 9000);
await shot(mgr, "c05-takings");
J.takings = await mgr.evaluate(()=>{ const t=(document.body.innerText||"").replace(/ /g," ");
  const g=l=>new RegExp(`${l}\\s*\\n?\\s*(-?Rs [\\d,]+\\.\\d\\d)`,"i").exec(t)?.[1]??null;
  return { gross:g("GROSS SALES"), discounts:g("DISCOUNTS"), comps:g("COMPS"), net:g("NET SALES"), notKnown:/Not known/i.test(t), raw:t.replace(/\s+/g," ").slice(0,900) }; });
OK("takings", { gross:J.takings.gross, discounts:J.takings.discounts, comps:J.takings.comps, net:J.takings.net, notKnown:J.takings.notKnown });
if (!J.takings.discounts || J.takings.discounts === "Rs 0.00") FAIL("takings-discounts-zero", J.takings.raw.slice(0,300));

await go(mgr, "/app/reports/discount-summary", 10000);
{ const b = mgr.locator('button:has-text("Run"), button:has-text("Generate")'); if (await b.count()) { await b.first().click(); await mgr.waitForTimeout(6000); } }
await shot(mgr, "c06-discount-summary");
J.report = await mgr.evaluate(()=>({ headers:[...document.querySelectorAll("th")].map(n=>n.textContent.trim()),
  rows:[...document.querySelectorAll("tbody tr")].slice(0,8).map(r=>[...r.querySelectorAll("td")].map(c=>c.textContent.trim())),
  mentionsReason:/Goodwill, flat amount|replacing the flat amount|comping this line|Kebab arrived cold|Regular of twenty/i.test(document.body.innerText||""),
  text:(document.body.innerText||"").replace(/\s+/g," ").slice(0,900) }));
OK("report headers", J.report.headers);
OK("report rows", J.report.rows);
if (!J.report.mentionsReason) FAIL("discount-summary-lists-no-reason", J.report.text.slice(0,400));

{
  const je = await api(mgr, "GET", `/api/v1/finance/journal-entries?branchId=${branchId}&size=10`);
  const rows = (je.body?.data ?? je.body?.data?.content ?? []).slice(0,6);
  J.journal = { status: je.status, sample: rows.map(e=>({ ref:e.reference??e.sourceReference, desc:e.description, d:e.totalDebitPaisa, c:e.totalCreditPaisa })) };
  OK("journal", J.journal);
}

J.consoleErrors = { cashier: cash.__console.slice(0,4), manager: mgr.__console.slice(0,4) };
writeFileSync(`${OUT}/audit-adjacent2.json`, JSON.stringify(J,null,2));
log("\n=== FAILS:", J.fails.length, "===");
J.fails.forEach(f=>log("  ✗", f.k, JSON.stringify(f.v).slice(0,320)));
log("C1=" + c1.id);
await browser.close();
