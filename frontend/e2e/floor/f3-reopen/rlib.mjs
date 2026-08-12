/*
 * A login that does not score machine load as a defect.
 *
 * `e2e/shift/lib.mjs`'s login waits a fixed 3s after submit and then declares failure if the
 * URL is still /login. With ten agents on this machine the redirect regularly takes longer;
 * probed by hand, POST /api/v1/auth/login came back 200 and the session was fine. This waits
 * for the navigation instead of for a stopwatch, and only calls it a failure when the page
 * itself says so.
 */
import { login as sharedLogin, totpNow } from "../../shift/lib.mjs";

const BASE = "http://localhost:3000";

export async function loginPatiently(page, who, tries = 4) {
  for (let i = 1; i <= tries; i += 1) {
    try {
      await sharedLogin(page, who);
      return page;
    } catch (e) {
      // Give the redirect the time the fixed wait did not.
      for (let w = 0; w < 8 && page.url().includes("/login"); w += 1) {
        await page.waitForTimeout(2500);
      }
      if (!page.url().includes("/login")) {
        console.log(`  ✓ signed in as ${who.email} (late redirect)`);
        return page;
      }
      const why = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[role="alert"]'))
          .map((n) => n.innerText.trim())
          .join(" | "),
      );
      console.log(`  login attempt ${i}/${tries} for ${who.email} did not land${why ? `: ${why}` : ""}`);
      if (i === tries) throw e;
      await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);
    }
  }
  return page;
}

export { totpNow };
