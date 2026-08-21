/*
 * RED TEAM #14 — the vendor list returns EXACTLY 20 and my new vendors sort last
 * alphabetically (R > F > D). Before claiming data loss, rule out a 20-row page cap —
 * the same shape as the KDS "showed 20 of 29 tickets" bug in this repo's history.
 */
import { go, login, browser, save, shot } from "./rt-lib.mjs";

const run = async () => {
  const { b, page } = await browser(1440, 900);
  const gets = [];
  page.on("response", async (r) => {
    const u = r.url();
    if (r.request().method() === "GET" && u.includes("localhost:8080") && u.includes("vendors")) {
      let n = null, body = null;
      try { body = await r.text(); n = (JSON.parse(body).data || []).length; } catch {}
      gets.push({ url: u.replace("http://localhost:8080", ""), status: r.status(), rows: n, meta: (() => { try { return JSON.parse(body).meta; } catch { return null; } })() });
    }
  });
  const a = await login(page, "owner"); if (!a.ok) process.exit(1);
  await go(page, "/app/purchasing/vendors", "owner", { wait: 5000 });

  const out = {};
  out.requests = gets;
  console.log("VENDOR GETs:", JSON.stringify(gets, null, 1));

  out.ui = await page.evaluate(() => {
    const t = document.body.innerText;
    // pagination controls?
    const pager = [...document.querySelectorAll("button,a")].filter((e) => /next|previous|page \d|show all|load more|›|‹/i.test((e.getAttribute("aria-label") || e.textContent || "").trim())).map((e) => (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 24));
    const rows = document.querySelectorAll('table tbody tr, [role="row"]').length;
    return {
      visibleRows: rows,
      pagerControls: [...new Set(pager)],
      countText: (t.match(/\d+\s+(vendors?|of\s+\d+|results?)/gi) || []).slice(0, 5),
      hasRT: /RTGOOD|RTBADMAIL|RTFETCH|RTPERSIST|RTBAD/.test(t),
      textTail: t.slice(-500),
    };
  });
  console.log("UI:", JSON.stringify({ ...out.ui, textTail: undefined }, null, 1));
  console.log("TAIL:", out.ui.textTail);
  await shot(page, "vendor-page-pagination", "persist");

  save("vendor-page.json", out);
  await b.close();
};
run();
