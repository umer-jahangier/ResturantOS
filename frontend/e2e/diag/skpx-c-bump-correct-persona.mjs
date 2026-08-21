/*
 * PROBE C — bump / recall driven as the persona that actually holds `pos.kds.update`
 * (KITCHEN_STAFF). MANAGER does NOT hold it, so an F keypress there is a silent no-op — which
 * is why this had to be re-run rather than reported from the first attempt.
 *
 * Measures the TICKET STATUS over the API around each keypress, not the card count: a bumped
 * ticket MOVES COLUMN and stays on the board, so counting cards cannot see a bump at all.
 */
import { launch, newPage, login, probe, shot, BASE, BRANCH, GW } from "./skpx-lib.mjs";

const PERSONA = process.argv[2] ?? "kitchen";
const STATION = process.argv[3] ?? "DEFAULT";

/** Structured board read: which COLUMN each ticket sits in, plus the hint bar. */
async function board(page, tag) {
  const r = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="kds-board"]');
    const cols = [...(root?.querySelectorAll("section, [data-column]") ?? [])];
    const byCol = cols.map((c) => ({
      head: (c.querySelector("h2,h3,header")?.innerText ?? c.getAttribute("data-column") ?? "?").trim().replace(/\s+/g, " "),
      tickets: [...c.querySelectorAll('[data-testid="kds-ticket-card"]')].map((t) => {
        const m = t.innerText.match(/ORD-[\d-]+/);
        return m ? m[0] : t.innerText.replace(/\s+/g, " ").slice(0, 40);
      }),
    }));
    return {
      cardCount: document.querySelectorAll('[data-testid="kds-ticket-card"]').length,
      countLabel: document.querySelector('[data-testid="kds-ticket-count"]')?.innerText.trim() ?? null,
      page: document.querySelector('[data-testid="kds-page-indicator"]')?.innerText.trim() ?? null,
      conn: document.querySelector('[data-testid="kds-connection"]')?.innerText.trim() ?? null,
      hintBar: (document.body.innerText.match(/F bump|R recall/g) ?? []).join(","),
      byCol,
      errorLine: (document.body.innerText.match(/not bumped[^\n]*|Can.t recall[^\n]*|Nothing to recall[^\n]*/i) ?? [null])[0],
      alerts: [...document.querySelectorAll('[role="alert"]')].map((a) => a.innerText.trim().slice(0, 160)),
    };
  });
  console.log(`  [${tag}] cards=${r.cardCount} count="${r.countLabel}" page="${r.page}" conn="${r.conn}" hint="${r.hintBar}" err=${JSON.stringify(r.errorLine)} alerts=${JSON.stringify(r.alerts)}`);
  r.byCol.forEach((c) => console.log(`      column "${c.head}" -> ${c.tickets.length} [${c.tickets.slice(0, 6).join(", ")}]`));
  return r;
}

/** Ticket status straight from kitchen-service, through the browser's own token. */
async function ticketStatuses(page, orderNo) {
  return page.evaluate(async ([gw, branch, ord]) => {
    const tok = (() => {
      for (const k of Object.keys(localStorage)) {
        const v = localStorage.getItem(k) || "";
        const m = v.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
        if (m) return m[0];
      }
      return null;
    })();
    const r = await fetch(`${gw}/api/v1/kitchen/kds/tickets?branchId=${branch}`, {
      headers: tok ? { Authorization: `Bearer ${tok}` } : {},
    });
    if (!r.ok) return { status: r.status, err: (await r.text()).slice(0, 200), tokenFound: !!tok };
    const j = await r.json();
    const rows = Array.isArray(j) ? j : j.data;
    const hit = (rows || []).filter((t) => !ord || t.orderNo === ord);
    return {
      status: r.status, tokenFound: !!tok, total: (rows || []).length,
      matched: hit.map((t) => ({ orderNo: t.orderNo, station: t.stationCode, st: t.status, items: (t.items || []).map((i) => `${i.name || i.menuItemName}:${i.status}`) })),
    };
  }, [GW, BRANCH, orderNo]);
}

async function main() {
  const browser = await launch();
  const { page } = await newPage(browser);
  if (!(await login(page, PERSONA))) process.exit(1);

  const b0 = await probe(page, `/app/kitchen/${STATION}`, { who: PERSONA, wait: 6500 });
  console.log(`\n=== /app/kitchen/${STATION} as ${PERSONA}: heads=${JSON.stringify(b0.heads)} denied=${b0.denied} 404=${b0.is404}`);
  if (b0.denied || b0.is404) { console.log("  body:", b0.text.replace(/\s+/g, " ").slice(0, 600)); await browser.close(); return; }

  const perms = await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      const v = localStorage.getItem(k) || "";
      const m = v.match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/);
      if (m) {
        try {
          let s = m[0].split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
          s += "=".repeat((4 - (s.length % 4)) % 4);
          const p = JSON.parse(atob(s));
          return { roles: p.roles, kds: (p.permissions || []).filter((x) => /kds/.test(x)) };
        } catch { }
      }
    }
    return { note: "no token found in localStorage" };
  });
  console.log("  session permissions:", JSON.stringify(perms));

  const start = await board(page, "START");
  await shot(page, `skpx-c1-board-${PERSONA}`);

  // pick the ticket at position 1
  const target = start.byCol.flatMap((c) => c.tickets)[0];
  console.log(`\n  target ticket (position 1): ${target}`);
  const preApi = await ticketStatuses(page, target);
  console.log("  API BEFORE:", JSON.stringify(preApi).slice(0, 700));

  // focus it, then bump
  await page.locator("body").click({ position: { x: 3, y: 3 } }).catch(() => { });
  await page.waitForTimeout(400);
  await page.keyboard.press("1");
  await page.waitForTimeout(700);
  await shot(page, `skpx-c2-focused-${PERSONA}`);

  console.log("\n=== press F (bump) ===");
  await page.keyboard.press("f");
  await page.waitForTimeout(4500);
  const afterBump = await board(page, "AFTER-F");
  await shot(page, `skpx-c3-after-bump-${PERSONA}`);
  const postApi = await ticketStatuses(page, target);
  console.log("  API AFTER BUMP:", JSON.stringify(postApi).slice(0, 700));

  // bump again — a ticket usually needs PENDING->IN_PROGRESS->READY->(off the board)
  for (const n of [2, 3]) {
    console.log(`\n=== press F again (#${n}) ===`);
    await page.keyboard.press("1"); await page.waitForTimeout(500);
    await page.keyboard.press("f"); await page.waitForTimeout(4500);
    await board(page, `AFTER-F-${n}`);
    console.log(`  API:`, JSON.stringify(await ticketStatuses(page, target)).slice(0, 500));
  }
  await shot(page, `skpx-c4-after-3-bumps-${PERSONA}`);

  console.log("\n=== press R (recall, inside the 60s window) ===");
  await page.keyboard.press("r");
  await page.waitForTimeout(4500);
  await board(page, "AFTER-R");
  console.log("  API AFTER RECALL:", JSON.stringify(await ticketStatuses(page, target)).slice(0, 700));
  await shot(page, `skpx-c5-after-recall-${PERSONA}`);

  console.log("\n=== reload — did any of it persist? ===");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  await board(page, "AFTER-RELOAD");
  console.log("  API AFTER RELOAD:", JSON.stringify(await ticketStatuses(page, target)).slice(0, 700));
  await shot(page, `skpx-c6-after-reload-${PERSONA}`);

  await browser.close();
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
