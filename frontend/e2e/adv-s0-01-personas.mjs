import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const BASE="http://localhost:3000", GW="http://localhost:8080";
const OUT="../.planning/audits/repair/S0-01/adversarial";
const R={failures:[]}; const log=(...a)=>console.log(...a);
const must=(c,m)=>{ if(!c){R.failures.push(m);log("    FAIL:",m);} else log("    ok:",m); };
let BEARER=null;

const PEOPLE={
  manager:{slug:"floating-terrace",email:"manager@terrace.local",password:"Terrace#Manager1"},
  cashier:{slug:"floating-terrace",email:"cashier@terrace.local",password:"Terrace#Cashier1"},
};

async function waitWarm(){
  for(let i=0;i<60;i++){
    const r=await fetch(`${GW}/actuator/health`).catch(()=>null);
    const t=await fetch(`${GW}/api/v1/pos/menu/items?branchId=x`).catch(()=>null);
    if(t && t.status!==503) return;
    await new Promise(r=>setTimeout(r,5000));
  }
  throw new Error("pos-service never came back");
}

function mk(page){
  page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(120000);
  page.on("request",r=>{const a=r.headers()["authorization"]; if(a&&a.startsWith("Bearer ")) BEARER=a;});
}
async function login(page,who){
  BEARER=null;
  await page.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"}); await page.waitForTimeout(1500);
  const s=page.locator('input[name="tenantSlug"], input#tenantSlug'); if(await s.count()) await s.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  for(let i=0;i<25&&page.url().includes("/login");i++) await page.waitForTimeout(1500);
  if(page.url().includes("/login")) throw new Error("login failed "+who.email);
  await page.waitForTimeout(2500);
}
async function raw(page,m,path,body){
  return page.evaluate(async([m,pa,bo,be,gw])=>{const h={Authorization:be,"Idempotency-Key":crypto.randomUUID()};if(bo)h["Content-Type"]="application/json";
    const r=await fetch(gw+pa,{method:m,credentials:"include",headers:h,body:bo?JSON.stringify(bo):undefined});
    const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return{status:r.status,body:j}},[m,path,body??null,BEARER,GW]);
}
/** 503 is a sibling agent restarting pos-service, not a product answer. Retry it. */
async function api(page,m,path,body){
  for(let i=0;i<12;i++){
    const r=await raw(page,m,path,body);
    if(r.status!==503) return r;
    log("      503 (service restarting) — retrying in 10s");
    await page.waitForTimeout(10000);
  }
  throw new Error("persistent 503 on "+path);
}
const branchOf=()=>JSON.parse(Buffer.from(BEARER.split(".")[1],"base64").toString()).branch_id;
async function getOrder(page,id){const r=await api(page,"GET",`/api/v1/pos/orders/${id}?branchId=${branchOf()}`); if(r.status!==200) throw new Error(`getOrder ${r.status}`); return r.body.data??r.body;}
async function ensureTill(page){
  const b=page.locator('[data-testid="open-till-button"]');
  if(await b.count()){ log("    opening a till"); await b.first().click(); await page.waitForTimeout(1200);
    await page.locator('[data-testid="open-till-panel"] input[type="number"]').first().fill("5000.00"); await page.waitForTimeout(400);
    await page.locator('[data-testid="open-till-confirm-button"]').click(); await page.waitForTimeout(6000);
    const e=page.locator('[data-testid="open-till-error"]'); if(await e.count()) throw new Error("open till failed: "+await e.first().textContent()); }
}
async function ringAndFire(page){
  await page.goto(`${BASE}/app/pos`,{waitUntil:"domcontentloaded"}); await page.waitForTimeout(7000);
  await ensureTill(page);
  const t=page.getByRole("button",{name:"Terminal",exact:true}); if(await t.count()){await t.first().click().catch(()=>{});await page.waitForTimeout(2500);}
  const tiles=page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({timeout:60000});
  await tiles.nth(0).click(); await page.waitForTimeout(700);
  await page.locator('[data-testid="send-to-kitchen-button"]').click(); await page.waitForTimeout(6000);
  const no=await page.evaluate(()=>(document.body.innerText.match(/ORD-\d{8}-\d+/)||[null])[0]);
  if(!no) throw new Error("no order no"); return no;
}
async function openFromOM(page,no){
  await page.goto(`${BASE}/app/pos`,{waitUntil:"domcontentloaded"}); await page.waitForTimeout(3500);
  await page.getByRole("button",{name:"Order Management",exact:true}).click(); await page.waitForTimeout(3500);
  const se=page.locator('[data-testid="order-management-search"]'); if(await se.count()){await se.first().fill(no);await page.waitForTimeout(3500);}
  const row=page.locator(`tr:has-text("${no}")`).first(); await row.waitFor({timeout:40000});
  const ob=row.locator('[data-testid^="open-order-"]');
  const id=(await ob.getAttribute("data-testid")).replace("open-order-","");
  await ob.click(); await page.waitForTimeout(3000); return id;
}
const probe=p=>p.evaluate(()=>{const q=s=>document.querySelector(s);const v=q('[aria-label="Void order"]'),rf=q('[aria-label="Refund order"]'),n=q('[data-testid="void-blocked-paid-notice"]');
  return{voidPresent:!!v,voidEnabled:v?!v.disabled:false,refundPresent:!!rf,refundEnabled:rf?!rf.disabled:false,notice:n?n.textContent.trim():null}});
async function charge(page,id,rupees){
  await page.goto(`${BASE}/app/pos/orders/${id}/charge`,{waitUntil:"domcontentloaded"}); await page.waitForTimeout(6000);
  const f=page.locator('input[aria-label="Amount (Rs)"]').first(); await f.waitFor({timeout:40000});
  if(rupees!=null) await f.fill(String(rupees));
  else { const o=await getOrder(page,id); await f.fill(`${Math.floor(o.totalPaisa/100)}.${String(o.totalPaisa%100).padStart(2,"0")}`); }
  await page.waitForTimeout(800);
  let st=null; const h=r=>{if(r.request().method()==="POST"&&/\/pos\/orders\/.*\/payments/.test(r.url())) st=r.status();};
  page.on("response",h);
  await page.locator('[data-testid="record-payment-button"]').first().click();
  await page.waitForTimeout(7000); page.off("response",h);
  log("    POST payments ->",st);
  if(st!==200&&st!==201) throw new Error("payment did not record: "+st);
}
const list=b=>Array.isArray(b?.data)?b.data:Array.isArray(b)?b:[];

await waitWarm();
const br=await chromium.launch();

// ══ C/D: manager, UNPAID order — void must STILL work; then no payment on a VOIDED order ══
{
  const c=await br.newContext({viewport:{width:1440,height:950}}); const p=await c.newPage(); mk(p);
  await login(p,PEOPLE.manager); log("[C] manager signed in");
  const no=await ringAndFire(p); const id=await openFromOM(p,no);
  log("    C order",no,id);
  const pr=await probe(p); R.C_probe=pr; log("   ",JSON.stringify(pr));
  await p.screenshot({path:`${OUT}/C1-unpaid-controls.png`});
  must(pr.voidPresent===true,"C: Void trigger IS present on an unpaid order (no regression)");
  await p.locator('[aria-label="Void order"]').first().click(); await p.waitForTimeout(1200);
  await p.locator('textarea').first().fill("adversarial recheck — unpaid, guest walked"); await p.waitForTimeout(500);
  await p.locator('button:has-text("Confirm Void")').first().click(); await p.waitForTimeout(7000);
  await p.screenshot({path:`${OUT}/C2-after-void.png`});
  const o=await getOrder(p,id); R.C_status=o.status;
  must(o.status==="VOIDED",`C: unpaid order still voidable through the UI (got ${o.status})`);
  const pv=await api(p,"POST",`/api/v1/pos/orders/${id}/payments`,{method:"CASH",amountPaisa:10000});
  R.D_payOnVoided={status:pv.status,body:JSON.stringify(pv.body).slice(0,200)};
  must(pv.status>=400,`D: a payment cannot be recorded on a VOIDED order (got ${pv.status})`);
  await c.close();
}

// ══ E: WRONG PERSONA — cashier ══
{
  const c=await br.newContext({viewport:{width:1440,height:950}}); const p=await c.newPage(); mk(p);
  await login(p,PEOPLE.cashier); log("[E] cashier signed in");
  const perms=JSON.parse(Buffer.from(BEARER.split(".")[1],"base64").toString()).permissions.filter(x=>/void|refund/.test(x));
  R.E_cashierVoidRefundPerms=perms; log("    cashier void/refund perms:",perms.join(","));
  const no=await ringAndFire(p); const id=await openFromOM(p,no);
  log("    E order",no,id);
  await charge(p,id,null);
  const pay=await api(p,"GET",`/api/v1/pos/orders/${id}/payments`);
  const net=list(pay.body).reduce((s,r)=>s+r.amountPaisa,0); R.E_net=net;
  must(net>0,`E: cashier's own order is paid (${net} paisa)`);
  await openFromOM(p,no);
  const pr=await probe(p); R.E_probe=pr; log("   ",JSON.stringify(pr));
  await p.screenshot({path:`${OUT}/E1-cashier-paid-controls.png`});
  must(pr.voidPresent===false,"E: cashier sees NO Void on their own PAID order");
  const dv=await api(p,"POST",`/api/v1/pos/orders/${id}/void`,{reason:"adversarial cashier void"});
  R.E_directVoid={status:dv.status,body:JSON.stringify(dv.body).slice(0,240)};
  must(dv.status>=400&&dv.status<500,`E: cashier direct void on a PAID order is 4xx (got ${dv.status})`);
  const after=await getOrder(p,id); R.E_statusAfter=after.status;
  must(after.status!=="VOIDED",`E: cashier's paid order NOT voided (status ${after.status})`);
  // did the fix WIDEN anything? a cashier must not gain a manager's refund power
  const rf=await api(p,"POST",`/api/v1/pos/orders/${id}/refund`,{refundPaisa:net,reason:"adversarial cashier refund",scope:"FULL"});
  R.E_directRefund={status:rf.status,body:JSON.stringify(rf.body).slice(0,240)};
  log("    E cashier direct REFUND ->",rf.status,JSON.stringify(rf.body).slice(0,200));
  const after2=await getOrder(p,id); R.E_statusAfterRefundAttempt=after2.status;
  log("    E status after cashier refund attempt:",after2.status);
  await c.close();
}

writeFileSync(`${OUT}/cde-results.json`,JSON.stringify(R,null,2));
log("\n═══ failures:",R.failures.length); R.failures.forEach(f=>log("  ✗",f));
await br.close();
process.exit(R.failures.length?1:0);
