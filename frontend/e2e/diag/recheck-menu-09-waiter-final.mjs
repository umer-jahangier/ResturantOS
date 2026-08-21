import { chromium } from "@playwright/test";
const BASE="http://localhost:3000";
const OUT="/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/menu-recheck";
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1500,height:1000}})).newPage();
await p.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(6000);
await p.locator("input#email, input[name=email]").first().fill("waiter@terrace.local");
await p.locator("input#password, input[name=password]").first().fill("Terrace#Waiter1");
await p.locator('button[type="submit"]').first().click(); await p.waitForTimeout(7000);
const st=async(t)=>{const r=await p.evaluate(()=>({url:location.pathname,grid:document.querySelectorAll('[data-testid="menu-grid"] button[aria-pressed]').length,imgs:document.querySelectorAll("img").length,dialogs:document.querySelectorAll('[role=dialog]').length,txt:document.body.innerText.replace(/\s+/g," ").slice(0,380)}));console.log(t,JSON.stringify(r));await p.screenshot({path:`${OUT}/${t}.png`});return r;};

await p.goto(`${BASE}/app/pos`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(6000);
// A) Floor View -> click an AVAILABLE table
await p.getByRole("tab",{name:"Floor View"}).or(p.getByRole("button",{name:"Floor View"})).first().click(); await p.waitForTimeout(4000);
const h1=p.locator("button,div[role=button]").filter({hasText:/^H1/}).first();
console.log("H1 tile count:",await p.locator("button,div[role=button]").filter({hasText:/^H1/}).count());
await h1.click({force:true}).catch(e=>console.log("H1 click err:",e.message.slice(0,80)));
await p.waitForTimeout(6000); await st("R80-waiter-clicked-available-table");

// B) Order Management -> Continue an existing draft
await p.goto(`${BASE}/app/pos`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(5000);
await p.getByRole("tab",{name:"Order Management"}).or(p.getByRole("button",{name:"Order Management"})).first().click(); await p.waitForTimeout(4000);
const cont=p.getByRole("button",{name:"Continue"});
console.log("Continue buttons:",await cont.count());
if(await cont.count()){await cont.first().click(); await p.waitForTimeout(6000); await st("R81-waiter-continue-order");}
await b.close();
