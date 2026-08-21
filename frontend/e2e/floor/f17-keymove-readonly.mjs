/**
 * READ-ONLY check that the relocated stale-board query key still drives a live query.
 *
 * Verifies commit 18ddde98 (staleBoardKey -> queryKeys.kds.stale) at runtime in the real
 * Next.js app rather than jsdom. Observes only: it navigates, counts the stale request and
 * reads rendered state. It never clicks confirm and never mutates a ticket, because this
 * stack is shared by 17 sessions.
 */
import { newBrowser, newPage, login, go, PEOPLE, log } from "../shift/lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);

const staleReqs = [];
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("/kds/tickets/stale")) staleReqs.push(u);
});

await login(page, PEOPLE.kitchen);
const trouble = await go(page, "/app/kitchen/DEFAULT", { waitMs: 5000, allowTrouble: true });

const seen = await page.evaluate(() => ({
  boardMounted: !!document.querySelector('[data-testid*="kds"], main'),
  staleTrigger:
    document.querySelector('[data-testid="kds-clear-stale-trigger"]')?.innerText?.trim() ?? null,
  staleError:
    document.querySelector('[data-testid="kds-clear-stale-error"]')?.innerText?.trim() ?? null,
  staleLoading: !!document.querySelector('[data-testid="kds-clear-stale-loading"]'),
}));

log("F17 KEY-MOVE READ-ONLY PROBE");
log("  stale requests fired :", staleReqs.length);
log("  first stale URL      :", staleReqs[0] ?? "(none)");
log("  board mounted        :", seen.boardMounted);
log("  clear-stale trigger  :", seen.staleTrigger ?? "(absent - nothing stale)");
log("  stale error shown    :", seen.staleError ?? "(none)");
log("  page trouble         :", JSON.stringify(trouble?.bad ?? []));
log(
  "  VERDICT              :",
  staleReqs.length > 0 && !seen.staleError
    ? "stale query LIVE via relocated key"
    : "NO stale query observed - investigate",
);

await browser.close();
