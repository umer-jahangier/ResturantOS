/*
 * F4 RE-OPEN, part 5 — does the SCREEN work for the second tenant, or only for the one it was
 * built against? Part 2 saw Control Bistro's owner land on a sign-in page; this retries properly
 * before concluding anything, because an error state and a redirect look alike in one screenshot.
 *
 * Also re-shoots 390 light/dark, since a card list that never renders is the classic way a
 * "responsive" claim is true only of the widths that were measured.
 */
import { launch, ctx, signIn, shot, trouble, readAudit, record, log, apiGet, token, PEOPLE, BASE } from "./f4-reopen-lib.mjs";

const browser = await launch();

// ── the other tenant's owner, on the screen ────────────────────────────────
log("\n=== Control Bistro's OWNER on /app/settings/audit ===");
const cb = await ctx(browser, { tz: "Europe/London" });
await signIn(cb, PEOPLE.controlOwner);
await cb.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
await cb.waitForTimeout(8000);
const cbNav = await cb.evaluate(() =>
  Array.from(document.querySelectorAll("nav a, aside a"))
    .map((a) => ({ t: (a.textContent || "").replace(/\s+/g, " ").trim(), h: a.getAttribute("href") }))
    .filter((n) => /audit/i.test(`${n.t} ${n.h}`)));
record("B_controlNav", { nav: cbNav, urlAfterDashboard: cb.url() });

let cbScreen = null;
for (let i = 1; i <= 3; i++) {
  const link = cb.getByRole("link", { name: /audit log/i });
  if (await link.count()) {
    await link.first().scrollIntoViewIfNeeded();
    await link.first().click();
  } else {
    await cb.goto(`${BASE}/app/settings/audit`, { waitUntil: "domcontentloaded" });
  }
  await cb.waitForTimeout(12_000);
  cbScreen = await readAudit(cb);
  if (cbScreen.h1 === "Audit log") break;
  log(`  attempt ${i}: h1 was "${cbScreen.h1}" at ${cb.url()} — retrying`);
  await cb.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await cb.waitForTimeout(6000);
}
const cbTok = await token(cb);
const cbApi = await apiGet(cb, "/api/v1/audit/events?size=200", cbTok);
const cbRows = cbApi.body?.data ?? [];
record("B_controlScreen", {
  url: cb.url(),
  h1: cbScreen?.h1,
  zoneNote: cbScreen?.zoneNote,
  summary: cbScreen?.summary,
  rowCount: cbScreen?.rowCount,
  firstRow: cbScreen?.rows?.[0] ?? null,
  trouble: await trouble(cb),
  apiTotal: cbApi.body?.meta?.totalCount ?? null,
  actorsAllControl: cbRows.every((r) => !r.userName || !/Terrace/i.test(r.userName)),
  distinctActors: [...new Set(cbRows.map((r) => r.userName).filter(Boolean))],
});
await shot(cb, "r40-control-bistro-screen");
await cb.context().close();

// ── responsive, re-shot independently ──────────────────────────────────────
log("\n=== 390 / 1440, light and dark, for the OWNER ===");
for (const [w, h] of [[390, 844], [1440, 950]]) {
  for (const scheme of ["light", "dark"]) {
    const p = await ctx(browser, { tz: "America/New_York", width: w, height: h, colorScheme: scheme });
    await signIn(p, PEOPLE.owner);
    await p.goto(`${BASE}/app/settings/audit`, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(12_000);
    const m = await p.evaluate(() => ({
      bodyScrollW: document.body.scrollWidth,
      viewportW: window.innerWidth,
      tablesVisible: Array.from(document.querySelectorAll("table")).filter((t) => t.offsetParent !== null).length,
      rowsOrCards: document.querySelectorAll('table[aria-label="Audit log"] tbody tr').length
        || document.querySelectorAll("ul li, [data-testid*=card]").length,
      summary: document.querySelector("[data-testid=audit-page-summary]")?.textContent?.trim() ?? null,
      bg: getComputedStyle(document.body).backgroundColor,
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
    }));
    record(`B_layout_${w}_${scheme}`, { ...m, noHorizontalOverflow: m.bodyScrollW <= m.viewportW + 1 });
    await shot(p, `r41-${w}-${scheme}`);
    await p.context().close();
  }
}

await browser.close();
log("\ndone — part 5");
