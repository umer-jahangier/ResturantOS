/* Capture the exact bearer token the browser uses on the failing period-close call. */
import { chromium } from "@playwright/test";
import { PERSONAS, login, save, visit } from "./fin-lib.mjs";

const log = [];
const say = (s) => {
  console.log(s);
  log.push(String(s));
};
const dec = (jwt) => {
  try {
    const p = jwt.split(".")[1];
    return JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  } catch {
    return { err: "undecodable" };
  }
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();

const seen = [];
page.on("request", (r) => {
  const auth = r.headers()["authorization"];
  if (auth && r.url().includes("/api/")) seen.push({ url: r.url().replace("http://localhost:8080", ""), method: r.method(), tok: auth.replace("Bearer ", "") });
});
page.on("response", async (r) => {
  if (/periods\/.*\/close|auth\/(login|refresh)/.test(r.url())) say(`RESP ${r.status()} ${r.request().method()} ${r.url().replace("http://localhost:8080", "")}`);
});

await login(page, PERSONAS.accountant);
say("logged in with TOTP");
const justAfterLogin = seen[seen.length - 1];
if (justAfterLogin) {
  const c = dec(justAfterLogin.tok);
  say(`token right after TOTP login: totp_verified=${c.totp_verified} iat=${c.iat} exp=${c.exp}`);
}

await visit(page, "/app/finance/periods");
seen.length = 0;
await page.locator("button", { hasText: /close period/i }).nth(1).click(); // Period 2
await page.waitForTimeout(2000);
await page.locator('[role="dialog"],[role="alertdialog"]').first().locator("button", { hasText: /^close period$/i }).first().click();
await page.waitForTimeout(6000);

const closeReq = seen.find((s) => /periods\/.*\/close/.test(s.url));
if (closeReq) {
  const c = dec(closeReq.tok);
  say(`\nTOKEN SENT ON THE CLOSE CALL:`);
  say(`  totp_verified = ${c.totp_verified}`);
  say(`  roles         = ${JSON.stringify(c.roles)}`);
  say(`  iat/exp       = ${c.iat}/${c.exp}`);
  say(`  has finance.period.close permission = ${(c.permissions || []).includes("finance.period.close")}`);
} else {
  say("no close request captured; requests seen: " + JSON.stringify(seen.map((s) => s.url).slice(0, 20)));
}
say(`\nalerts: ${JSON.stringify(await page.locator('[role="alert"]').allInnerTexts())}`);
save("token-probe.txt", log.join("\n"));
await browser.close();
