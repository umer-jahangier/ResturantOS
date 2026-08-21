import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const BASE="http://localhost:3000", GW="http://localhost:8080";
const OUT="../.planning/audits/repair/S0-01/adversarial";
const R={failures:[]}; const log=(...a)=>console.log(...a);
let BEARER=null;
const br=await chromium.launch(); const c=await br.newContext({viewport:{width:1440,height:1000}}); const p=await c.newPage();
p.setDefaultTimeout(90000); p.setDefaultNavigationTimeout(150000);
p.on("request",r=>{const a=r.headers()["authorization"]; if(a&&a.startsWith("Bearer ")) BEARER=a;});
await p.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(2000);
const sl=p.locator('input[name="tenantSlug"], input#tenantSlug'); if(await sl.count()) await sl.first().fill("floating-terrace");
await p.locator('input[name="email"], input#email').first().fill("manager@terrace.local");
await p.locator('input[name="password"], input#password').first().fill("Terrace#Manager1");
await p.locator('button[type="submit"]').first().click();
for(let i=0;i<25&&p.url().includes("/login");i++) await p.waitForTimeout(1500);
log("signed in");
const raw=(m,pa,bo)=>p.evaluate(async([m,pa,bo,be,gw])=>{const h={Authorization:be,"Idempotency-Key":crypto.randomUUID()};if(bo)h["Content-Type"]="application/json";
  const r=await fetch(gw+pa,{method:m,credentials:"include",headers:h,body:bo?JSON.stringify(bo):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return{status:r.status,body:j}},[m,pa,bo??null,BEARER,GW]);
async function api(m,pa,bo){for(let i=0;i<15;i++){const r=await raw(m,pa,bo);if(r.status!==503)return r;log("   503, retry");await p.waitForTimeout(10000);}throw new Error("503 "+pa);}
const branchOf=()=>JSON.parse(Buffer.from(BEARER.split(".")[1],"base64").toString()).branch_id;
const getOrder=async id=>{const r=await api("GET",`/api/v1/pos/orders/${id}?branchId=${branchOf()}`);return r.body.data??r.body;};
async function ensureTill(){const b=p.locator('[data-testid="open-till-button"]');if(await b.count()){log("  opening till");await b.first().click();await p.waitForTimeout(1200);
  await p.locator('[data-testid="open-till-panel"] input[type="number"]').first().fill("5000.00");await p.waitForTimeout(400);
  await p.locator('[data-testid="open-till-confirm-button"]').click();await p.waitForTimeout(6000);}}
// ring + fire
let no=null;
for(let a=0;a<5&&!no;a++){
  await p.goto(`${BASE}/app/pos`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(8000);
  await ensureTill();
  const t=p.getByRole("button",{name:"Terminal",exact:true}); if(await t.count()){await t.first().click().catch(()=>{});await p.waitForTimeout(2500);}
  const tiles=p.locator('[data-testid="menu-grid"] button[aria-pressed]');
  if(!(await tiles.count())){ log("  no tiles, retry",a+1); continue; }
  await tiles.first().waitFor({timeout:60000});
  await tiles.nth(0).click(); await p.waitForTimeout(700);
  await p.locator('[data-testid="send-to-kitchen-button"]').click(); await p.waitForTimeout(6000);
  no=await p.evaluate(()=>(document.body.innerText.match(/ORD-\d{8}-\d+/)||[null])[0]);
}
log("order",no); R.order=no;
async function openOM(){
  for(let a=0;a<6;a++){
    await p.goto(`${BASE}/app/pos`,{waitUntil:"domcontentloaded"});await p.waitForTimeout(7000);
    const tab=p.getByRole("button",{name:"Order Management",exact:true});
    if(await tab.count()){ await tab.first().click(); await p.waitForTimeout(4500); break; }
  }
  const se=p.locator('[data-testid="order-management-search"]');
  if(await se.count()){ await se.first().fill(no); await p.waitForTimeout(4000); }
  const found=await p.evaluate(n=>Array.from(document.querySelectorAll('tr')).filter(r=>r.innerText.includes(n)).length,no);
  if(!found) return null;
  const row=p.locator(`tr:has-text("${no}")`).first();
  const ob=row.locator('[data-testid^="open-order-"]');
  const id=(await ob.getAttribute("data-testid")).replace("open-order-","");
  await ob.click(); await p.waitForTimeout(3500); return id;
}
const id=await openOM(); R.id=id; log("orderId",id);
// charge full cash
const o=await getOrder(id); R.totalBefore=o.totalPaisa;
await p.goto(`${BASE}/app/pos/orders/${id}/charge`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(7000);
const f=p.locator('input[aria-label="Amount (Rs)"]').first(); await f.waitFor({timeout:60000});
await f.fill(`${Math.floor(o.totalPaisa/100)}.${String(o.totalPaisa%100).padStart(2,"0")}`); await p.waitForTimeout(800);
let st=null; const h=r=>{if(r.request().method()==="POST"&&/\/pos\/orders\/.*\/payments/.test(r.url())) st=r.status();};
p.on("response",h); await p.locator('[data-testid="record-payment-button"]').first().click(); await p.waitForTimeout(7000); p.off("response",h);
log("POST payments ->",st); if(st!==200&&st!==201) throw new Error("payment did not record "+st);
const paid=await api("GET",`/api/v1/pos/orders/${id}/payments`);
R.paymentsAfterCharge=Array.isArray(paid.body?.data)?paid.body.data:[];
log("paid:",JSON.stringify(R.paymentsAfterCharge.map(x=>({m:x.method,a:x.amountPaisa}))));
// NOW: cancel the only line item, from the drawer, on a fully-paid order
await openOM();
await p.screenshot({path:`${OUT}/G1-paid-drawer-before-cancel.png`});
const cancelBtns=p.getByRole("button",{name:"Cancel",exact:true});
R.cancelButtonsOnPaidOrder=await cancelBtns.count();
log("Cancel buttons visible on the PAID order:",R.cancelButtonsOnPaidOrder);
let cancelResp=null;
if(R.cancelButtonsOnPaidOrder>0){
  const h2=r=>{if(/\/items\/.*\/cancel/.test(r.url())) cancelResp={status:r.status(),url:r.url()};};
  p.on("response",h2);
  await cancelBtns.first().click(); await p.waitForTimeout(6000);
  p.off("response",h2);
}
R.cancelResponse=cancelResp; log("cancel response:",JSON.stringify(cancelResp));
await p.screenshot({path:`${OUT}/G2-after-cancel.png`});
const after=await getOrder(id);
R.statusAfter=after.status; R.derivedAfter=after.derivedStatus; R.totalAfter=after.totalPaisa;
const pay2=await api("GET",`/api/v1/pos/orders/${id}/payments`);
R.paymentsAfterCancel=Array.isArray(pay2.body?.data)?pay2.body.data:[];
const net=R.paymentsAfterCancel.reduce((s,x)=>s+x.amountPaisa,0);
R.netAfterCancel=net;
log("AFTER CANCEL -> status:",after.status,"| derived:",after.derivedStatus,"| totalPaisa:",after.totalPaisa,"| cash still held:",net);
// is it still findable by an operator?
const stillListed=await openOM();
R.stillFindableInOrderManagement=!!stillListed;
log("still findable in Order Management:",R.stillFindableInOrderManagement);
await p.screenshot({path:`${OUT}/G3-order-management-after-cancel.png`});
writeFileSync(`${OUT}/cancelroute-results.json`,JSON.stringify(R,null,2));
await br.close();
