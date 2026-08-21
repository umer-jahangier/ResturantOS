/* Re-login before every flow so a session drop can never be misread as a missing feature. */
import { chromium } from "@playwright/test";
import { BASE, PERSONAS, login, shot, save, visit } from "./fin-lib.mjs";

const log = [];
const say = (s) => {
  console.log(s);
  log.push(String(s));
};

const browser = await chromium.launch();

async function fresh(who = "accountant") {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  page.net = [];
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/")) page.net.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")}`);
  });
  if (!(await login(page, PERSONAS[who]))) throw new Error(`login failed for ${who}`);
  return { ctx, page };
}

/** Guard: if we are on /login the observation is void. */
async function assertLive(page, what) {
  if (page.url().includes("/login")) {
    say(`!! SESSION DROPPED before ${what} — url ${page.url()}. Observation VOID.`);
    return false;
  }
  return true;
}

/* ---------- 3. CREATE A JOURNAL ENTRY ---------- */
{
  const { ctx, page } = await fresh();
  say("\n===== 3. CREATE A JOURNAL ENTRY (accountant) =====");
  await visit(page, "/app/finance/journal-entries/new");
  if (await assertLive(page, "JE form")) {
    const txt = await page.locator("body").innerText();
    say(`date label: ${(txt.match(/Selected: [\d-]+/) || ["<none>"])[0]}`);
    const ctrls = await page.evaluate(() =>
      [...document.querySelectorAll("input,select,textarea,button")].map(
        (e) =>
          `${e.tagName}<${e.getAttribute("type") || ""}>[${e.getAttribute("name") || e.getAttribute("id") || e.getAttribute("placeholder") || e.getAttribute("aria-label") || e.textContent?.trim().slice(0, 24)}]`,
      ),
    );
    say(`controls: ${JSON.stringify(ctrls)}`);

    // Fill it: description, pick accounts, amounts.
    const desc = page.locator('input[name="description"], textarea[name="description"], input#description').first();
    if (await desc.count()) await desc.fill("DIAG probe entry — do not post");
    const selects = page.locator("select");
    const nSel = await selects.count();
    say(`selects on form: ${nSel}`);
    if (nSel >= 2) {
      const opts = await selects.first().locator("option").allInnerTexts();
      say(`account options (first 6): ${JSON.stringify(opts.slice(0, 6))} … total ${opts.length}`);
      await selects.nth(0).selectOption({ index: 1 });
      await selects.nth(1).selectOption({ index: 2 });
    }
    const nums = page.locator('input[type="number"]');
    say(`numeric inputs: ${await nums.count()}`);
    if ((await nums.count()) >= 4) {
      await nums.nth(0).fill("10000"); // DR line 1
      await nums.nth(3).fill("10000"); // CR line 2
    }
    await page.waitForTimeout(800);
    const after = await page.locator("body").innerText();
    say(`balance indicator: ${(after.match(/Total DR: [^\n]*\n?Total CR: [^\n]*\n?(Not balanced|Balanced)?/) || ["<none>"])[0].replace(/\n/g, " ")}`);
    say(`"Not balanced" still shown: ${/Not balanced/.test(after)}`);
    await shot(page, "je-new-filled");
    // Is there any control that POSTS (not just saves draft)?
    const btns = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()));
    say(`buttons: ${JSON.stringify(btns)}`);
    say(`has a POST/approve control: ${btns.some((b) => /post|approve|submit for/i.test(b || ""))}`);
  }
  await ctx.close();
}

/* ---------- 4. CLOSE A PERIOD ---------- */
{
  const { ctx, page } = await fresh();
  say("\n===== 4. CLOSE A PERIOD (accountant holds finance.period.close) =====");
  await visit(page, "/app/finance/periods");
  if (await assertLive(page, "periods")) {
    const n = await page.locator("button", { hasText: /close period/i }).count();
    say(`Close Period buttons: ${n}`);
    if (n) {
      page.net.length = 0;
      await page.locator("button", { hasText: /close period/i }).nth(0).click();
      await page.waitForTimeout(4000);
      const dlg = page.locator('[role="dialog"], [role="alertdialog"]');
      const cnt = await dlg.count();
      say(`dialog count: ${cnt}`);
      if (cnt) {
        say(`dialog box: ${JSON.stringify(await dlg.first().boundingBox())}`);
        say(`dialog text: ${(await dlg.first().innerText()).replace(/\n/g, " | ").slice(0, 1200)}`);
        const dbtn = await dlg.first().locator("button").allInnerTexts();
        say(`dialog buttons: ${JSON.stringify(dbtn)}`);
      }
      await shot(page, "period-close-dialog");
      say(`period API calls: ${page.net.filter((x) => /period/i.test(x)).join(" | ") || "none"}`);
      const b = await page.locator("body").innerText();
      say(`alerts: ${JSON.stringify(await page.locator('[role="alert"]').allInnerTexts())}`);
      say(`page mentions TOTP/step-up: ${/totp|two.factor|verification code|step.up|authenticator/i.test(b)}`);
    }
  }
  await ctx.close();
}

/* ---------- 5. NEW EXPENSE end to end ---------- */
{
  const { ctx, page } = await fresh();
  say("\n===== 5. NEW EXPENSE =====");
  await visit(page, "/app/finance/expenses");
  if (await assertLive(page, "expenses")) {
    const nb = page.locator("button", { hasText: /new expense/i });
    say(`New expense buttons: ${await nb.count()}`);
    if (await nb.count()) {
      await nb.first().click();
      await page.waitForTimeout(3500);
      const dlg = page.locator('[role="dialog"]');
      say(`dialog count: ${await dlg.count()}`);
      if (await dlg.count()) {
        say(`dialog box: ${JSON.stringify(await dlg.first().boundingBox())}`);
        say(`dialog text:\n${(await dlg.first().innerText()).slice(0, 1800)}`);
        const ctrls = await dlg.first().evaluate((d) =>
          [...d.querySelectorAll("input,select,textarea,button")].map(
            (e) => `${e.tagName}<${e.getAttribute("type") || ""}>[${e.getAttribute("name") || e.getAttribute("placeholder") || e.textContent?.trim().slice(0, 24)}]`,
          ),
        );
        say(`dialog controls: ${JSON.stringify(ctrls)}`);
        say(`has receipt/attachment field: ${ctrls.some((c) => /file|receipt|attach|upload/i.test(c))}`);
        say(`has vendor field: ${ctrls.some((c) => /vendor|supplier|payee/i.test(c))}`);
      }
      await shot(page, "expense-new-dialog");
    }
  }
  await ctx.close();
}

/* ---------- 7. TILLS as the MANAGER (who actually cashes up) ---------- */
{
  const { ctx, page } = await fresh("manager");
  say("\n===== 7. TILL / CASH-UP as manager@terrace.local =====");
  const r = await visit(page, "/app/pos/tills");
  say(`url=${r.url} denied=${r.denied} errored=${r.errored}`);
  await shot(page, "manager-tills");
  say((await page.locator("body").innerText()).slice(0, 3000));
  await ctx.close();
}

save("interact2.txt", log.join("\n"));
await browser.close();
