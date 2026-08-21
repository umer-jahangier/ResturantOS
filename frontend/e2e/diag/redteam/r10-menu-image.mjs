import { BASE, P, shot, healthCheck, login, newBrowser } from "./lib.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

// build a real PNG so the magic-byte check passes
function png(file, w=120, h=120) {
  const raw=[]; for(let y=0;y<h;y++){raw.push(0);for(let x=0;x<w;x++)raw.push(220,40,40);}
  const crcT=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcT[n]=c>>>0;}
  const chunk=(t,d)=>{const b=Buffer.concat([Buffer.from(t,"ascii"),d]);const l=Buffer.alloc(4);l.writeUInt32BE(d.length);
    let crc=0xffffffff;for(const x of b)crc=crcT[(crc^x)&0xff]^(crc>>>8);const c=Buffer.alloc(4);c.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([l,b,c]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;
  const buf=Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),chunk("IHDR",ihdr),chunk("IDAT",deflateSync(Buffer.from(raw))),chunk("IEND",Buffer.alloc(0))]);
  mkdirSync("/private/tmp/claude-501/-Users-muhammadumer-Documents-Projects-ResturantOS/b8e6f92e-7d80-4d4f-b270-4f05a9458825/scratchpad",{recursive:true});
  writeFileSync(file,buf); return file;
}
const FIXTURE = png("/private/tmp/claude-501/-Users-muhammadumer-Documents-Projects-ResturantOS/b8e6f92e-7d80-4d4f-b270-4f05a9458825/scratchpad/redteam.png");

const { browser, page } = await newBrowser();
if (!await login(page, P.manager)) { await browser.close(); process.exit(1); }
await page.goto(`${BASE}/app/menu/items`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);
await healthCheck(page, "menu-items");
await shot(page, "r10-01-menu-items");
const list = await page.evaluate(()=>({
  imgs: [...document.querySelectorAll("img")].map(i=>({alt:i.alt, src:i.src.slice(0,40), nw:i.naturalWidth})),
  rows: (document.querySelector("table")?.querySelectorAll("tbody tr").length)??0,
}));
console.log("MENU LIST:", JSON.stringify(list, null, 1));

// open the action menu for a specific item and Edit
const target = "Chicken Karahi";
await page.locator(`button[aria-label*="${target}"]`).first().click();
await page.waitForTimeout(1500);
await page.getByRole("menuitem", { name: /Edit/i }).click().catch(async()=>{ await page.locator('text=Edit').first().click(); });
await page.waitForTimeout(2500);
await shot(page, "r10-02-edit-dialog");
const dlg = await page.evaluate(()=>{
  const d=document.querySelector('[role="dialog"]');
  if(!d) return {found:false};
  const r=d.getBoundingClientRect();
  return { found:true, w:Math.round(r.width), h:Math.round(r.height),
    fields:[...d.querySelectorAll("label")].map(l=>l.textContent.trim().slice(0,40)),
    fileInputs:d.querySelectorAll('input[type=file]').length,
    text:d.innerText.replace(/\n+/g," | ").slice(0,700) };
});
console.log("EDIT DIALOG:", JSON.stringify(dlg, null, 1));

if (dlg.fileInputs) {
  await page.locator('[role="dialog"] input[type=file]').first().setInputFiles(FIXTURE);
  await page.waitForTimeout(5000);
  await shot(page, "r10-03-after-file-choose");
  console.log("AFTER UPLOAD DIALOG:", await page.evaluate(()=>document.querySelector('[role="dialog"]')?.innerText.replace(/\n+/g," | ").slice(0,600)));
  const save = page.locator('[role="dialog"] button[type="submit"], [role="dialog"] button:has-text("Save")');
  console.log("SAVE BUTTONS:", await save.count());
  await save.first().click();
  await page.waitForTimeout(6000);
  await healthCheck(page, "after-save");
  await shot(page, "r10-04-after-save");
  const after = await page.evaluate(()=>({
    dialogOpen: !!document.querySelector('[role="dialog"]'),
    imgs:[...document.querySelectorAll("img")].map(i=>({alt:i.alt,nw:i.naturalWidth,src:i.src.slice(0,30)})),
    body: document.body.innerText.replace(/\n+/g," | ").slice(0,400),
  }));
  console.log("AFTER SAVE:", JSON.stringify(after, null, 1));

  // RELOAD to prove persistence
  await page.reload({waitUntil:"domcontentloaded"});
  await page.waitForTimeout(7000);
  const persisted = await page.evaluate(()=>[...document.querySelectorAll("img")].map(i=>({alt:i.alt,nw:i.naturalWidth,src:i.src.slice(0,30)})));
  console.log("AFTER RELOAD IMGS:", JSON.stringify(persisted));
  await shot(page, "r10-05-after-reload");
}

// AND NOW: does it show at the till?
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);
const till = await page.evaluate(()=>{
  const g=document.querySelector('[data-testid="menu-grid"]');
  return { imgs:g?g.querySelectorAll("img").length:-1, tiles:g?g.querySelectorAll(":scope > div").length:-1 };
});
console.log("POS GRID AFTER UPLOAD:", JSON.stringify(till));
await shot(page, "r10-06-pos-after-upload");
await browser.close();
