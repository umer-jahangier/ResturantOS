import { chromium } from "@playwright/test";
const BASE="http://localhost:3000";
const OUT="/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/menu-recheck";
const b=await chromium.launch(); const p=await (await b.newContext({viewport:{width:1500,height:1000}})).newPage();
await p.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(6000);
await p.locator("input#email, input[name=email]").first().fill("waiter@terrace.local");
await p.locator("input#password, input[name=password]").first().fill("Terrace#Waiter1");
await p.locator('button[type="submit"]').first().click(); await p.waitForTimeout(7000);
await p.goto(`${BASE}/app/pos`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(6000);

const state=async(tag)=>{const r=await p.evaluate(()=>({url:location.pathname,
 grid:document.querySelectorAll('[data-testid="menu-grid"] button[aria-pressed]').length,
 imgs:document.querySelectorAll("img").length,
 tabs:[...document.querySelectorAll('[role=tab],button')].map(e=>e.textContent.trim()).filter(t=>t&&t.length<26).slice(0,18),
 txt:document.body.innerText.replace(/\s+/g," ").slice(0,420)}));
 console.log(tag,JSON.stringify(r)); await p.screenshot({path:`${OUT}/${tag}.png`}); return r;};

await state("R70-waiter-pos");
// Floor View
for(const name of ["Floor View","Order Management"]){
  const t=p.getByRole("tab",{name}).or(p.getByRole("button",{name}));
  if(await t.count()){ await t.first().click(); await p.waitForTimeout(5000); await state(`R71-waiter-${name.replace(/\s/g,"")}`);}
}
// try clicking a table
const tbl=p.locator('[data-testid*="table"], button').filter({hasText:/^T-?\d|Table \d/});
console.log("table-ish buttons:",await tbl.count());
if(await tbl.count()){ await tbl.first().click(); await p.waitForTimeout(5000); await state("R72-waiter-after-table");}
await b.close();
