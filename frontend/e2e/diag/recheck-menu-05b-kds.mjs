import { chromium } from "@playwright/test";
const BASE="http://localhost:3000", OUT="/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/menu-recheck";
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1500,height:1000}})).newPage();
await p.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(2500);
const s=p.locator('input[name="tenantSlug"], input#tenantSlug'); if(await s.count()) await s.first().fill("floating-terrace");
await p.locator('input#email, input[name="email"]').first().fill("kitchen@terrace.local");
await p.locator('input#password, input[name="password"]').first().fill("Terrace#Kitchen1");
await p.locator('button[type="submit"]').first().click(); await p.waitForTimeout(6000);
await p.goto(`${BASE}/app/kitchen/DEFAULT`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(6000);
await p.screenshot({path:`${OUT}/R41-kds-default-board.png`, fullPage:true});
const r=await p.evaluate(()=>{const t=document.body.innerText;const i=t.indexOf("ORD-20260812-0021");
 return {url:location.pathname, order:i>=0, around:i>=0?t.slice(Math.max(0,i-80),i+400).replace(/\s+/g," "):null,
   deadbeef:/deadbeef-0000-4000-8000-00000000abcd/.test(t), alerts:[...document.querySelectorAll('[role=alert]')].map(e=>e.textContent.trim()), head:t.slice(0,300).replace(/\s+/g," ")};});
console.log(JSON.stringify(r,null,1));
if(r.order){ await p.getByText("ORD-20260812-0021").first().click().catch(()=>{}); await p.waitForTimeout(4000);
 await p.screenshot({path:`${OUT}/R42-kds-ticket-detail.png`, fullPage:true});
 console.log("DETAIL:",JSON.stringify(await p.evaluate(()=>({url:location.pathname,deadbeef:/deadbeef/.test(document.body.innerText),txt:document.body.innerText.replace(/\s+/g," ").slice(0,900)}))));}
await b.close();
