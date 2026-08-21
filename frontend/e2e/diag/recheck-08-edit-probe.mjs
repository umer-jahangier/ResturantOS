// DIAGNOSIS ONLY — does the Subscription "Edit" control do ANYTHING? Compare the page
// before and after the click (URL, inputs, dialogs, text) rather than assuming a dialog.
import { launch, shot, makeLog, BASE } from "./recheck-lib.mjs";

const { say, flush } = makeLog("08-edit-probe-log");
const SA = { email: "superadmin@softxlogic.com", password: "Test@123!" };
const FT = "d108c2e6-a70d-49c8-acdc-37531fd752d8";

const snap = (page) =>
  page.evaluate(() => ({
    url: location.href,
    dialogs: document.querySelectorAll('[role="dialog"]').length,
    inputs: Array.from(document.querySelectorAll("input,select,textarea")).map(
      (e) => `${e.tagName}:${e.getAttribute("name") || e.getAttribute("aria-label") || e.getAttribute("placeholder") || ""}`
    ),
    subscriptionSection: (() => {
      const h = Array.from(document.querySelectorAll("h1,h2,h3,h4")).find((x) => /subscription/i.test(x.textContent));
      return h && h.parentElement ? h.parentElement.innerText.replace(/\n/g, " | ").slice(0, 400) : null;
    })(),
  }));

async function main() {
  const { browser, ctx } = await launch();
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 200)); });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.locator('input[name="email"], input#email').first().fill(SA.email);
  await page.locator('input[name="password"], input#password').first().fill(SA.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);

  await page.goto(`${BASE}/platform/tenants/${FT}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  const before = await snap(page);
  say("BEFORE:", JSON.stringify(before));

  const edit = page.locator('button:has-text("Edit")').first();
  const box = await edit.boundingBox();
  say("Edit button box:", JSON.stringify(box), "visible:", await edit.isVisible(), "enabled:", !(await edit.isDisabled()));
  await edit.click();
  await page.waitForTimeout(3000);

  const after = await snap(page);
  say("AFTER :", JSON.stringify(after));
  say("URL changed:", before.url !== after.url);
  say("dialog appeared:", after.dialogs > before.dialogs);
  say("new inputs appeared:", after.inputs.length > before.inputs.length,
      `(${before.inputs.length} -> ${after.inputs.length})`);
  say("page errors:", JSON.stringify(errs.slice(0, 5)));
  await shot(page, "61-after-edit-click", say);

  await finish(browser);
}

async function finish(browser) { await browser.close().catch(() => {}); flush(); }
main().catch((e) => { say("FATAL " + e.stack); flush(); process.exit(1); });
