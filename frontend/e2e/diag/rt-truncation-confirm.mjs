/*
 * RED TEAM #18 — confirm the two silent-truncation screens with clean measurements,
 * and confirm the two that DO paginate correctly (so the finding is "inconsistent",
 * not "pagination does not exist").
 */
import { go, login, browser, save, shot } from "./rt-lib.mjs";

const run = async () => {
  const { b, page } = await browser(1440, 900);
  const a = await login(page, "owner"); if (!a.ok) process.exit(1);
  let calls = [];
  page.on("response", async (r) => {
    const u = r.url();
    if (r.request().method() !== "GET" || !u.includes("localhost:8080")) return;
    try {
      const j = JSON.parse(await r.text());
      if (!Array.isArray(j.data)) return;
      calls.push({ url: u.replace("http://localhost:8080", "").split("?")[0], rows: j.data.length, total: j?.meta?.totalCount ?? null, next: j?.meta?.page?.nextCursor ?? null, limit: j?.meta?.page?.limit ?? null });
    } catch {}
  });

  const out = [];
  for (const route of ["/app/purchasing/vendors", "/app/finance/journal-entries", "/app/purchasing/purchase-orders", "/app/users"]) {
    calls = [];
    const nav = await go(page, route, "owner", { attempts: 3, wait: 6000 });
    await page.waitForTimeout(2000);
    const ui = await page.evaluate(() => {
      const body = document.body.innerText;
      // count rendered records generically: table rows OR repeated grid rows
      const tr = document.querySelectorAll("table tbody tr").length;
      const gr = document.querySelectorAll('[role="row"]').length;
      const pager = [...new Set([...document.querySelectorAll("button,a")]
        .filter((e) => e.getBoundingClientRect().width > 0)
        .map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim())
        .filter((t) => /^(next|previous|prev|load more|show all|more)$/i.test(t) || /page \d/i.test(t)))];
      return {
        renderedRows: Math.max(tr, gr ? gr - 1 : 0),
        tr, gr,
        pager,
        pageIndicator: (body.match(/\b\d+\s+of\s+\d+\b/g) || []).slice(0, 3),
        errorCopy: /Couldn.t load|temporarily unavailable/i.test(body),
      };
    });
    const main = calls.filter((c) => c.total !== null || c.next !== null).sort((x, y) => (y.total || 0) - (x.total || 0))[0] || calls[0] || null;
    out.push({ route, nav: nav.ok, ui, main, allCalls: calls });
    await shot(page, route.replace(/\W+/g, "_"), "truncation-confirm");
    console.log(
      route.padEnd(34),
      main ? `api ${main.rows}/${main.total ?? "?"} next=${main.next ?? "-"} limit=${main.limit ?? "-"}` : "no list api",
      "| rendered=" + ui.renderedRows,
      "| pager=" + JSON.stringify(ui.pager),
      "| indicator=" + JSON.stringify(ui.pageIndicator),
      ui.errorCopy ? "| ERRORSTATE" : "",
    );
  }
  save("truncation-confirm.json", out);
  await b.close();
};
run();
