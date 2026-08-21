import { chromium } from "@playwright/test";
const BASE="http://localhost:3000";
const OUT="/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/menu-recheck";
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1400,height:900}})).newPage();
const fails=[]; p.on("response",r=>{if(r.status()>=400&&r.url().includes("/api/"))fails.push(`${r.status()} ${r.url().replace("http://localhost:8080","")}`);});
await p.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(3000);
await p.locator('input#email, input[name="email"]').first().fill("waiter@terrace.local");
await p.locator('input#password, input[name="password"]').first().fill("Terrace#Waiter1");
await p.locator('button[type="submit"]').first().click();
await p.waitForTimeout(8000);
console.log("url:",p.url());
console.log("text:",await p.evaluate(()=>document.body.innerText.replace(/\s+/g," ").slice(0,400)));
console.log("fails:",JSON.stringify(fails));
await p.screenshot({path:`${OUT}/R63-waiter-login-debug.png`});
if(!p.url().includes("/login")){
 for(const r of ["/app/pos","/app/menu/items"]){
  await p.goto(`${BASE}${r}`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(6000);
  console.log(r,JSON.stringify(await p.evaluate(()=>({url:location.pathname,grid:document.querySelectorAll('[data-testid="menu-grid"] button[aria-pressed]').length,imgs:document.querySelectorAll("img").length,denied:/Access denied|permission/i.test(document.body.innerText),txt:document.body.innerText.replace(/\s+/g," ").slice(0,300)}))));
  await p.screenshot({path:`${OUT}/R63-waiter${r.replace(/\//g,"-")}.png`});
 }
}
await b.close();
