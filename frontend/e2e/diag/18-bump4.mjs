import { chromium } from "@playwright/test";
import { login, openAndCheck, shot } from "./lib-login.mjs";
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
const pos = await ctx.newPage();
await login(pos, { email: "manager@terrace.local", password: "Terrace#Manager1" });
const p = await openAndCheck(pos, "/app/pos", { settle: 6000 });
if (/Sign in/.test(p.h1)) { console.log("session expired again at POS"); await b.close(); process.exit(0); }
const grid = pos.getByTestId("menu-grid");
const items = await grid.locator("button").allInnerTexts();
await grid.locator("button").first().click();
await pos.waitForTimeout(800);
await pos.getByRole("button", { name: /send to kitchen/i }).first().click();
await pos.waitForTimeout(4500);
console.log("fired:", items[0].split("\n")[0]);
// SAME page, switch to the board — avoids a second tab going stale
const r = await openAndCheck(pos, "/app/kitchen/DEFAULT", { settle: 6000 });
const n0 = await pos.getByTestId("kds-ticket-card").count();
console.log("board h1:", r.h1, "cards:", n0);
if (!n0) { console.log("board body:", r.body.replace(/\n+/g," | ").slice(0,300)); await b.close(); process.exit(0); }
console.log("first card:", (await pos.getByTestId("kds-ticket-card").first().innerText()).replace(/\n+/g," | ").slice(0,160));
await pos.getByTestId("kds-ticket-card").first().click();
await pos.waitForTimeout(1500);
await pos.keyboard.press("f");
await pos.waitForTimeout(4000);
const n1 = await pos.getByTestId("kds-ticket-card").count();
console.log("after F(bump):", n1, "=> BUMP WORKED:", n1 < n0);
await shot(pos, "j1-after-bump");
await pos.keyboard.press("r");
await pos.waitForTimeout(4000);
const n2 = await pos.getByTestId("kds-ticket-card").count();
console.log("after R(recall):", n2, "=> RECALL WORKED:", n2 > n1);
await shot(pos, "j2-after-recall");
await b.close();
