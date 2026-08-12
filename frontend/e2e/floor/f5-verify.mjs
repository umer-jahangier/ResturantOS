/*
 * F5 RE-OPEN — an independent attempt to break the "net sales is the bill total" fix.
 *
 * Nothing here trusts the fixing agent's harness, their screenshots or their numbers.
 * Every figure is read out of the RENDERED DOM as text (what a human cashing up sees),
 * then re-derived by hand and compared against the raw API the page consumed.
 *
 * What it tries:
 *   1. The owner's own path, signed in for real with TOTP.
 *   2. Reload — does the figure persist, or was it a first-paint accident?
 *   3. MANY days, not the one convenient day. A fix that holds on a zero-tax day is
 *      the exact tautology that let F5 survive its own IT.
 *   4. The screen against the server: no client-side arithmetic re-derivation.
 *   5. The WRONG personas — manager, cashier, waiter — and another tenant.
 *   6. The adjacent screen: the owner dashboard's "Net sales" KPI.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const API = "http://localhost:8080";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F5/verify");
mkdirSync(OUT, { recursive: true });

const PEOPLE = {
  owner: { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" },
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  waiter: { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" },
  accountant: { slug: "floating-terrace", email: "accountant@terrace.local", password: "Terrace#Accountant1", totpSecret: "2XPUJEA7F6YYOV4P7ME5OH6PUBJWTV5C" },
  controlOwner: { slug: "control-bistro-isolation-test-tenant", email: "owner@control.local", password: "Control#Owner1", totpSecret: "77YCNG564SWVW7YPUCJRGDSE6ZSCC3GQ" },
};

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0; const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(char); if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpNow(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const code = ((h[off] & 0x7f) << 24) | ((h[off + 1] & 0xff) << 16) | ((h[off + 2] & 0xff) << 8) | (h[off + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

const checks = [];
function check(ok, what, detail) {
  checks.push({ ok: !!ok, what, detail });
  console.log(`  ${ok ? "PASS" : "**FAIL**"}  ${what}${detail ? ` — ${detail}` : ""}`);
  return !!ok;
}

async function loginOnce(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    if (!who.totpSecret) throw new Error(`${who.email} challenged for TOTP, no secret`);
    // Never spend a code in its last second — a rejected code reads as a broken login.
    const secsIntoWindow = Math.floor(Date.now() / 1000) % 30;
    if (secsIntoWindow > 24) await page.waitForTimeout((31 - secsIntoWindow) * 1000);
    await totp.first().fill(totpNow(who.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(5000);
  }
  if (page.url().includes("/login")) throw new Error(`login failed for ${who.email} — at ${page.url()}`);
  console.log(`  · signed in as ${who.email}`);
}

/** A flaky login must never be reported as a missing feature or a lost permission. */
async function login(page, who) {
  let last = null;
  for (let a = 0; a < 4; a++) {
    try { await loginOnce(page, who); return; }
    catch (e) { last = e; console.log(`   login attempt ${a + 1} for ${who.email} failed, backing off`); await page.waitForTimeout(15000); }
  }
  throw last;
}


/**
 * Wait for the screen to SETTLE — tiles rendered, or an explicit empty/error state.
 * A fixed sleep measures a skeleton and scores it as a missing figure; that is the
 * "empty state looks exactly like an error state" trap in its timing form.
 */
async function settle(page, ms = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const st = await page.evaluate(() => {
      const tiles = document.querySelectorAll('[data-testid^="figure-tile-"]').length;
      const body = document.body.innerText || "";
      return {
        tiles,
        empty: /No trading recorded on this date/i.test(body),
        err: /Couldn.t load|Something went wrong|SERVICE_UNAVAILABLE|Failed to fetch|Access denied/i.test(body),
      };
    });
    if (st.tiles > 0 || st.empty || st.err) return st;
    await page.waitForTimeout(1000);
  }
  return { tiles: 0, empty: false, err: false, timedOut: true };
}

async function trouble(page) {
  return page.evaluate(() => {
    const t = document.body.innerText || "";
    const alerts = [...document.querySelectorAll('[role="alert"]')].map((n) => (n.textContent || "").trim()).filter(Boolean);
    const bad = [];
    if (/Couldn.t load|Something went wrong|SERVICE_UNAVAILABLE|Failed to fetch/i.test(t)) bad.push("load-failure");
    if (/Access denied|You do not have permission/i.test(t)) bad.push("access-denied");
    return { bad, alerts };
  });
}

/** Read every figure tile out of the rendered DOM, by its visible text. */
async function readTiles(page) {
  return page.evaluate(() => {
    const tiles = [...document.querySelectorAll('[data-testid^="figure-tile-"]')].map((el) => {
      const ps = [...el.querySelectorAll("p")].map((p) => (p.textContent || "").trim());
      const label = ps[0] ?? "";
      const all = (el.innerText || "").trim();
      // the money line: first Rs-amount in the tile
      const m = all.match(/Rs\s[-\d,]+\.\d{2}/);
      return {
        testid: el.getAttribute("data-testid"),
        label,
        amountText: m ? m[0] : null,
        text: all.replace(/\s+/g, " "),
      };
    });
    const identityEl = document.querySelector('[data-testid="takings-identity"]');
    return {
      tiles,
      identity: identityEl ? (identityEl.textContent || "").trim() : null,
      bodyHasNoTrading: /No trading recorded on this date/i.test(document.body.innerText || ""),
    };
  });
}

function paisaOf(amountText) {
  if (!amountText) return null;
  const n = amountText.replace(/Rs\s*/, "").replace(/,/g, "");
  return Math.round(parseFloat(n) * 100);
}

async function tokenOf(page) {
  return page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
}
async function apiGet(page, path, token) {
  const t = token ?? (await tokenOf(page));
  return page.evaluate(async ({ p, tok }) => {
    const r = await fetch(`http://localhost:8080${p}`, { credentials: "include", headers: tok ? { Authorization: `Bearer ${tok}` } : {} });
    let body = null; try { body = await r.json(); } catch { body = null; }
    return { status: r.status, body };
  }, { p: path, tok: t });
}

/** The whole point: assert the invariants BY HAND off the rendered text. */
function assertInvariants(prefix, t) {
  const by = {};
  for (const tile of t.tiles) by[tile.label.toLowerCase()] = tile;

  const gross = paisaOf(by["gross sales"]?.amountText);
  const disc = paisaOf(by["discounts"]?.amountText);
  const net = paisaOf(by["net sales"]?.amountText);
  const tax = paisaOf(by["tax"]?.amountText);
  const svc = paisaOf(by["service charge"]?.amountText);
  const billed = paisaOf(by["total billed"]?.amountText);

  check(gross !== null && net !== null, `${prefix}: gross + net tiles rendered`,
    `gross=${by["gross sales"]?.amountText} net=${by["net sales"]?.amountText}`);

  // THE finding: no tile whose label says "net" may exceed gross.
  for (const tile of t.tiles) {
    if (/net/i.test(tile.label)) {
      const v = paisaOf(tile.amountText);
      check(v !== null && gross !== null && v <= gross,
        `${prefix}: "${tile.label}" (${tile.amountText}) <= GROSS (${by["gross sales"]?.amountText})`);
    }
  }
  check(net === gross - disc, `${prefix}: net === gross − discounts`, `${net} === ${gross} − ${disc}`);
  check(tax === null || net !== gross - disc + tax || tax === 0,
    `${prefix}: tax is NOT inside net`, `net=${net} vs gross−disc+tax=${gross - disc + tax}`);
  check(billed === net + tax + svc, `${prefix}: total billed === net + tax + service`,
    `${billed} === ${net} + ${tax} + ${svc}`);

  // Captions must describe the tile above them.
  const netTile = by["net sales"];
  check(netTile && /Tax and service charge are NOT in this figure/i.test(netTile.text),
    `${prefix}: net tile caption says tax is excluded`);
  check(netTile && !/What the bills actually came to/i.test(netTile.text),
    `${prefix}: net tile is NOT captioned "What the bills actually came to"`);
  const billedTile = by["total billed"];
  check(billedTile && /What the bills actually came to/i.test(billedTile.text),
    `${prefix}: "What the bills actually came to" is on TOTAL BILLED`);
  check(t.identity === "Gross sales − discounts = net sales. Net sales + tax + service charge = total billed.",
    `${prefix}: identity line printed`, t.identity);

  return { gross, disc, net, tax, svc, billed };
}

const results = { checks: [], days: {}, personas: {}, dashboard: null };

(async () => {
  const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });

  // ── 1. OWNER, the real path ────────────────────────────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  await login(page, PEOPLE.owner);

  // Which days actually have trading? Ask the server across a window, then test
  // EVERY day that has data — not the single flattering one.
  const token = await tokenOf(page);
  const candidates = [];
  for (let d = 0; d < 14; d++) {
    const dt = new Date(Date.UTC(2026, 7, 12) - d * 86400000).toISOString().slice(0, 10);
    candidates.push(dt);
  }
  const withData = [];
  for (const d of candidates) {
    const r = await apiGet(page, `/api/v1/pos/takings/daily?date=${d}`, token);
    if (r.status === 200 && r.body) {
      const b = r.body.data ?? r.body;
      if ((b.orderCount ?? 0) > 0 || (b.grossSalesPaisa ?? 0) > 0) {
        withData.push({ date: d, api: b });
      }
    }
  }
  console.log(`\n[days with trading] ${withData.map((w) => w.date).join(", ") || "(none)"}\n`);
  results.daysWithData = withData.map((w) => w.date);

  check(withData.length > 0, "there is at least one trading day to test against");

  // At least one of them must have BOTH tax and a discount, or the test is the
  // same tautology that let F5 through in the first place.
  const meaty = withData.filter((w) => (w.api.taxPaisa ?? 0) > 0 && (w.api.discountsPaisa ?? 0) > 0);
  check(meaty.length > 0, "at least one tested day has BOTH tax > 0 AND discounts > 0 (not a zero-tax tautology)",
    meaty.map((m) => m.date).join(", "));

  for (const { date, api } of withData) {
    console.log(`\n── /app/finance/takings?date=${date} ──`);
    await page.goto(`${BASE}/app/finance/takings?date=${date}`, { waitUntil: "domcontentloaded" });
    await settle(page);
    const tr = await trouble(page);
    if (tr.bad.length) {
      console.log(`   ! ${tr.bad.join(",")} — retrying once`);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4500);
    }
    const tr2 = await trouble(page);
    check(tr2.bad.length === 0, `${date}: no error/access-denied state`, tr2.bad.join(",") || "clean");

    const t = await readTiles(page);
    const read = assertInvariants(date, t);

    // The screen must equal the SERVER, to the paisa. If the client re-derived
    // anything the two would drift the moment the server changed.
    check(read.gross === api.grossSalesPaisa, `${date}: screen gross === server grossSalesPaisa`, `${read.gross} vs ${api.grossSalesPaisa}`);
    check(read.net === api.netSalesPaisa, `${date}: screen net === server netSalesPaisa`, `${read.net} vs ${api.netSalesPaisa}`);
    check(read.billed === api.totalBilledPaisa, `${date}: screen total billed === server totalBilledPaisa`, `${read.billed} vs ${api.totalBilledPaisa}`);
    check(api.netSalesPaisa <= api.grossSalesPaisa, `${date}: SERVER netSalesPaisa <= grossSalesPaisa`, `${api.netSalesPaisa} <= ${api.grossSalesPaisa}`);
    check(api.netSalesPaisa === api.grossSalesPaisa - api.discountsPaisa, `${date}: SERVER net === gross − discounts`);
    check(api.totalBilledPaisa === api.netSalesPaisa + api.taxPaisa + api.serviceChargePaisa, `${date}: SERVER totalBilled === net + tax + service`);

    await page.screenshot({ path: `${OUT}/takings-${date}.png` });
    results.days[date] = { read, api: { gross: api.grossSalesPaisa, disc: api.discountsPaisa, net: api.netSalesPaisa, tax: api.taxPaisa, svc: api.serviceChargePaisa, billed: api.totalBilledPaisa, orders: api.orderCount } };

    // ── 2. RELOAD. Does it persist? ────────────────────────────────────────
    await page.reload({ waitUntil: "domcontentloaded" });
    await settle(page);
    const t2 = await readTiles(page);
    const read2 = assertInvariants(`${date} after reload`, t2);
    check(JSON.stringify(read) === JSON.stringify(read2), `${date}: figures identical after reload`,
      `${JSON.stringify(read)} vs ${JSON.stringify(read2)}`);
  }

  // ── 3. The DEFAULT view — no ?date= at all, which is how a manager arrives ──
  console.log(`\n── /app/finance/takings (no ?date=, the default arrival) ──`);
  await page.goto(`${BASE}/app/finance/takings`, { waitUntil: "domcontentloaded" });
  await settle(page);
  const dflt = await readTiles(page);
  if (dflt.bodyHasNoTrading) {
    check(true, "default view: no trading today (empty state, not an error) — invariants not applicable");
  } else {
    assertInvariants("default view", dflt);
  }
  await page.screenshot({ path: `${OUT}/takings-default.png` });

  // ── 4. ADJACENT: the owner dashboard's own "Net sales" KPI ────────────────
  console.log(`\n── ADJACENT: /app/dashboard "Net sales" KPI ──`);
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const dash = await page.evaluate(() => {
    const out = { tiles: [], body: (document.body.innerText || "").slice(0, 4000) };
    for (const el of document.querySelectorAll("*")) {
      const txt = (el.textContent || "").trim();
      if (el.children.length === 0 && /^Net sales$/i.test(txt)) {
        let card = el; for (let i = 0; i < 6 && card.parentElement; i++) card = card.parentElement;
        out.tiles.push((card.innerText || "").replace(/\s+/g, " ").slice(0, 300));
      }
    }
    return out;
  });
  results.dashboard = dash;
  console.log(`   dashboard "Net sales" cards: ${JSON.stringify(dash.tiles, null, 2)}`);
  // Also read what the report actually returns, so the claim is not a guess.
  const rep = await page.evaluate(async ({ tok }) => {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    const r = await fetch(`http://localhost:8080/api/v1/reporting/reports/sales-by-day/run`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
      body: JSON.stringify({ from, to }),
    });
    let b = null; try { b = await r.json(); } catch {}
    return { status: r.status, body: b, from, to };
  }, { tok: token });
  results.salesByDay = rep;
  console.log(`   sales-by-day: status=${rep.status} ${JSON.stringify(rep.body).slice(0, 600)}`);
  await page.screenshot({ path: `${OUT}/dashboard-net-sales.png` });

  await ctx.close();

  // ── 5. WRONG PERSONAS ─────────────────────────────────────────────────────
  for (const name of ["manager", "cashier", "waiter", "accountant"]) {
    console.log(`\n── persona: ${name} ──`);
    const c = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const p = await c.newPage();
    try {
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await login(p, PEOPLE[name]); lastErr = null; break; }
        catch (e) { lastErr = e; console.log(`   login attempt ${attempt + 1} failed, backing off`); await p.waitForTimeout(20000); }
      }
      if (lastErr) throw lastErr;
      const day = withData[0]?.date ?? "2026-08-12";
      await p.goto(`${BASE}/app/finance/takings?date=${day}`, { waitUntil: "domcontentloaded" });
      await settle(p);
      const tr = await trouble(p);
      const t = await readTiles(p);
      const tok = await tokenOf(p);
      const api = await apiGet(p, `/api/v1/pos/takings/daily?date=${day}`, tok);
      const entry = {
        blocked: tr.bad.includes("access-denied"),
        trouble: tr.bad,
        apiStatus: api.status,
        tiles: t.tiles.map((x) => `${x.label}=${x.amountText}`),
      };
      results.personas[name] = entry;
      console.log(`   trouble=${JSON.stringify(tr.bad)} api=${api.status} tiles=${JSON.stringify(entry.tiles)}`);
      if (api.status === 200 && t.tiles.length) {
        // If this persona IS allowed to see it, the same invariants must hold for them.
        assertInvariants(`${name}`, t);
      }
      await p.screenshot({ path: `${OUT}/persona-${name}.png` });
    } catch (e) {
      results.personas[name] = { error: String(e).slice(0, 300) };
      console.log(`   ERROR ${e}`);
    }
    await c.close();
  }

  // ── 6. ANOTHER TENANT — can Control Bistro's owner see Floating Terrace? ──
  console.log(`\n── cross-tenant: control-bistro owner ──`);
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const p2 = await c2.newPage();
  try {
    let le = null;
    for (let a = 0; a < 3; a++) {
      try { await login(p2, PEOPLE.controlOwner); le = null; break; }
      catch (e) { le = e; console.log(`   login attempt ${a + 1} failed, backing off`); await p2.waitForTimeout(20000); }
    }
    if (le) throw le;
    const day = withData[0]?.date ?? "2026-08-12";
    const tok2 = await tokenOf(p2);
    const api2 = await apiGet(p2, `/api/v1/pos/takings/daily?date=${day}`, tok2);
    const b2 = api2.body?.data ?? api2.body;
    results.crossTenant = { status: api2.status, gross: b2?.grossSalesPaisa, net: b2?.netSalesPaisa, orders: b2?.orderCount };
    const terraceGross = withData[0]?.api?.grossSalesPaisa;
    check(api2.status !== 200 || (b2?.grossSalesPaisa ?? 0) !== terraceGross,
      `cross-tenant: control-bistro owner does NOT see Floating Terrace figures`,
      `status=${api2.status} theirGross=${b2?.grossSalesPaisa} terraceGross=${terraceGross}`);
    // And if they do get a page, its own invariants must hold too.
    await p2.goto(`${BASE}/app/finance/takings?date=${day}`, { waitUntil: "domcontentloaded" });
    await settle(p2);
    const t2 = await readTiles(p2);
    if (t2.tiles.length && !t2.bodyHasNoTrading) assertInvariants("control-bistro", t2);
    await p2.screenshot({ path: `${OUT}/cross-tenant.png` });
  } catch (e) {
    results.crossTenant = { error: String(e).slice(0, 300) };
    console.log(`   ERROR ${e}`);
  }
  await c2.close();

  await browser.close();

  results.checks = checks;
  const failed = checks.filter((c) => !c.ok);
  writeFileSync(`${OUT}/f5-verify.json`, JSON.stringify(results, null, 2));
  console.log(`\n=========================================`);
  console.log(`${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log(`FAILURES:`);
    for (const f of failed) console.log(`  ✗ ${f.what}${f.detail ? ` — ${f.detail}` : ""}`);
  }
  console.log(`artifacts: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
})();
