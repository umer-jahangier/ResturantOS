/*
 * Stage 4 — success feedback, keyboard, empty states, and the POS till as the CASHIER
 * (the persona who actually uses it; auditing the till as an owner is how you miss a till bug).
 */
import { chromium } from "@playwright/test";
import { login, settle, shot, saveJson, PROBE } from "./uiq-lib.mjs";

const out = {};
const browser = await chromium.launch();

// ---------- A. success feedback on a VALID create ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  if ((await login(page, "owner")).ok) {
    const st = await settle(page, "/app/tables", "owner");
    if (st.clean) {
      await page.locator('button:has-text("Add table")').first().click();
      await page.waitForTimeout(1200);
      const stamp = `UIQ${Date.now() % 100000}`;
      await page.locator('[role="dialog"] [name="tableNumber"]').fill(stamp);
      await page.locator('[role="dialog"] [name="capacity"]').fill("4");
      const t0 = Date.now();
      await page.locator('[role="dialog"] button[type="submit"]').last().click();
      await page.waitForTimeout(2500);
      const res = await page.evaluate(() => ({
        dialogStillOpen: !!document.querySelector('[role="dialog"]'),
        toasts: [...document.querySelectorAll("[data-sonner-toast]")].map((t) => ({
          type: t.getAttribute("data-type"),
          text: (t.textContent || "").trim().slice(0, 120),
        })),
        toastContainer: !!document.querySelector("[data-sonner-toaster]"),
      }));
      const rowAppeared = await page.locator(`text=${stamp}`).count();
      out.successPath = { stamp, elapsedMs: Date.now() - t0, ...res, rowAppeared };
      await shot(page, "success-create-table", "final");
      console.log("SUCCESS PATH:", JSON.stringify(out.successPath));
    } else console.log("success path skipped, route not clean");
  }
  await ctx.close();
}

// ---------- B. keyboard: focus trap, tab order, visible focus ring ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  if ((await login(page, "owner")).ok) {
    const st = await settle(page, "/app/inventory/ingredients", "owner");
    if (st.clean) {
      await page.locator('button:has-text("Add ingredient")').first().click();
      await page.waitForTimeout(1300);
      const trap = [];
      for (let i = 0; i < 26; i += 1) {
        await page.keyboard.press("Tab");
        trap.push(await page.evaluate(() => {
          const a = document.activeElement;
          const d = document.querySelector('[role="dialog"]');
          const cs = a ? getComputedStyle(a) : null;
          return {
            inside: !!(d && a && d.contains(a)),
            el: a ? `${a.tagName.toLowerCase()}${a.name ? "#" + a.name : ""}` : null,
            ring: cs ? (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none" : false,
          };
        }));
      }
      const escaped = trap.filter((t) => !t.inside).length;
      const noRing = trap.filter((t) => t.inside && !t.ring).length;
      out.keyboard = { steps: trap.length, escapedDialog: escaped, focusedWithoutVisibleRing: noRing, trail: trap.map((t) => t.el) };
      await shot(page, "keyboard-focus", "final");
      console.log(`KEYBOARD: 26 tabs, escaped dialog ${escaped}x, no visible focus ring on ${noRing} stops`);

      // Enter-to-submit from a text field?
      await page.locator('[role="dialog"] [name="name"]').fill("KbdProbe");
      await page.locator('[role="dialog"] [name="name"]').press("Enter");
      await page.waitForTimeout(1500);
      out.keyboard.enterSubmits = await page.evaluate(() => ({
        dialogOpen: !!document.querySelector('[role="dialog"]'),
        errs: [...document.querySelectorAll('[role="dialog"] [data-slot="form-message"],[role="dialog"] .text-destructive')].filter((e) => e.textContent.trim()).length,
      }));
      console.log("  Enter-to-submit:", JSON.stringify(out.keyboard.enterSubmits));
    }
  }
  await ctx.close();
}

// ---------- C. the POS till, as a CASHIER ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  const page = await ctx.newPage();
  const auth = await login(page, "cashier");
  if (auth.ok) {
    for (const [n, r] of [["pos", "/app/pos"], ["tills", "/app/pos/tills"], ["kitchen", "/app/kitchen"]]) {
      const st = await settle(page, r, "cashier");
      const probe = await page.evaluate(PROBE);
      await shot(page, `cashier-${n}`, "final");
      (out.cashier ||= []).push({ n, r, clean: st.clean, refused: st.refused, h1: probe.h1Count, tap: probe.touchTargets, fonts: probe.distinctFontSizes, btnH: probe.buttons.heights });
      console.log(`CASHIER ${n.padEnd(8)} clean=${st.clean} refused=${st.refused} h1=${probe.h1Count} tapUnder44=${probe.touchTargets.under44}/${probe.touchTargets.n} btnHeights=${JSON.stringify(probe.buttons.heights)}`);
    }
  } else console.log("cashier login failed:", auth.why);
  await ctx.close();
}

saveJson("final.json", out);
await browser.close();
