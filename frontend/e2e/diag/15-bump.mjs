import { chromium } from "@playwright/test";
import { login, openAndCheck, shot } from "./lib-login.mjs";
const b = await chromium.launch({ headless: true });
const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
p.on("response", (r) => { if (/kitchen.*(bump|recall|status)/i.test(r.url())) console.log(`  NET ${r.request().method()} ${r.status()} ${r.url().replace("http://localhost:8080","").slice(0,90)}`); });
await login(p, { email: "manager@terrace.local", password: "Terrace#Manager1" });
await openAndCheck(p, "/app/kitchen/DEFAULT", { settle: 6000 });
const before = await p.getByTestId("kds-ticket-card").count();
const first = (await p.getByTestId("kds-ticket-card").first().innerText()).replace(/\n+/g," | ").slice(0,120);
console.log("cards before bump:", before, "| first:", first);
await p.getByTestId("kds-ticket-card").first().click();
await p.waitForTimeout(1200);
await p.keyboard.press("f");           // F = bump
await p.waitForTimeout(3500);
console.log("cards after bump:", await p.getByTestId("kds-ticket-card").count());
console.log("first now:", (await p.getByTestId("kds-ticket-card").first().innerText()).replace(/\n+/g," | ").slice(0,120));
await shot(p, "j1-after-bump");
await p.keyboard.press("r");           // R = recall
await p.waitForTimeout(3500);
console.log("cards after recall:", await p.getByTestId("kds-ticket-card").count());
await shot(p, "j2-after-recall");
await b.close();
