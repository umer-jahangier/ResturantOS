import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const BASE="http://localhost:3000", GW="http://localhost:8080";
const OUT="../.planning/audits/repair/S0-01/adversarial";
const NO=process.env.RESUME_ORDER;
const R={order:NO,failures:[]}; const log=(...a)=>console.log(...a);
const must=(c,m)=>{ if(!c){R.failures.push(m);log("    FAIL:",m);} else log("    ok:",m); };
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
log("signed in; resuming on",NO);
const raw=(m,pa,bo)=>p.evaluate(async([m,pa,bo,be,gw])=>{const h={Authorization:be,"Idempotency-Key":crypto.randomUUID()};if(bo)h["Content-Type"]="application/json";
  const r=await fetch(gw+pa,{method:m,credentials:"include",headers:h,body:bo?JSON.stringify(bo):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return{status:r.status,body:j}},[m,pa,bo??null,BEARER,GW]);
async function api(m,pa,bo){for(let i=0;i<15;i++){const r=await raw(m,pa,bo);if(r.status!==503)return r;log("      503, retry");await p.waitForTimeout(10000);}throw new Error("503 "+pa);}
const branchOf=()=>JSON.parse(Buffer.from(BEARER.split(".")[1],"base64").toString()).branch_id;
const getOrder=async id=>{const r=await api("GET",`/api/v1/pos/orders/${id}?branchId=${branchOf()}`);return r.body.data??r.body;};
async function openOM(){
  for(let a=0;a<6;a++){
    await p.goto(`${BASE}/app/pos`,{waitUntil:"domcontentloaded"});await p.waitForTimeout(7000);
    const tab=p.getByRole("button",{name:"Order Management",exact:true});
    if(await tab.count()){ await tab.first().click(); await p.waitForTimeout(4500); break; }
    log("  OM tab absent — retry",a+1);
  }
  const se=p.locator('[data-testid="order-management-search"]');
  if(await se.count()){ await se.first().fill(NO); await p.waitForTimeout(4000); }
  const row=p.locator(`tr:has-text("${NO}")`).first(); await row.waitFor({timeout:60000});
  const ob=row.locator('[data-testid^="open-order-"]');
  const id=(await ob.getAttribute("data-testid")).replace("open-order-","");
  await ob.click(); await p.waitForTimeout(3500); return id;
}
const id=await openOM(); R.id=id; log("orderId",id);
const before=await getOrder(id); R.statusBefore=before.status; log("status:",before.status);
const pay0=await api("GET",`/api/v1/pos/orders/${id}/payments`);
const rows0=Array.isArray(pay0.body?.data)?pay0.body.data:[];
R.paymentsBefore=rows0; log("payments before:",JSON.stringify(rows0));
must(rows0.reduce((s,r)=>s+r.amountPaisa,0)>0,"resumed order is genuinely PAID");
const pr=await p.evaluate(()=>{const q=s=>document.querySelector(s);const v=q('[aria-label="Void order"]'),rf=q('[aria-label="Refund order"]'),n=q('[data-testid="void-blocked-paid-notice"]');
  return{voidPresent:!!v,refundPresent:!!rf,refundEnabled:rf?!rf.disabled:false,notice:n?n.textContent.trim():null}});
R.probe=pr; log(JSON.stringify(pr));
await p.screenshot({path:`${OUT}/F2-paid-controls.png`});
must(pr.voidPresent===false,"FINAL: Void absent on paid order (restarted service)");
must(pr.refundPresent&&pr.refundEnabled,"FINAL: Refund present+enabled on non-CLOSED paid order");
must(!!pr.notice,`FINAL: reason shown in place of Void — "${pr.notice}"`);
const dv=await api("POST",`/api/v1/pos/orders/${id}/void`,{reason:"final direct void"});
R.directVoid={status:dv.status,title:dv.body?.title,detail:String(dv.body?.detail||"").slice(0,200)};
must(dv.status>=400&&dv.status<500,`FINAL: direct void 4xx (got ${dv.status} ${dv.body?.title})`);
await p.locator('[aria-label="Refund order"]').first().click(); await p.waitForTimeout(1500);
await p.screenshot({path:`${OUT}/F3-refund-panel.png`});
await p.locator('textarea[placeholder*="Wrong item served"]').first().fill("final adversarial confirm — cash returned"); await p.waitForTimeout(600);
await p.locator('button:has-text("Confirm Refund")').first().click(); await p.waitForTimeout(8000);
await p.screenshot({path:`${OUT}/F4-after-refund.png`});
const after=await getOrder(id); R.status=after.status;
must(after.status==="REFUNDED",`FINAL: status REFUNDED (got ${after.status})`);
const pay=await api("GET",`/api/v1/pos/orders/${id}/payments`);
const rows=Array.isArray(pay.body?.data)?pay.body.data:[]; const net=rows.reduce((s,r)=>s+r.amountPaisa,0);
R.payments=rows; R.net=net;
must(rows.length===2&&net===0,`FINAL: tender + negative reversal, net 0 (rows=${rows.length}, net=${net})`);
await p.goto(`${BASE}/app/pos/orders/${id}/charge`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(8000);
await p.screenshot({path:`${OUT}/F5-charge-after-refund.png`,fullPage:true});
const screen=await p.evaluate(()=>document.body.innerText);
R.screenHasRefundRow=/Refund\s*·/.test(screen);
const amtPaid=(screen.match(/Amount paid\s*\n?\s*(Rs[\s ]*[\d,.]+)/)||[])[1];
const remain=(screen.match(/Remaining balance\s*\n?\s*(Rs[\s ]*[\d,.]+)/)||[])[1];
R.screenAmountPaid=amtPaid; R.screenRemaining=remain;
log("screen: amount paid =",amtPaid,"| remaining =",remain,"| refundRow =",R.screenHasRefundRow);
must(R.screenHasRefundRow,"FINAL: the refund row is rendered on the Charge page");
must(/\b0\.00/.test(amtPaid||""),`FINAL: screen 'Amount paid' agrees with API net 0 (screen: ${amtPaid})`);
must(/\b0\.00/.test(remain||""),`FINAL: screen 'Remaining balance' zero on refunded order (screen: ${remain})`);
// persistence
await p.reload({waitUntil:"domcontentloaded"}); await p.waitForTimeout(7000);
const id2=await openOM();
const persist=await p.evaluate(()=>document.body.innerText);
R.persists=/Refunded|REFUNDED/.test(persist);
await p.screenshot({path:`${OUT}/F6-after-reload.png`});
must(R.persists,"FINAL: still reads Refunded after a full reload");
writeFileSync(`${OUT}/final-results.json`,JSON.stringify(R,null,2));
log("\n═══ failures:",R.failures.length); R.failures.forEach(x=>log("  ✗",x));
await br.close(); process.exit(R.failures.length?1:0);
