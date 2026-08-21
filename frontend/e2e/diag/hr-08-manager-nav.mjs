/* Pass 8: does the branch MANAGER — the person who runs the roster — have any way to reach HR? */
import { newBrowser, ctxPage, login, visit, shot, PERSONAS } from "./hr-lib.mjs";

const browser = await newBrowser();
const { page } = await ctxPage(browser);
await login(page, PERSONAS.manager);
await page.waitForTimeout(2000);
await shot(page, "08-manager-dashboard");
const full = await page.locator("body").innerText();
console.log("=== FULL manager chrome text ===");
console.log(full.slice(0, 1800));
console.log("\nlinks whose href contains /hr:", JSON.stringify(await page.locator('a[href*="/hr"]').allInnerTexts()));
console.log("all sidebar links:", JSON.stringify(await page.locator('aside a, nav a').allInnerTexts()));

// what does the manager's token actually carry?
const perms = await page.evaluate(async () => {
  const r = await fetch("/api/v1/auth/me", { credentials: "include" });
  return { status: r.status, body: (await r.text()).slice(0, 1500) };
});
console.log("\n/auth/me ->", perms.status, perms.body);

await visit(page, "/app/hr/employees", { persona: PERSONAS.manager });
await shot(page, "08-manager-employees-by-url");
console.log("\nmanager on /app/hr/employees, salary column present:",
  /Rs [\d,]+\.\d\d/.test(await page.locator("body").innerText()));
await browser.close();
