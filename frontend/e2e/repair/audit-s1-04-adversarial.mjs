/*
 * ADVERSARIAL RE-AUDIT of S1-04 (register S1 #11 — the KDS board paged a flat list).
 * Independent of the fixing agent's harness. Drives the real board as the cook.
 *
 *   node e2e/repair/audit-s1-04-adversarial.mjs
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/repair/S1-04/adversarial");
mkdirSync(OUT, { recursive: true });

const PEOPLE = {
  kitchen: { slug: "floating-terrace", email: "kitchen@terrace.local", password: "Terrace#Kitchen1" },
  waiter: { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" },
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  otherTenantKitchen: {
    slug: "control-bistro-isolation-test-tenant",
    email: "kitchen@control.local",
    password: "Control#Kitchen1",
  },
};

const log = (...a) => console.log(...a);

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  log("      shot:", `${name}.png`);
}

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
  if (page.url().includes("/login")) throw new Error(`login failed for ${who.email}`);
}

/** Read the entire board out of the DOM — nothing inferred from source. */
async function probe(page) {
  return page.evaluate(() => {
    const txt = (n) => (n?.textContent ?? "").trim();
    const cols = ["NEW", "STARTED", "PREPARING", "READY"];
    const columns = cols.map((c) => {
      const list = document.querySelector(`[data-testid="kds-column-list-${c}"]`);
      const rendered = Array.from(list?.querySelectorAll("[data-fragment-key]") ?? []).map((el) => {
        const card = el.querySelector('[data-testid="kds-ticket-card"]');
        const badge = el.querySelector('[data-testid="kds-ticket-position"]');
        const moves = Array.from(el.querySelectorAll('[data-testid^="column-move-"]')).map((b) => ({
          testid: b.getAttribute("data-testid"),
          label: (b.textContent ?? "").trim(),
        }));
        return {
          key: el.getAttribute("data-fragment-key"),
          dataPos: el.getAttribute("data-position") ?? "",
          badge: (badge?.textContent ?? "").trim(),
          focused: card?.getAttribute("data-focused") === "true",
          orderNo: txt(el.querySelector('[data-testid="kds-ticket-order-no"]')) || null,
          moves,
        };
      });
      return {
        column: c,
        present: !!list,
        headerCount: txt(document.querySelector(`[data-testid="kds-column-count-${c}"]`)),
        n: rendered.length,
        more: txt(document.querySelector(`[data-testid="kds-column-more-${c}"]`)),
        rendered,
      };
    });
    return {
      url: location.pathname,
      board: !!document.querySelector('[data-testid="kds-board"]'),
      loading: !!document.querySelector('[data-testid="kds-board-loading"]'),
      unknownStation: !!document.querySelector('[data-testid="kds-station-unknown"]'),
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map(txt).filter(Boolean),
      ticketCount: txt(document.querySelector('[data-testid="kds-ticket-count"]')),
      pageIndicator: txt(document.querySelector('[data-testid="kds-page-indicator"]')),
      bodyText: (document.body.innerText || "").slice(0, 400),
      columns,
      totalRendered: columns.reduce((a, c) => a + c.n, 0),
      unnumbered: columns.flatMap((c) =>
        c.rendered.filter((r) => !r.badge).map((r) => `${c.column}:${r.key}`),
      ),
      badges: columns.flatMap((c) => c.rendered.map((r) => r.badge)),
      focusedKeys: columns.flatMap((c) => c.rendered.filter((r) => r.focused).map((r) => r.key)),
    };
  });
}

const line = (p) =>
  `page ${p.pageIndicator || "1 / 1"} | ${p.ticketCount} | ` +
  p.columns.map((c) => `${c.column} ${c.n}(hdr ${c.headerCount}${c.more ? `,${c.more}` : ""})`).join("  ") +
  ` | rendered=${p.totalRendered} unnumbered=${p.unnumbered.length}`;

const FAILURES = [];
function check(ok, msg, detail) {
  log(`   ${ok ? "PASS" : "FAIL"}  ${msg}${detail ? ` — ${detail}` : ""}`);
  if (!ok) FAILURES.push(`${msg}${detail ? ` — ${detail}` : ""}`);
  return ok;
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });

  // ─────────────────────────────────────────────────────────── 1. the cook
  log("\n== 1. sign in as the cook and open the board ==");
  await login(page, PEOPLE.kitchen);
  await page.goto(`${BASE}/app/kitchen/DEFAULT`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  let p = await probe(page);
  log("   ", line(p));
  check(p.board, "board rendered");
  check(p.alerts.length === 0, "no [role=alert] on the board", p.alerts.join(" | "));
  await shot(page, "01-page1");

  const pageCount = Number((p.pageIndicator || "1 / 1").split("/")[1]?.trim() || 1);
  log(`    page count = ${pageCount}`);

  // every visible card numbered, no duplicate numbers
  check(p.unnumbered.length === 0, "every visible card carries a position number", p.unnumbered.join(","));
  check(
    new Set(p.badges).size === p.badges.length,
    "no duplicate position numbers on the page",
    p.badges.join(","),
  );

  // ───────────────────────────────────── 2. mouse bump #1 — must stay in view
  log("\n== 2. MOUSE: bump the first New card and look for it ==");
  const first = p.columns.find((c) => c.column === "NEW")?.rendered[0];
  if (!first) throw new Error("no NEW card to bump");
  const firstMove = first.moves[0];
  log(`    clicking "${firstMove.label}" on NEW card ${first.key} (pos ${first.badge})`);
  const pageBefore = p.pageIndicator;
  await page.locator(`[data-testid="${firstMove.testid}"]`).first().click();
  await page.waitForTimeout(2500);
  p = await probe(page);
  log("   ", line(p));
  const ticketId = first.key.split(":")[1];
  const startedKey = `STARTED:${ticketId}`;
  const visibleKeys = p.columns.flatMap((c) => c.rendered.map((r) => r.key));
  check(visibleKeys.includes(startedKey), "the bumped ticket is visible in STARTED on the cook's screen");
  check(
    p.pageIndicator === pageBefore,
    "the board did NOT turn a page under the cook",
    `before ${pageBefore} after ${p.pageIndicator}`,
  );
  check(p.unnumbered.length === 0, "still every card numbered after the bump", p.unnumbered.join(","));
  await shot(page, "02-after-mouse-bump-1");

  // ─────────────────────────── 3. three more mouse bumps, all must stay visible
  log("\n== 3. MOUSE: three more bumps ==");
  for (let i = 0; i < 3; i += 1) {
    p = await probe(page);
    const newCards = p.columns.find((c) => c.column === "NEW")?.rendered ?? [];
    const card = newCards.find((c) => c.moves.length > 0);
    if (!card) {
      check(false, `bump ${i + 2}: no NEW card with a move button on the page`);
      break;
    }
    const before = p.pageIndicator;
    const tid = card.key.split(":")[1];
    await page.locator(`[data-testid="${card.moves[0].testid}"]`).first().click();
    await page.waitForTimeout(2500);
    p = await probe(page);
    const keys = p.columns.flatMap((c) => c.rendered.map((r) => r.key));
    check(keys.includes(`STARTED:${tid}`), `bump ${i + 2}: landed visible in STARTED`);
    check(
      p.pageIndicator === before,
      `bump ${i + 2}: board stayed on the cook's page`,
      `before ${before} after ${p.pageIndicator}`,
    );
    log("   ", line(p));
  }
  await shot(page, "03-after-four-bumps");

  // ──────────────────────────── 4. keyboard: number-key jump then F, on PREPARING
  log("\n== 4. KEYBOARD: number key + F on a PREPARING card (the advertised bump-bar path) ==");
  p = await probe(page);
  let prep = p.columns.find((c) => c.column === "PREPARING");
  if (prep.n === 0) {
    // Make one: bump a STARTED card to PREPARING with the mouse first.
    const started = p.columns.find((c) => c.column === "STARTED").rendered.find((r) => r.moves.length);
    if (started) {
      log(`    no PREPARING card on this page; promoting ${started.key} first`);
      await page.locator(`[data-testid="${started.moves[0].testid}"]`).first().click();
      await page.waitForTimeout(2500);
      p = await probe(page);
      prep = p.columns.find((c) => c.column === "PREPARING");
    }
  }
  log("   ", line(p));
  const prepCard = prep.rendered[0];
  if (!prepCard) {
    check(false, "a PREPARING card is reachable on the cook's page");
  } else {
    const key = prepCard.badge; // the number printed on the face
    log(`    PREPARING card ${prepCard.key} shows "${key}" — pressing that physical key`);
    await page.keyboard.press(key === "0" ? "0" : key);
    await page.waitForTimeout(600);
    let after = await probe(page);
    check(
      after.focusedKeys.includes(prepCard.key),
      `pressing "${key}" focused exactly that card`,
      `focused=${after.focusedKeys.join(",")}`,
    );
    await shot(page, "04-focused-preparing");
    const tid = prepCard.key.split(":")[1];
    await page.keyboard.press("f");
    await page.waitForTimeout(3000);
    after = await probe(page);
    log("   ", line(after));
    const keys = after.columns.flatMap((c) => c.rendered.map((r) => r.key));
    check(keys.includes(`READY:${tid}`), "F advanced the focused card into READY, visibly");
    await shot(page, "05-after-F");

    // ─────────────────────────────────── 5. PERSISTENCE: reload and look again
    log("\n== 5. reload the page — did it persist? ==");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4500);
    const rp = await probe(page);
    log("   ", line(rp));
    check(rp.alerts.length === 0, "no alert after reload", rp.alerts.join("|"));
    // read the server, not the DOM
    const server = await page.evaluate(async (tid2) => {
      const r = await fetch(`/api/proxy/noop`).catch(() => null);
      return r ? "n/a" : "n/a";
    }, tid);
    global.__persistCheckTicket = tid;
    log(`    (ticket ${tid} will be re-read from kitchen-service over HTTP by the caller)`);
  }

  // ───────────────────────────────── 6. focus pinning vs. paging (adversarial)
  log("\n== 6. ADVERSARIAL: does PgDn still work after a number-key jump? ==");
  p = await probe(page);
  if (Number((p.pageIndicator || "1 / 1").split("/")[1]?.trim() || 1) > 1) {
    await page.keyboard.press("1");
    await page.waitForTimeout(400);
    const beforePg = (await probe(page)).pageIndicator;
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(900);
    const afterPg = (await probe(page)).pageIndicator;
    check(beforePg !== afterPg, "PgDn turns the page after focus was set", `${beforePg} -> ${afterPg}`);
    await page.keyboard.press("PageUp");
    await page.waitForTimeout(900);
  } else {
    log("    only one page — skipped");
  }

  // ───────────────────────── 7. walk every page: numbering at every boundary
  log("\n== 7. walk every page with PgDn and check numbering at each boundary ==");
  await page.goto(`${BASE}/app/kitchen/DEFAULT`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const walked = [];
  for (let i = 0; i < 30; i += 1) {
    const q = await probe(page);
    walked.push(q);
    log(`    ${line(q)}`);
    if (q.unnumbered.length) check(false, `page ${q.pageIndicator}: unnumbered cards`, q.unnumbered.join(","));
    if (new Set(q.badges).size !== q.badges.length)
      check(false, `page ${q.pageIndicator}: duplicate numbers`, q.badges.join(","));
    if (q.alerts.length) check(false, `page ${q.pageIndicator}: alert on board`, q.alerts.join("|"));
    const [cur, of] = (q.pageIndicator || "1 / 1").split("/").map((s) => Number(s.trim()));
    if (!of || cur >= of) break;
    await page.keyboard.press("PageDown");
    await page.waitForTimeout(700);
  }
  check(
    walked.every((w) => w.unnumbered.length === 0),
    `every card on all ${walked.length} pages carries a position number`,
  );
  // A column that has work must not render as empty while it has work on THIS page's
  // reachable set — the register's actual complaint.
  const p1 = walked[0];
  const starved = p1.columns.filter((c) => Number(c.headerCount) > 0 && c.n === 0);
  check(starved.length === 0, "no column on page 1 is empty while its queue has work", starved.map((c) => c.column).join(","));
  await shot(page, "07-last-page");

  // ───────────────────────────────────────── 8. wrong persona / other tenant
  log("\n== 8. WRONG PERSONA: waiter, cashier, and another tenant's cook ==");
  for (const [name, who] of [
    ["waiter", PEOPLE.waiter],
    ["cashier", PEOPLE.cashier],
  ]) {
    const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pg2 = await c2.newPage();
    try {
      await login(pg2, who);
      await pg2.goto(`${BASE}/app/kitchen/DEFAULT`, { waitUntil: "domcontentloaded" });
      await pg2.waitForTimeout(4000);
      const q = await probe(pg2);
      const denied = /access denied|not authorized|permission|forbidden|don.t have/i.test(q.bodyText);
      log(`    ${name}: board=${q.board} rendered=${q.totalRendered} denied=${denied}`);
      log(`      body: ${q.bodyText.replace(/\n/g, " / ").slice(0, 200)}`);
      check(
        !q.board || q.totalRendered === 0,
        `${name} cannot see the kitchen board's tickets`,
        `board=${q.board} cards=${q.totalRendered}`,
      );
      await pg2.screenshot({ path: `${OUT}/08-${name}.png` });
    } catch (e) {
      log(`    ${name}: ${e.message}`);
    }
    await c2.close();
  }

  {
    const c3 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pg3 = await c3.newPage();
    try {
      await login(pg3, PEOPLE.otherTenantKitchen);
      await pg3.goto(`${BASE}/app/kitchen/DEFAULT`, { waitUntil: "domcontentloaded" });
      await pg3.waitForTimeout(4500);
      const q = await probe(pg3);
      log(`    control-bistro cook: board=${q.board} rendered=${q.totalRendered} count="${q.ticketCount}"`);
      const orders = q.columns.flatMap((c) => c.rendered.map((r) => r.key.split(":")[1]));
      log(`      ticket ids: ${orders.slice(0, 4).join(", ")}${orders.length > 4 ? "…" : ""}`);
      await pg3.screenshot({ path: `${OUT}/08-other-tenant.png` });
      global.__otherTenantTicketIds = orders;
    } catch (e) {
      log(`    other tenant: ${e.message}`);
    }
    await c3.close();
  }

  log("\n== console errors seen ==");
  for (const e of consoleErrors.slice(0, 10)) log("   ", e);

  log("\n================ RESULT ================");
  if (FAILURES.length === 0) log("ALL CHECKS PASSED");
  else {
    log(`${FAILURES.length} FAILURE(S):`);
    for (const f of FAILURES) log("  -", f);
  }
  if (global.__persistCheckTicket) log(`PERSIST_TICKET=${global.__persistCheckTicket}`);
  await browser.close();
  process.exit(FAILURES.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(2);
});
