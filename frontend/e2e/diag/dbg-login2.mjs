import { chromium } from "@playwright/test";
const OUT="/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/nlq-analytics-recheck";
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1440,height:1000}})).newPage();
p.on("response",async r=>{if(/\/api\/v1\/auth/.test(r.url()))console.log("NET",r.status(),r.request().method(),r.url(),(await r.text().catch(()=>"")).slice(0,220));});
await p.goto("http://localhost:3000/login",{waitUntil:"domcontentloaded"});
await p.waitForTimeout(1800);
await p.locator('button:has-text("Use a restaurant identifier instead")').click();
await p.waitForTimeout(1200);
console.log("INPUTS:", JSON.stringify(await p.evaluate(()=>Array.from(document.querySelectorAll("input")).map(e=>`[name=${e.name}] ph=${e.placeholder}`))));
const slug=p.locator('input[name="tenantSlug"], input#tenantSlug');
if(await slug.count()) await slug.first().fill("floating-terrace");
else { const all=p.locator('input:not([type=password]):not([type=email])'); if(await all.count()) await all.first().fill("floating-terrace"); }
await p.locator('input[name="email"]').first().fill("owner@terrace.local");
await p.locator('input[name="password"]').first().fill("Terrace#Owner1");
await p.locator('button[type="submit"]').first().click();
await p.waitForTimeout(4500);
console.log("URL:", p.url());
console.log("TEXT:", (await p.evaluate(()=>document.body.innerText)).slice(0,800));
await p.screenshot({path:`${OUT}/dbg-owner-login-slug.png`,fullPage:true});
// also: manager and accountant for contrast
for (const [em,pw] of [["accountant@terrace.local","Terrace#Accountant1"],["admin@terrace.local","Terrace#Admin1"]]) {
  await p.goto("http://localhost:3000/login",{waitUntil:"domcontentloaded"}); await p.waitForTimeout(1500);
  await p.locator('input[name="email"]').first().fill(em);
  await p.locator('input[name="password"]').first().fill(pw);
  await p.locator('button[type="submit"]').first().click();
  await p.waitForTimeout(4000);
  console.log(`${em} -> ${p.url()} | ${(await p.evaluate(()=>document.body.innerText)).replace(/\n+/g,' / ').slice(0,220)}`);
}
await b.close();
