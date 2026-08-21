import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const BASE="http://localhost:3000", GW="http://localhost:8080";
const OUT="../.planning/audits/repair/S0-01/adversarial";
const NO="ORD-20260812-0159", ID="143c1453-e876-41fe-8da8-d3fdfa4edee9";
const R={}; const log=(...a)=>console.log(...a);
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
const raw=(m,pa,bo)=>p.evaluate(async([m,pa,bo,be,gw])=>{const h={Authorization:be,"Idempotency-Key":crypto.randomUUID()};if(bo)h["Content-Type"]="application/json";
  const r=await fetch(gw+pa,{method:m,credentials:"include",headers:h,body:bo?JSON.stringify(bo):undefined});const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t}return{status:r.status,body:j}},[m,pa,bo??null,BEARER,GW]);
async function api(m,pa,bo){for(let i=0;i<25;i++){const r=await raw(m,pa,bo);if(r.status!==503)return r;log("   503, retry");await p.waitForTimeout(10000);}throw new Error("503");}
const branchOf=()=>JSON.parse(Buffer.from(BEARER.split(".")[1],"base64").toString()).branch_id;
// find it in Order Management
let found=false;
for(let a=0;a<6;a++){
  await p.goto(`${BASE}/app/pos`,{waitUntil:"domcontentloaded"});await p.waitForTimeout(7000);
  const tab=p.getByRole("button",{name:"Order Management",exact:true});
  if(await tab.count()){ await tab.first().click(); await p.waitForTimeout(4500); break; }
}
const se=p.locator('[data-testid="order-management-search"]'); if(await se.count()){await se.first().fill(NO);await p.waitForTimeout(4500);}
const n=await p.evaluate(x=>Array.from(document.querySelectorAll('tr')).filter(r=>r.innerText.includes(x)).length,NO);
R.rowsInOrderManagement=n; log("rows in Order Management:",n);
const rowText=await p.evaluate(x=>{const r=Array.from(document.querySelectorAll('tr')).find(r=>r.innerText.includes(x));return r?r.innerText.replace(/\s+/g," "):null;},NO);
R.rowText=rowText; log("row reads:",rowText);
await p.screenshot({path:`${OUT}/H1-om-after-cancel.png`});
if(n){ await p.locator(`tr:has-text("${NO}")`).first().locator('[data-testid^="open-order-"]').click(); await p.waitForTimeout(4000); }
const pr=await p.evaluate(()=>{const q=s=>document.querySelector(s);const v=q('[aria-label="Void order"]'),rf=q('[aria-label="Refund order"]'),nn=q('[data-testid="void-blocked-paid-notice"]');
  return{voidPresent:!!v,refundPresent:!!rf,refundEnabled:rf?!rf.disabled:false,notice:nn?nn.textContent.trim():null}});
R.probeAfterCancel=pr; log("drawer after cancel:",JSON.stringify(pr));
await p.screenshot({path:`${OUT}/H2-drawer-after-cancel.png`});
// can the money still be given back?
const rf=await api("POST",`/api/v1/pos/orders/${ID}/refund`,{refundPaisa:49900,reason:"recoverability probe after line cancel",scope:"FULL"});
R.refundAfterCancel={status:rf.status,body:JSON.stringify(rf.body).slice(0,240)};
log("refund after cancel ->",rf.status,R.refundAfterCancel.body);
const pay=(await api("GET",`/api/v1/pos/orders/${ID}/payments`)).body.data;
R.netAfterRefund=pay.reduce((s,x)=>s+x.amountPaisa,0);
const o=(await api("GET",`/api/v1/pos/orders/${ID}?branchId=${branchOf()}`)).body.data;
R.finalStatus=o.status; R.finalTotal=o.totalPaisa;
log("final: status",o.status,"total",o.totalPaisa,"net cash held",R.netAfterRefund);
writeFileSync(`${OUT}/postcancel-results.json`,JSON.stringify(R,null,2));
await br.close();
