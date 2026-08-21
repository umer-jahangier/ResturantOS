// DIAGNOSIS ONLY — open the tenant Subscription "Edit" dialog and record whether it actually
// renders a usable form (the product had ~24px-wide dialogs until recently). NOTHING IS SAVED:
// the dialog is dismissed with Escape so the shared dev tenant is not mutated.
import { launch, shot, statusOf, buttons, makeLog, BASE } from "./recheck-lib.mjs";

const { say, flush } = makeLog("07-subscription-edit-log");
const SA = { email: "superadmin@softxlogic.com", password: "Test@123!" };
const FT = "d108c2e6-a70d-49c8-acdc-37531fd752d8";

async function main() {
  const { browser, ctx } = await launch();
  const page = await ctx.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.locator('input[name="email"], input#email').first().fill(SA.email);
  await page.locator('input[name="password"], input#password').first().fill(SA.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
  if (page.url().includes("/login")) { say("!! SUPERADMIN LOGIN FAILED"); return finish(browser); }

  await page.goto(`${BASE}/platform/tenants/${FT}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  const edit = page.locator('button:has-text("Edit")');
  say("'Edit' (Subscription) buttons:", await edit.count());
  if (await edit.count()) { await edit.first().click(); await page.waitForTimeout(2500); }

  const dlg = page.locator('[role="dialog"]');
  say("dialog count:", await dlg.count());
  if (await dlg.count()) {
    const box = await dlg.first().boundingBox();
    say("DIALOG BOUNDING BOX:", JSON.stringify(box));
    say("   dialog renders at a usable width:", box && box.width > 200);
    const fields = await dlg.first().evaluate((d) =>
      Array.from(d.querySelectorAll("input,select,textarea")).map(
        (e) => `${e.tagName}:${e.getAttribute("name") || e.getAttribute("aria-label") || e.getAttribute("placeholder") || ""}`
      )
    );
    say("DIALOG FIELDS:", JSON.stringify(fields));
    say("DIALOG TEXT >>>", (await dlg.first().innerText()).replace(/\n/g, " | ").slice(0, 700));
    say("DIALOG BUTTONS:", JSON.stringify(await dlg.first().locator("button").allTextContents()));
  }
  await shot(page, "60-subscription-edit-dialog", say);

  // Leave the shared dev tenant exactly as found.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);
  say("dialog after Escape:", await page.locator('[role="dialog"]').count(), "(nothing saved)");

  await finish(browser);
}

async function finish(browser) { await browser.close().catch(() => {}); flush(); }
main().catch((e) => { say("FATAL " + e.stack); flush(); process.exit(1); });
