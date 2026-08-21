/* B2: can the accountant EVER close a period in a browser?  C2: JE draft -> post. */
import { chromium } from "@playwright/test";
import { PERSONAS, login, shot, save, visit, totpNow } from "./fin-lib.mjs";

const log = [];
const say = (s) => {
  console.log(s);
  log.push(String(s));
};
const browser = await chromium.launch();

async function fresh(who) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  const page = await ctx.newPage();
  page.net = [];
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/")) page.net.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")}`);
  });
  if (!(await login(page, PERSONAS[who]))) throw new Error(`login failed ${who}`);
  return { ctx, page };
}

/* ---------- B2: period close, following the step-up prompt ---------- */
{
  const { ctx, page } = await fresh("accountant");
  say("===== B2. PERIOD CLOSE — following the step-up prompt to the end =====");
  await visit(page, "/app/finance/periods");
  await page.locator("button", { hasText: /close period/i }).nth(0).click();
  await page.waitForTimeout(2000);
  await page.locator('[role="dialog"],[role="alertdialog"]').first().locator("button", { hasText: /^close period$/i }).first().click();
  await page.waitForTimeout(5000);
  say(`1st attempt API: ${page.net.filter((x) => /periods\/.*close/.test(x)).join(" | ")}`);

  const again = page.locator("button, a", { hasText: /sign in again/i }).first();
  say(`"Sign in again" control present: ${await again.count()}`);
  if (await again.count()) {
    await again.click();
    await page.waitForTimeout(3500);
    say(`after clicking it, url = ${page.url()}`);
    await shot(page, "stepup-prompt");
    const body = await page.locator("body").innerText();
    say(`--- what the user now sees ---\n${body.slice(0, 1200)}`);
    // Is there a TOTP box right here, or were we thrown to a full re-login?
    const totp = page.locator('input[name="totpCode"], input#totpCode, input[autocomplete="one-time-code"]');
    say(`inline TOTP field: ${await totp.count()}`);
    if (await totp.count()) {
      await totp.first().fill(totpNow(PERSONAS.accountant.totpSecret));
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(5000);
      say(`url after TOTP: ${page.url()}`);
      await shot(page, "stepup-after-totp");
    } else {
      // full re-login flow
      const pw = page.locator('input[name="password"], input#password');
      if (await pw.count()) {
        say("thrown back to a FULL LOGIN form (email+password), not a step-up challenge");
        const em = page.locator('input[name="email"], input#email');
        if (await em.count()) await em.first().fill(PERSONAS.accountant.email);
        await pw.first().fill(PERSONAS.accountant.password);
        await page.locator('button[type="submit"]').first().click();
        await page.waitForTimeout(3500);
        const t2 = page.locator('input[name="totpCode"], input#totpCode');
        if (await t2.count()) {
          await t2.first().fill(totpNow(PERSONAS.accountant.totpSecret));
          await page.locator('button[type="submit"]').first().click();
          await page.waitForTimeout(5000);
        }
        say(`url after full re-login: ${page.url()}`);
      }
    }
    // Now retry the close
    await visit(page, "/app/finance/periods");
    const n = await page.locator("button", { hasText: /close period/i }).count();
    say(`back on periods, Close buttons = ${n}, url=${page.url()}`);
    if (n) {
      page.net.length = 0;
      await page.locator("button", { hasText: /close period/i }).nth(0).click();
      await page.waitForTimeout(2000);
      await page.locator('[role="dialog"],[role="alertdialog"]').first().locator("button", { hasText: /^close period$/i }).first().click();
      await page.waitForTimeout(6000);
      say(`2nd attempt API: ${page.net.filter((x) => /periods/.test(x)).join(" | ") || "none"}`);
      say(`alerts: ${JSON.stringify(await page.locator('[role="alert"]').allInnerTexts())}`);
      const b2 = await page.locator("body").innerText();
      const i = b2.indexOf("Period 1");
      say(`period table now:\n${b2.slice(i - 120, i + 400)}`);
      await shot(page, "period-close-2nd-attempt");
    }
  }
  await ctx.close();
}

/* ---------- C2: JE draft, patiently ---------- */
{
  const { ctx, page } = await fresh("accountant");
  say("\n===== C2. JOURNAL ENTRY draft -> post =====");
  const r = await visit(page, "/app/finance/journal-entries/new", { tries: 3, settle: 7000 });
  say(`url=${r.url} denied=${r.denied} errored=${r.errored}`);
  const desc = page.locator('input[name="description"]');
  say(`description field count: ${await desc.count()}`);
  if ((await desc.count()) === 0) {
    say(`BODY:\n${r.body.slice(0, 1500)}`);
  } else {
    await desc.first().fill("DIAG-PROBE do not use");
    const acc = page.locator('input[placeholder*="account" i]');
    say(`account pickers: ${await acc.count()}`);
    await acc.nth(0).fill("1010");
    await page.waitForTimeout(2000);
    const listing = await page.evaluate(() =>
      [...document.querySelectorAll('[role="option"],li,button')].map((e) => e.textContent?.trim()).filter((t) => t && /^1010/.test(t)),
    );
    say(`suggestions for 1010: ${JSON.stringify(listing.slice(0, 4))}`);
    let opt = page.locator('[role="option"], li').filter({ hasText: /^1010/ }).first();
    if (await opt.count()) await opt.click();
    await acc.nth(1).fill("4100");
    await page.waitForTimeout(2000);
    opt = page.locator('[role="option"], li').filter({ hasText: /^4100/ }).first();
    if (await opt.count()) await opt.click();
    const nums = page.locator('input[type="number"]');
    await nums.nth(0).fill("5000");
    await nums.nth(3).fill("5000");
    await page.waitForTimeout(800);
    const pre = await page.locator("body").innerText();
    say(`balanced? ${!/Not balanced/.test(pre)} | date label: ${(pre.match(/Selected: [\d-]+/) || ["?"])[0]}`);
    await shot(page, "je-filled-ready");
    page.net.length = 0;
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(6000);
    say(`API: ${page.net.filter((x) => /journal/i.test(x)).join("\n     ") || "NONE"}`);
    say(`url after save: ${page.url()}`);
    say(`alerts: ${JSON.stringify(await page.locator('[role="alert"]').allInnerTexts())}`);
    await shot(page, "je-after-save");
    const btns = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => b.textContent?.trim()).filter((x) => x && x.length < 30));
    say(`buttons after save: ${JSON.stringify(btns)}`);
    say(`POST/approve control present anywhere: ${btns.some((x) => /^post|approve|submit for/i.test(x))}`);
    const body = await page.locator("body").innerText();
    say(`page text (700): ${body.slice(body.indexOf("Journal Entries"), body.indexOf("Journal Entries") + 700)}`);
  }
  await ctx.close();
}

save("close-and-je.txt", log.join("\n"));
await browser.close();
