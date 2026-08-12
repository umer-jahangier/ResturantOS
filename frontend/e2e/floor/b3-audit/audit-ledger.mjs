/* B3 RE-OPEN — the last DONE MEANS clause: does the discounted figure reach the JOURNAL ENTRY,
   read as the accountant, and does that entry balance? */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const BASE = "http://localhost:3000", GW = "http://localhost:8080";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/B3-audit");
mkdirSync(OUT, { recursive: true });
const ORDER_NO = process.env.ORDER_NO || "ORD-20260812-0319";
const ACC = { slug: "floating-terrace", email: "accountant@terrace.local", password: "Terrace#Accountant1" };
const MGR = { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" };
const log = (...a) => console.log(...a);
const J = { fails: [], orderNo: ORDER_NO };
const FAIL = (k,v)=>{ J.fails.push({k,v}); log("  ✗ FAIL", k, JSON.stringify(v).slice(0,400)); };
const OK = (k,v)=>log("  ✓", k, v===undefined?"":JSON.stringify(v).slice(0,600));

const totp = (email) => execSync(`python3 ../scripts/generate_totp.py ${email}`).toString().match(/TOTP code:\s*(\d{6})/)[1];

async function newPage(b){const c=await b.newContext({viewport:{width:1440,height:950}});const p=await c.newPage();p.__console=[];p.on("console",m=>m.type()==="error"&&p.__console.push(m.text().slice(0,200)));return p;}
async function freshToken(p){return p.evaluate(async gw=>{const r=await fetch(`${gw}/api/v1/auth/refresh`,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:"{}"});if(!r.ok)return null;const j=await r.json().catch(()=>null);return j?.accessToken??j?.data?.accessToken??null;},GW);}
async function login(page, who, needsTotp){
  await page.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"}); await page.waitForTimeout(1600);
  const s=page.locator('input[name="tenantSlug"], input#tenantSlug'); if(await s.count()) await s.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(4000);
  if (needsTotp) {
    const code = page.locator('input[name="code"], input#code, input[autocomplete="one-time-code"], input[inputmode="numeric"]');
    if (await code.count()) {
      await code.first().fill(totp(who.email)); await page.waitForTimeout(400);
      const btn = page.locator('button[type="submit"]'); if (await btn.count()) await btn.first().click();
      await page.waitForTimeout(5000);
    }
  }
  await page.waitForTimeout(2500);
  if (page.url().includes("/login")) throw new Error("login failed " + who.email + " :: " + (await page.locator('[role="alert"]').first().textContent().catch(()=>"")));
  page.__token = await freshToken(page); log("  signed in as", who.email);
}
function call(page,m,p,b,t){return page.evaluate(async({m,p,b,t,gw})=>{const r=await fetch(`${gw}${p}`,{method:m,credentials:"include",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID(),...(t?{Authorization:`Bearer ${t}`}:{})},body:b===undefined?undefined:JSON.stringify(b)});let body=null;try{body=await r.json();}catch{}return{status:r.status,body};},{m,p,b,t,gw:GW});}
async function api(page,m,p,b){let o=await call(page,m,p,b,page.__token);if(o.status===401){page.__token=await freshToken(page);o=await call(page,m,p,b,page.__token);}return o;}
const shot=async(p,n)=>{await p.screenshot({path:`${OUT}/${n}.png`,fullPage:true});log("    shot:",n);};
async function go(page,r,ms=7000){await page.goto(`${BASE}${r}`,{waitUntil:"domcontentloaded"});await page.waitForTimeout(ms);
  const t=await page.evaluate(()=>({bad:/Couldn.t load|Something went wrong|Failed to fetch|Unexpected Application Error/i.test(document.body.innerText||""),denied:/Access denied|You do not have permission/i.test(document.body.innerText||"")}));
  if(t.bad){log("    ! retry",r);await page.reload({waitUntil:"domcontentloaded"});await page.waitForTimeout(ms+2500);}
  return t;}

const browser = await chromium.launch({ args:["--disable-dev-shm-usage"] });

// the check, straight from POS, as the manager
const mgr = await newPage(browser); await login(mgr, MGR, false);
const claims = JSON.parse(Buffer.from(mgr.__token.split(".")[1],"base64").toString("utf8"));
const branchId = claims.branch_id ?? claims.branchId;
let orderId = process.env.ORDER_ID;
if (!orderId) {
  const list = await api(mgr, "GET", `/api/v1/pos/orders?branchId=${branchId}&size=60`);
  const row = (list.body?.data ?? []).find(o => o.orderNo === ORDER_NO);
  if (!row) throw new Error("order not in the list: " + ORDER_NO);
  orderId = row.orderId;
}
const order = (await api(mgr, "GET", `/api/v1/pos/orders/${orderId}?branchId=${branchId}`)).body.data;
J.orderNo = order.orderNo;
J.pos = { orderNo: order.orderNo, status: order.status, subtotal: order.subtotalPaisa, discount: order.discountPaisa,
          tax: order.taxPaisa, sc: order.serviceChargePaisa, total: order.totalPaisa };
OK("POS says", J.pos);

// the accountant reads the ledger
const acc = await newPage(browser); await login(acc, ACC, true);
await go(acc, "/app/finance/journal-entries", 9000);
await shot(acc, "d01-journal-entries-list");
J.jeScreen = await acc.evaluate((no)=>{
  const t=(document.body.innerText||"").replace(/\s+/g," ");
  return { mentionsOrder: t.includes(no), denied:/Access denied|You do not have permission/i.test(t), snippet: t.slice(0,600) };
}, order.orderNo);
OK("journal entries screen", { mentionsOrder: J.jeScreen.mentionsOrder, denied: J.jeScreen.denied });

for (const path of [
  `/api/v1/finance/journal-entries?branchId=${branchId}&size=40`,
  `/api/v1/finance/journal-entries?size=40`,
  `/api/v1/finance/journal-entries/search?reference=${order.orderNo}`,
]) {
  const r = await api(acc, "GET", path);
  const data = r.body?.data ?? r.body?.content ?? [];
  const arr = Array.isArray(data) ? data : (data.content ?? []);
  (J.jeApi ??= {})[path] = { status: r.status, count: arr.length,
    hit: arr.filter(e => JSON.stringify(e).includes(order.orderNo)).map(e => ({
      ref: e.reference ?? e.sourceReference ?? e.sourceRef, desc: e.description, status: e.status,
      d: e.totalDebitPaisa ?? e.totalDebit, c: e.totalCreditPaisa ?? e.totalCredit, id: e.id })) };
  OK(path.replace(/\?.*/,"") + (path.includes("search")?" (search)":""), J.jeApi[path]);
}

// pull the lines of whichever entry names the order
const found = Object.values(J.jeApi).flatMap(x => x.hit ?? [])[0];
if (found?.id) {
  const det = await api(acc, "GET", `/api/v1/finance/journal-entries/${found.id}`);
  const e = det.body?.data ?? det.body;
  const lines = (e?.lines ?? e?.journalLines ?? []).map(l => ({ account: l.accountCode ?? l.account?.code ?? l.accountName, d: l.debitPaisa ?? l.debit, c: l.creditPaisa ?? l.credit, memo: l.memo ?? l.description }));
  const D = lines.reduce((a,l)=>a+(l.d??0),0), C = lines.reduce((a,l)=>a+(l.c??0),0);
  J.entry = { id: found.id, ref: found.ref, status: e?.status, lines, totalDebit: D, totalCredit: C, balanced: D === C,
              matchesPosTotal: D === J.pos.total || C === J.pos.total,
              anyLineEqualsDiscount: lines.some(l => l.d === J.pos.discount || l.c === J.pos.discount) };
  OK("entry", J.entry);
  if (!J.entry.balanced) FAIL("journal-entry-does-not-balance", { D, C });
  if (!J.entry.matchesPosTotal) FAIL("journal-entry-total-differs-from-the-check", { je: D, pos: J.pos.total });
  await go(acc, `/app/finance/journal-entries/${found.id}`, 8000);
  await shot(acc, "d02-journal-entry-detail");
  J.entryScreen = await acc.evaluate(()=> (document.body.innerText||"").replace(/\s+/g," ").slice(0,1200));
} else {
  FAIL("no-journal-entry-names-this-order", { orderNo: order.orderNo, probed: Object.keys(J.jeApi) });
}

writeFileSync(`${OUT}/audit-ledger.json`, JSON.stringify(J,null,2));
log("\n=== FAILS:", J.fails.length, "===");
J.fails.forEach(f=>log("  ✗", f.k, JSON.stringify(f.v).slice(0,300)));
await browser.close();
