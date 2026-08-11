import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
const OUT = resolve(process.cwd(), "../.planning/phases/38-erp-design-transformation/evidence");
const BASE="http://localhost:3000";
const M={slug:"floating-terrace",email:"manager@terrace.local",password:"Terrace#Manager1"};
async function login(p,{slug,email,password}){
  await p.goto(`${BASE}/login`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(1200);
  const sf=p.locator('input[name="tenantSlug"], input#tenantSlug'); if(slug&&await sf.count()) await sf.first().fill(slug);
  await p.locator('input[name="email"], input#email').first().fill(email);
  await p.locator('input[name="password"], input#password').first().fill(password);
  await p.locator('button[type="submit"]').first().click(); await p.waitForTimeout(4500);
  return !p.url().includes("/login");
}
const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1440,height:900},colorScheme:"light"});
const p=await ctx.newPage();
let ok=false; for(let i=0;i<6&&!ok;i++){ok=await login(p,M); if(!ok)await p.waitForTimeout(4000);}
if(!ok){console.log("LOGIN FAILED");process.exit(1);}
const out={};
// 1. Skip link + tabs-to-content
await p.goto(`${BASE}/app/purchasing/purchase-orders`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(5000);
out.skipLink = await p.evaluate(()=>{
  const links=Array.from(document.querySelectorAll("a[href^='#']"));
  return {count:links.length, texts:links.map(a=>(a.textContent||"").trim()).slice(0,5)};
});
let tabs=0, reached=null;
for(let i=0;i<60;i++){ await p.keyboard.press("Tab"); await p.waitForTimeout(60); tabs++;
  const inMain=await p.evaluate(()=>{const a=document.activeElement; const m=document.querySelector("main"); return !!(a&&m&&m.contains(a));});
  if(inMain){ reached=await p.evaluate(()=>{const a=document.activeElement;return a.tagName+" :: "+(a.textContent||"").trim().slice(0,30);}); break;} }
out.tabsToReachMain={tabs,reached};
// 2. Row-action button accessible names
await p.goto(`${BASE}/app/tables`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(4000);
out.rowActionButtons = await p.evaluate(()=>Array.from(document.querySelectorAll("main button")).map(bn=>({
  text:(bn.textContent||"").trim().slice(0,20), aria:bn.getAttribute("aria-label"), title:bn.getAttribute("title"),
  hasSvgOnly: bn.children.length===1 && bn.children[0].tagName==="svg" && !(bn.textContent||"").trim(),
})).filter(x=>x.hasSvgOnly||!x.text));
// 3. Sticky headers + table responsiveness containers
await p.goto(`${BASE}/app/inventory/stock`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(5000);
out.tableChrome = await p.evaluate(()=>{
  const t=document.querySelector("table"); if(!t) return null;
  const th=t.querySelector("thead th");
  const wrap=t.closest("div");
  return {
    theadPosition: th?getComputedStyle(th).position:"n/a",
    wrapperOverflow: wrap?getComputedStyle(wrap).overflowX:"n/a",
    tableWidth: Math.round(t.getBoundingClientRect().width),
    wrapperWidth: wrap?Math.round(wrap.getBoundingClientRect().width):0,
    rowHeights:[...new Set(Array.from(t.querySelectorAll("tbody tr")).map(r=>Math.round(r.getBoundingClientRect().height)))],
    hasPagination: !!document.querySelector('[aria-label*="agination" i], nav[role="navigation"]'),
    paginationText: (document.body.innerText.match(/Page \d+ of \d+|Showing \d+/)||[])[0]||null,
    selectionCheckboxes: t.querySelectorAll('input[type="checkbox"]').length,
    nativeSelects: document.querySelectorAll("main select").length,
  };
});
// 4. Toast system: trigger a save and watch
out.toastRegion = await p.evaluate(()=>{
  const r=document.querySelector('[data-sonner-toaster], [aria-live]');
  return r?{tag:r.tagName, live:r.getAttribute("aria-live"), sonner:!!document.querySelector("[data-sonner-toaster]")}:null;
});
// 5. Print path safety on the POS route: containing-block creators
await p.goto(`${BASE}/app/pos`,{waitUntil:"domcontentloaded"}); await p.waitForTimeout(5000);
out.containingBlockOnPos = await p.evaluate(()=>{
  const bad=[];
  for(const el of Array.from(document.querySelectorAll("body *"))){
    const cs=getComputedStyle(el);
    const hits=[];
    if(cs.transform!=="none") hits.push("transform:"+cs.transform.slice(0,30));
    if(cs.filter!=="none") hits.push("filter:"+cs.filter.slice(0,24));
    if(cs.backdropFilter&&cs.backdropFilter!=="none") hits.push("backdrop-filter:"+cs.backdropFilter.slice(0,24));
    if(cs.perspective!=="none") hits.push("perspective");
    if(cs.contain&&/paint|layout|strict|content/.test(cs.contain)) hits.push("contain:"+cs.contain);
    if(cs.willChange&&cs.willChange!=="auto") hits.push("will-change:"+cs.willChange);
    if(hits.length) bad.push({tag:el.tagName, cls:String(el.className).slice(0,60), hits});
  }
  return {count:bad.length, sample:bad.slice(0,10)};
});
// 6. Animations running on POS
out.animationsOnPos = await p.evaluate(()=>document.getAnimations().map(a=>({name:a.animationName||"?", dur:a.effect&&a.effect.getTiming().duration})).slice(0,10));
writeFileSync(`${OUT}/audit-a11y.json`, JSON.stringify(out,null,2));
console.log(JSON.stringify(out,null,2).slice(0,4000));
await b.close();
