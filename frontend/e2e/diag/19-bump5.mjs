import { chromium } from "@playwright/test";
import { login, openAndCheck, shot } from "./lib-login.mjs";
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({ viewport: { width: 1500, height: 950 } });
const pg = await ctx.newPage();
await login(pg, { email: "manager@terrace.local", password: "Terrace#Manager1" });
const p = await openAndCheck(pg, "/app/pos", { settle: 6000 });
if (/Sign in/.test(p.h1)) { console.log("session expired"); await b.close(); process.exit(0); }
const grid = pg.getByTestId("menu-grid");
const items = await grid.locator("button").allInnerTexts();
await grid.locator("button").first().click();
await pg.waitForTimeout(800);
await pg.getByRole("button", { name: /send to kitchen/i }).first().click();
await pg.waitForTimeout(4500);
console.log("fired:", items[0].split("\n")[0]);

const r = await openAndCheck(pg, "/app/kitchen/DEFAULT", { settle: 6000 });
const n0 = await pg.getByTestId("kds-ticket-card").count();
console.log("board cards:", n0);
if (!n0) { await b.close(); process.exit(0); }
console.log("card[0]:", (await pg.getByTestId("kds-ticket-card").first().innerText()).replace(/\n+/g," | ").slice(0,140));
// select via KEYBOARD (arrow), never click — clicking opens the detail route
await pg.locator("body").click({ position: { x: 900, y: 900 } }); // focus board chrome, not a card
await pg.waitForTimeout(500);
await pg.keyboard.press("ArrowDown");
await pg.waitForTimeout(800);
await shot(pg, "k0-selected-via-keyboard");
console.log("url before bump:", pg.url());
await pg.keyboard.press("f");
await pg.waitForTimeout(4000);
console.log("url after bump :", pg.url());
const n1 = await pg.getByTestId("kds-ticket-card").count();
console.log("cards after F:", n1, "=> BUMPED EXACTLY ONE:", n1 === n0 - 1);
await shot(pg, "k1-after-bump");
await pg.keyboard.press("r");
await pg.waitForTimeout(4000);
const n2 = await pg.getByTestId("kds-ticket-card").count();
console.log("cards after R:", n2, "=> RECALL RESTORED IT:", n2 === n0);
await shot(pg, "k2-after-recall");
await b.close();
