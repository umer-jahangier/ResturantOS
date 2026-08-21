/* Close Till, patiently and three times, capturing DOM + console + network. */
import { chromium } from "@playwright/test";
import { PERSONAS, login, shot, save, visit } from "./fin-lib.mjs";
const log = [];
const say = (s) => { console.log(s); log.push(String(s)); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 240)));
page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 240)); });
const net = [];
page.on("response", (r) => { if (r.url().includes("/api/")) net.push(`${r.status()} ${r.request().method()} ${r.url().replace("http://localhost:8080","")}`); });

await login(page, PERSONAS.cashier);
for (let attempt = 1; attempt <= 3; attempt++) {
  say(`\n===== attempt ${attempt} =====`);
  await visit(page, "/app/pos", { tries: 1, settle: 8000 });
  const btn = page.locator("button", { hasText: /close till/i }).first();
  say(`button found=${await btn.count()} visible=${await btn.isVisible().catch(()=>false)} enabled=${!(await btn.isDisabled().catch(()=>true))}`);
  net.length = 0; errs.length = 0;
  await btn.click();
  await page.waitForTimeout(7000);
  const counts = await page.evaluate(() => ({
    dialog: document.querySelectorAll('[role="dialog"]').length,
    alertdialog: document.querySelectorAll('[role="alertdialog"]').length,
    radixPortal: document.querySelectorAll("[data-radix-portal],[data-radix-popper-content-wrapper]").length,
    dataState: [...document.querySelectorAll('[data-state="open"]')].map((e) => e.tagName + "." + (e.className || "").toString().slice(0, 40)),
    modalish: [...document.querySelectorAll("div")].filter((d) => {
      const s = getComputedStyle(d);
      return (s.position === "fixed") && d.getBoundingClientRect().width > 200 && d.getBoundingClientRect().height > 100;
    }).map((d) => `${(d.className||'').toString().slice(0,50)} ${JSON.stringify(d.getBoundingClientRect().toJSON?.() ?? {})}`).slice(0, 6),
  }));
  say(`DOM after click: ${JSON.stringify(counts, null, 1)}`);
  say(`network: ${net.join(" | ") || "none"}`);
  say(`errors: ${errs.join(" || ") || "none"}`);
  say(`url now: ${page.url()}`);
  const body = await page.locator("body").innerText();
  say(`body mentions count/declare/denomination: ${/declare|counted|denomination|count the drawer/i.test(body)}`);
  await shot(page, `closetill-attempt${attempt}`);
  if (counts.dialog || counts.alertdialog) { say("DIALOG APPEARED"); break; }
}
save("closetill.txt", log.join("\n"));
await browser.close();
