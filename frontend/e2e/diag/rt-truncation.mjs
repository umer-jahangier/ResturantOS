/*
 * RED TEAM #15 — the vendors list rendered 20 rows while the API said
 * meta.totalCount=29, nextCursor="1". No pager on screen. Same shape as the KDS
 * "20 of 29 tickets" bug already fixed in this repo. How many list screens do this?
 *
 * For each route: capture every gateway GET's meta.totalCount + returned row count,
 * then count what the UI actually renders and look for any pagination control.
 */
import { go, login, browser, save, shot } from "./rt-lib.mjs";

const ROUTES = [
  "/app/purchasing/vendors",
  "/app/purchasing/purchase-orders",
  "/app/menu/items",
  "/app/inventory/ingredients",
  "/app/users",
  "/app/hr/employees",
  "/app/tables",
  "/app/stations",
  "/app/finance/expenses",
  "/app/finance/journal-entries",
  "/app/customers",
  "/app/terminals",
];

const run = async () => {
  const { b, page } = await browser(1440, 900);
  const a = await login(page, "owner"); if (!a.ok) { console.error("login fail"); process.exit(1); }

  let calls = [];
  page.on("response", async (r) => {
    const u = r.url();
    if (r.request().method() !== "GET" || !u.includes("localhost:8080")) return;
    try {
      const j = JSON.parse(await r.text());
      const rows = Array.isArray(j.data) ? j.data.length : null;
      const total = j?.meta?.totalCount ?? null;
      const next = j?.meta?.page?.nextCursor ?? null;
      const limit = j?.meta?.page?.limit ?? null;
      if (rows !== null && (total !== null || next !== null)) {
        calls.push({ url: u.replace("http://localhost:8080", "").split("?")[0], rows, total, next, limit });
      }
    } catch {}
  });

  const out = [];
  for (const route of ROUTES) {
    calls = [];
    const nav = await go(page, route, "owner", { wait: 5000 });
    const ui = await page.evaluate(() => {
      const rowish = document.querySelectorAll('table tbody tr').length
        || document.querySelectorAll('[role="row"]').length
        || 0;
      const pager = [...document.querySelectorAll("button,a")]
        .filter((e) => e.getBoundingClientRect().width > 0)
        .map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim())
        .filter((t) => /^(next|previous|prev|load more|show all|more)\b|page \d|›|‹|»|«/i.test(t));
      const totalsShown = (document.body.innerText.match(/\b\d+\s+of\s+\d+\b|showing\s+\d+/gi) || []).slice(0, 3);
      return { rowish, pager: [...new Set(pager)].slice(0, 5), totalsShown };
    });
    const truncated = calls.filter((c) => (c.total !== null && c.rows < c.total) || (c.next !== null && c.next !== "" && c.next !== null));
    const rec = { route, ok: nav.ok, apiCalls: calls, ui, truncatedCalls: truncated };
    out.push(rec);
    await shot(page, route.replace(/\W+/g, "_"), "truncation");
    const worst = truncated[0];
    console.log(
      route.padEnd(34),
      nav.ok ? "" : "NAVFAIL",
      worst ? `API ${worst.rows}/${worst.total} rows (next=${worst.next}) @ ${worst.url}` : (calls.length ? `full (${calls.map((c) => c.rows + "/" + c.total).join(",")})` : "no paged api"),
      "| uiRows=" + ui.rowish,
      "| pager=" + JSON.stringify(ui.pager),
      "| totalsShown=" + JSON.stringify(ui.totalsShown),
    );
  }
  save("truncation.json", out);
  await b.close();
};
run();
