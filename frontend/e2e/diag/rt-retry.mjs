/*
 * RED TEAM #16 — five routes came back NAVFAIL in the truncation sweep. A screenshot of an
 * error state looks exactly like a screenshot of an empty product, so retry them slowly,
 * one fresh login, and RECORD what is actually on screen. Also settle whether the
 * ingredients list (42 seeded) is truncating at 20.
 */
import { go, login, browser, save, shot } from "./rt-lib.mjs";

const ROUTES = ["/app/menu/items", "/app/hr/employees", "/app/tables", "/app/stations", "/app/terminals", "/app/inventory/ingredients", "/app/customers"];

const run = async () => {
  const { b, page } = await browser(1440, 900);
  const a = await login(page, "owner"); if (!a.ok) { console.error("login fail", a); process.exit(1); }

  let calls = [];
  page.on("response", async (r) => {
    const u = r.url();
    if (r.request().method() !== "GET" || !u.includes("localhost:8080")) return;
    try {
      const j = JSON.parse(await r.text());
      const rows = Array.isArray(j.data) ? j.data.length : (Array.isArray(j.data?.content) ? j.data.content.length : null);
      if (rows === null) return;
      calls.push({ url: u.replace("http://localhost:8080", "").split("?")[0], rows, total: j?.meta?.totalCount ?? null, next: j?.meta?.page?.nextCursor ?? null, limit: j?.meta?.page?.limit ?? null, status: r.status() });
    } catch {}
  });

  const out = [];
  for (const route of ROUTES) {
    calls = [];
    // slow, generous settle
    const nav = await go(page, route, "owner", { attempts: 4, wait: 6000 });
    await page.waitForTimeout(2500);
    const ui = await page.evaluate(() => {
      const body = document.body.innerText;
      return {
        rowsTable: document.querySelectorAll("table tbody tr").length,
        rowsRole: document.querySelectorAll('[role="row"]').length,
        cards: document.querySelectorAll('[data-slot="card"]').length,
        alerts: document.querySelectorAll('[role="alert"]').length,
        errorCopy: /Couldn.t load|temporarily unavailable|Something went wrong|Try again/i.test(body),
        refusal: /Access denied|do not have permission|not authorized/i.test(body),
        pager: [...new Set([...document.querySelectorAll("button,a")].filter((e) => e.getBoundingClientRect().width > 0).map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim()).filter((t) => /^(next|previous|prev|load more|show all)\b|page \d/i.test(t)))],
        totalsShown: (body.match(/\b\d+\s+of\s+\d+\b/gi) || []).slice(0, 3),
        headline: body.split("\n").filter(Boolean).slice(0, 3).join(" / "),
        len: body.length,
      };
    });
    out.push({ route, nav, ui, calls: [...calls] });
    await shot(page, route.replace(/\W+/g, "_"), "retry");
    console.log(
      route.padEnd(30),
      "ok=" + nav.ok, "attempt=" + nav.attempt,
      "| err=" + ui.errorCopy, "refused=" + ui.refusal,
      "| rows(table/role)=" + ui.rowsTable + "/" + ui.rowsRole,
      "| pager=" + JSON.stringify(ui.pager), "totals=" + JSON.stringify(ui.totalsShown),
      "| api=" + JSON.stringify(calls.map((c) => `${c.url}:${c.rows}/${c.total}${c.next ? " next=" + c.next : ""}`)),
    );
  }
  save("retry.json", out);
  await b.close();
};
run();
