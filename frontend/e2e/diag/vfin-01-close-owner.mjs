/* VERIFY #1: can an OWNER close an accounting period in the browser? DIAGNOSTIC ONLY. */
import { chromium } from "@playwright/test";
import { PERSONAS, login, visit, shot, save, pageToken, decodeJwt, BASE } from "./vfin-lib.mjs";

const log = [];
const P = (s) => { console.log(s); log.push(s); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await ctx.newPage();

const net = [];
page.on("response", async (r) => {
  const u = r.url();
  if (/\/api\/v1\/(finance|auth)\//.test(u)) net.push({ status: r.status(), method: r.request().method(), url: u.replace("http://localhost:8080", "") });
});

const persona = process.argv[2] || "owner";
P(`### persona=${persona}`);
const ok = await login(page, PERSONAS[persona]);
P(`login ok=${ok} url=${page.url()}`);
if (!ok) { await browser.close(); process.exit(1); }

// Token immediately after login
let tk = await pageToken(page);
let claims = tk ? decodeJwt(tk.token) : null;
P(`token@login key=${tk?.key} totp_verified=${claims?.totp_verified} iat=${claims?.iat} exp=${claims?.exp}`);

const r = await visit(page, "/app/finance/periods");
P(`periods url=${r.url} denied=${r.denied} errored=${r.errored} sessionLost=${r.sessionLost}`);
P(`--- periods body (first 1800) ---\n${r.body.slice(0, 1800)}`);
await shot(page, `${persona}-periods`);

// Count Close Period buttons
const closeBtns = page.locator('button:has-text("Close Period"), button:has-text("Close period")');
const n = await closeBtns.count();
P(`Close Period buttons: ${n}`);

if (n > 0) {
  // token right before clicking
  tk = await pageToken(page); claims = tk ? decodeJwt(tk.token) : null;
  P(`token@before-click totp_verified=${claims?.totp_verified} iat=${claims?.iat}`);

  await closeBtns.first().click();
  await page.waitForTimeout(2000);
  await shot(page, `${persona}-close-dialog`);
  // Measure dialog width (the 24px-dialog trap)
  const dlg = page.locator('[role="dialog"]');
  if (await dlg.count()) {
    const box = await dlg.first().boundingBox();
    P(`dialog box: ${JSON.stringify(box)}`);
    const dtxt = await dlg.first().innerText().catch(() => "");
    P(`--- dialog text ---\n${dtxt.slice(0, 900)}`);
    // Is there a TOTP input inside the dialog? (would make close reachable)
    const totpIn = dlg.locator('input[name="totpCode"], input#totpCode, input[inputmode="numeric"]');
    P(`TOTP input inside dialog: ${await totpIn.count()}`);
    // Confirm
    const confirm = dlg.locator('button:has-text("Close Period"), button:has-text("Confirm")');
    P(`confirm buttons in dialog: ${await confirm.count()}`);
    if (await confirm.count()) {
      const dis = await confirm.last().isDisabled().catch(() => null);
      P(`confirm disabled=${dis}`);
      await confirm.last().click({ force: true }).catch((e) => P(`confirm click err: ${e.message}`));
      await page.waitForTimeout(4000);
      await shot(page, `${persona}-close-after-confirm`);
      const after = await page.locator("body").innerText().catch(() => "");
      P(`--- after confirm (first 1500) ---\n${after.slice(0, 1500)}`);
      const alerts = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
      P(`alerts: ${JSON.stringify(alerts)}`);
    }
  } else {
    P("NO [role=dialog] rendered after clicking Close Period");
  }
}

P("--- finance/auth network ---");
for (const x of net) P(`${x.status} ${x.method} ${x.url}`);

save(`close-${persona}.txt`, log.join("\n"));
await browser.close();
