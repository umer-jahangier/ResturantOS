/*
 * Step 10 — the notice at 390 / 768 / 1440, in both themes, and never causing a horizontal scroll.
 *
 * Computed style is read, never the class list: `cn()`/tailwind-merge has silently dropped utility
 * classes in this codebase before, and a class in the source is not a class in the DOM.
 */
import { newBrowser, newPage, login, go, shot, PEOPLE } from "./lib.mjs";

const ORDER_ID = process.argv[2];
if (!ORDER_ID) throw new Error("usage: node 10-responsive-themes.mjs <orderId>");

const browser = await newBrowser();

for (const theme of ["light", "dark"]) {
  for (const [w, h, name] of [
    [390, 844, "390"],
    [768, 1024, "768"],
    [1440, 950, "1440"],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
    const page = await ctx.newPage();
    try {
      await login(page, PEOPLE.cashier);
      await page.emulateMedia({ colorScheme: theme });
      await go(page, `/app/pos/orders/${ORDER_ID}/receipt`, { waitMs: 7000, allowTrouble: true });

      const probe = await page.evaluate(() => {
        const n = document.querySelector('[data-testid="delivery-notice"]');
        if (!n) return null;
        const cs = getComputedStyle(n);
        const r = n.getBoundingClientRect();
        return {
          state: n.getAttribute("data-delivery-state"),
          // Computed, not classes.
          background: cs.backgroundColor,
          borderColor: cs.borderTopColor,
          color: cs.color,
          visible: r.width > 0 && r.height > 0,
          widthPx: Math.round(r.width),
          overflowsViewport: r.right > window.innerWidth + 1,
          bodyScrollsHorizontally:
            document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
          textLen: (n.innerText || "").trim().length,
        };
      });
      console.log(`${theme} ${name}:`, JSON.stringify(probe));
      await shot(page, `10-${theme}-${name}`);
    } finally {
      await ctx.close();
    }
  }
}
await browser.close();
