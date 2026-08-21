import { chromium } from "@playwright/test";
import { login, openAndCheck, shot } from "./lib-login.mjs";
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
const pos = await ctx.newPage();
await login(pos, { email: "manager@terrace.local", password: "Terrace#Manager1" });
const p = await openAndCheck(pos, "/app/pos", { settle: 6000 });
console.log("pos h1:", p.h1, "| denied:", p.denied, "| failed:", p.failed, "| alerts:", JSON.stringify(p.alerts).slice(0,150));
const grid = pos.getByTestId("menu-grid");
console.log("menu-grid count:", await grid.count());
const items = await grid.locator("button").allInnerTexts().catch(() => []);
console.log("items:", JSON.stringify(items.map(i => i.split("\n")[0])));
if (!items.length) { console.log("POS BODY:", p.body.replace(/\n+/g," | ").slice(0,600)); await b.close(); process.exit(0); }
await grid.locator("button").first().click();
await pos.waitForTimeout(800);
await pos.getByRole("button", { name: /send to kitchen/i }).first().click();
await pos.waitForTimeout(4500);
console.log("fired:", items[0].split("\n")[0]);

const board = await ctx.newPage();
const r = await openAndCheck(board, "/app/kitchen/DEFAULT", { settle: 6000 });
const n0 = await board.getByTestId("kds-ticket-card").count();
console.log("cards:", n0);
if (!n0) { console.log("board body:", r.body.replace(/\n+/g," | ").slice(0,300)); await b.close(); process.exit(0); }
console.log("first card:", (await board.getByTestId("kds-ticket-card").first().innerText()).replace(/\n+/g," | ").slice(0,160));
await board.getByTestId("kds-ticket-card").first().click();
await board.waitForTimeout(1200);
await board.keyboard.press("f");
await board.waitForTimeout(4000);
const n1 = await board.getByTestId("kds-ticket-card").count();
console.log("cards after F(bump):", n1, "=> BUMP WORKED:", n1 < n0);
await shot(board, "j1-after-bump");
await board.keyboard.press("r");
await board.waitForTimeout(4000);
const n2 = await board.getByTestId("kds-ticket-card").count();
console.log("cards after R(recall):", n2, "=> RECALL WORKED:", n2 > n1);
await shot(board, "j2-after-recall");
await b.close();
