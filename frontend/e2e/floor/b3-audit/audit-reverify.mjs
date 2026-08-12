/* B3 RE-OPEN — re-drive on the CURRENT jar (pos-service was restarted mid-audit).
   Confirms the happy path still holds, and re-measures the two defects found. */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const BASE="http://localhost:3000", GW="http://localhost:8080";
const OUT=resolve(process.cwd(),"../.planning/audits/floor/B3-audit"); mkdirSync(OUT,{recursive:true});
const CASHIER={slug:"floating-terrace",email:"cashier@terrace.local",password:"Terrace#Cashier1"};
const MANAGER={slug:"floating-terrace",email:"manager@terrace.local",password:"Terrace#Manager1"};
const log=(...a)=>console.log(...a); const J={fails:[]};
const FAIL=(k,v)=>{J.fails.push({k,v});log("  ✗ FAIL",k,JSON.stringify(v).slice(0,400));};
const OK=(k,v)=>log("  ✓",k,v===undefined?"":JSON.stringify(v).slice(0,500));
async function newPage(b){const c=await b.newContext({viewport:{width:1440,height:950}});return c.newPage();}
async function freshToken(p){return p.evaluate(async gw=>{const r=await fetch(`${gw}/api/v1/auth/refresh`,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:"{}"});if(!r.ok)return null;const j=await r.json().catch(()=>null);return j?.accessToken??j?.data?.accessToken??null;},GW);}
async function login(page,who){await page.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"});await page.waitForTimeout(1600);
 const s=page.locator('input[name="tenantSlug"], input#tenantSlug');if(await s.count())await s.first().fill(who.slug);
 await page.locator('input[name="email"], input#email').first().fill(who.email);
 await page.locator('input[name="password"], input#password').first().fill(who.password);
 await page.locator('button[type="submit"]').first().click();await page.waitForTimeout(5000);
 if(page.url().includes("/login"))throw new Error("login failed "+who.email);
 page.__token=await freshToken(page);log("  signed in as",who.email);}
function call(page,m,p,b,t){return page.evaluate(async({m,p,b,t,gw})=>{const r=await fetch(`${gw}${p}`,{method:m,credentials:"include",headers:{"Content-Type":"application/json","Idempotency-Key":crypto.randomUUID(),...(t?{Authorization:`Bearer ${t}`}:{})},body:b===undefined?undefined:JSON.stringify(b)});let body=null;try{body=await r.json();}catch{}return{status:r.status,body};},{m,p,b,t,gw:GW});}
async function api(page,m,p,b){let o=await call(page,m,p,b,page.__token);if(o.status===401){page.__token=await freshToken(page);o=await call(page,m,p,b,page.__token);}return o;}
const shot=async(p,n)=>{await p.screenshot({path:`${OUT}/${n}.png`});log("    shot:",n);};
async function go(page,r,ms=7000){await page.goto(`${BASE}${r}`,{waitUntil:"domcontentloaded"});await page.waitForTimeout(ms);
 const bad=await page.evaluate(()=>/Couldn.t load|Something went wrong|Failed to fetch|Unexpected Application Error/i.test(document.body.innerText||""));
 if(bad){log("    ! retry",r);await page.reload({waitUntil:"domcontentloaded"});await page.waitForTimeout(ms+2500);}}

const browser=await chromium.launch({args:["--disable-dev-shm-usage"]});
const mgr=await newPage(browser);await login(mgr,MANAGER);
const claims=JSON.parse(Buffer.from(mgr.__token.split(".")[1],"base64").toString("utf8"));
const branchId=claims.branch_id??claims.branchId;
const cash=await newPage(browser);await login(cash,CASHIER);
{ // the manager lays out fresh tables — the shared branch fills up with other agents' checks
  for(let i=0;i<4;i++){ await api(mgr,"POST",`/api/v1/pos/tables?branchId=${branchId}`,{tableNumber:"AUD"+Math.floor(Math.random()*9000+1000),capacity:4,section:"AUD"}); }
  log("  manager added 4 tables");
}

// ring + fire
await go(cash,"/app/pos",14000);
await cash.locator("[data-testid=order-type-dine_in]").click();await cash.waitForTimeout(500);
await cash.locator("[data-testid=table-select-trigger]").click();await cash.waitForTimeout(1600);
const opts=await cash.evaluate(()=>[...document.querySelectorAll('[data-testid^="table-option-"]')].map(n=>({id:n.getAttribute("data-testid"),disabled:n.getAttribute("aria-disabled")==="true"})));
const free=opts.find(o=>!o.disabled); if(!free)throw new Error("no free table");
await cash.locator(`[data-testid="${free.id}"]`).click();await cash.waitForTimeout(1200);
const tiles=cash.locator('[data-testid="menu-grid"] button[aria-pressed]');await tiles.first().waitFor({timeout:25000});
await tiles.nth(3).click();await cash.waitForTimeout(700);
let d=cash.locator('[role="dialog"] button:has-text("Add"), [role="dialog"] button:has-text("Done")');
if(await d.count()){await d.first().click().catch(()=>{});await cash.waitForTimeout(900);}
await tiles.nth(9).click();await cash.waitForTimeout(1000);
d=cash.locator('[role="dialog"] button:has-text("Add"), [role="dialog"] button:has-text("Done")');
if(await d.count()){await d.first().click().catch(()=>{});await cash.waitForTimeout(900);}
await cash.locator("[data-testid=send-to-kitchen-button]").click();await cash.waitForTimeout(8000);
const list=await api(cash,"GET",`/api/v1/pos/orders?branchId=${branchId}&size=30`);
const oid=(list.body?.data??[])[0].orderId;
const before=(await api(cash,"GET",`/api/v1/pos/orders/${oid}?branchId=${branchId}`)).body.data;
J.fired={orderNo:before.orderNo,status:before.status,subtotal:before.subtotalPaisa,tax:before.taxPaisa,sc:before.serviceChargePaisa,total:before.totalPaisa};
OK("fired",J.fired);
const item=before.items[0], gross=item.unitPriceSnapshot*item.quantity;

// the DONE MEANS: 10% off one line, with a reason, through the screen
await go(cash,`/app/pos/orders/${oid}/charge`,7000);
await cash.locator("[data-testid=add-discount-button]").click();await cash.waitForTimeout(900);
await cash.locator("[data-testid=discount-line-select]").selectOption(item.id);await cash.waitForTimeout(400);
await cash.locator("[data-testid=discount-value-input]").fill("10");await cash.waitForTimeout(700);
J.gate=await cash.evaluate(()=>({disabled:document.querySelector('[data-testid="apply-discount-submit"]')?.disabled,msg:document.querySelector('[data-testid="discount-validation-error"]')?.textContent?.trim()??null}));
OK("reason gate",J.gate); if(J.gate.disabled!==true)FAIL("reason-gate-gone",J.gate);
await cash.locator("[data-testid=discount-reason-input]").fill("Re-verified on the current jar");await cash.waitForTimeout(800);
await shot(cash,"e01-ready");
await cash.locator("[data-testid=apply-discount-submit]").click();await cash.waitForTimeout(4000);
await shot(cash,"e02-applied");
const after=(await api(cash,"GET",`/api/v1/pos/orders/${oid}?branchId=${branchId}`)).body.data;
J.applied={expectedDiscount:Math.round(gross*0.1),serverDiscount:after.discountPaisa,
  totalBefore:before.totalPaisa,totalAfter:after.totalPaisa,dropped:before.totalPaisa-after.totalPaisa,
  taxBefore:before.taxPaisa,taxAfter:after.taxPaisa,scBefore:before.serviceChargePaisa,scAfter:after.serviceChargePaisa,
  identity:after.subtotalPaisa-after.discountPaisa+after.taxPaisa+(after.serviceChargePaisa??0)===after.totalPaisa,
  row:(after.discounts??[]).map(x=>({s:x.scope,a:x.amountPaisa,why:x.reason,who:x.appliedByName}))};
OK("applied",J.applied);
if(after.discountPaisa!==Math.round(gross*0.1))FAIL("discount-paisa-wrong",J.applied);
if(!J.applied.identity)FAIL("money-identity-broken",J.applied);
J.screen=await cash.evaluate(()=>{const t=(document.body.innerText||"").replace(/ /g," ");const g=l=>new RegExp(`${l}\\s*\\n?\\s*(-?Rs [\\d,]+\\.\\d\\d)`).exec(t)?.[1]??null;
  return{subtotal:g("Subtotal"),discounts:g("Discounts"),taxes:g("Taxes"),total:g("Total"),
  applied:document.querySelector('[data-testid="applied-discounts"]')?.innerText.replace(/\s+/g," ").trim()??null,
  rawPerm:/pos\.(pos\.)?order\.discount/i.test(t)};});
OK("charge page",J.screen);

// ── DEFECT 1: the tax base ──────────────────────────────────────────────────
J.taxBase={taxCharged:after.taxPaisa, taxIfOnDiscountedBase:Math.round((after.subtotalPaisa-after.discountPaisa)*(before.taxPaisa/before.subtotalPaisa)),
  serviceChargeMovedWithTheDiscount:before.serviceChargePaisa!==after.serviceChargePaisa,
  taxMovedWithTheDiscount:before.taxPaisa!==after.taxPaisa};
J.taxBase.overTaxedPaisa=J.taxBase.taxCharged-J.taxBase.taxIfOnDiscountedBase;
OK("DEFECT tax base",J.taxBase);

// ── DEFECT 2: PERCENT above 100 at the API ──────────────────────────────────
{
  const r=await api(cash,"POST",`/api/v1/pos/orders/${oid}/discounts`,{scope:"LINE",orderItemId:before.items[1].id,type:"PERCENT",value:500,reason:"five hundred percent, re-verified"});
  const o=(await api(cash,"GET",`/api/v1/pos/orders/${oid}?branchId=${branchId}`)).body.data;
  const row=(o.discounts??[]).find(x=>x.orderItemId===before.items[1].id);
  J.percent500={apiStatus:r.status,storedValue:row?.value,amountPaisa:row?.amountPaisa,
    lineGross:before.items[1].unitPriceSnapshot*before.items[1].quantity};
  OK("DEFECT percent 500 at the API",J.percent500);
  await go(cash,`/app/pos/orders/${oid}/charge`,7000);
  J.percent500OnScreen=await cash.evaluate(()=>document.querySelector('[data-testid="applied-discounts"]')?.innerText.replace(/\s+/g," ").trim()??null);
  OK("…and what the bill now says",J.percent500OnScreen);
  await shot(cash,"e03-500-percent-on-the-bill");
}

// ── DEFECT 3: a fully comped check is all tax ───────────────────────────────
{
  const o0=(await api(cash,"GET",`/api/v1/pos/orders/${oid}?branchId=${branchId}`)).body.data;
  for(const it of o0.items){ await api(cash,"POST",`/api/v1/pos/orders/${oid}/discounts`,{scope:"LINE",orderItemId:it.id,type:"PERCENT",value:100,reason:"comped, on the house"}); }
  const o=(await api(cash,"GET",`/api/v1/pos/orders/${oid}?branchId=${branchId}`)).body.data;
  J.fullyComped={subtotal:o.subtotalPaisa,discount:o.discountPaisa,tax:o.taxPaisa,sc:o.serviceChargePaisa,total:o.totalPaisa,
    everythingCompedByACashierAlone:o.discountPaisa===o.subtotalPaisa,
    theGuestStillOwes:o.totalPaisa};
  OK("DEFECT a wholly comped check",J.fullyComped);
  await go(cash,`/app/pos/orders/${oid}/charge`,7000);
  await shot(cash,"e04-fully-comped-still-owes-tax");
  J.compedScreen=await cash.evaluate(()=>{const t=(document.body.innerText||"").replace(/ /g," ");const g=l=>new RegExp(`${l}\\s*\\n?\\s*(-?Rs [\\d,]+\\.\\d\\d)`).exec(t)?.[1]??null;
    return{subtotal:g("Subtotal"),discounts:g("Discounts"),taxes:g("Taxes"),total:g("Total")};});
  OK("comped bill on screen",J.compedScreen);
}

writeFileSync(`${OUT}/audit-reverify.json`,JSON.stringify(J,null,2));
log("\n=== FAILS:",J.fails.length,"===");J.fails.forEach(f=>log("  ✗",f.k));
log("ORDER=",J.fired.orderNo,oid);
await browser.close();
