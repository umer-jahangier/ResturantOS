/*
 * Program A — the client half, driven in real Chromium with the UNDEPLOYED endpoints stubbed.
 *
 * WHY A STUB, AND WHAT IT DOES NOT PROVE
 *
 * `drive.mjs` ran first against the live fleet with nothing stubbed and established the facts:
 *   GET /api/v1/users/{id}/menu-categories -> 404 "No endpoint matches this path"
 *   GET /api/v1/users/{id}/stations        -> 200      (control: the route and auth are fine)
 * The user-service proxy hop is part of THIS change, so it is not on the fleet and neither is
 * pos-service's enforcement or OPA's rule. Deploying to close that is task #41's, and doing it in
 * the wrong order stops every till.
 *
 * That run proved something real and worth keeping: the screen reports the failed read AS A
 * FAILURE. It does not render an empty picker, which would have been indistinguishable from
 * "unrestricted" and would have cleared a live boundary on the next save.
 *
 * This run stubs ONLY the two undeployed routes, at the browser, so the rest of the client can be
 * exercised: the picker over the LIVE pos-service catalogue, the multi-select, the copy, and — the
 * point of the whole exercise — the EXACT BODY the client PUTs. Everything else on this page is
 * still the live fleet: the login, the JWT, the roster, the categories.
 *
 * It proves: the client sends the right request to the right path with the right shape.
 * It does NOT prove: that auth-service stores it, that the claim is minted, or that an
 * out-of-scope item is refused. Those are `MenuCategoryBoundaryIT` (15 tests, real OPA
 * container) and `MenuCategoryAssignmentSurfaceTest` (7 tests) — CI, not this fleet.
 *
 * The till is stubbed too, for one reason: `/app/pos` renders "Your till is closed" instead of the
 * grid, and opening a real till would leave a live session on a system the owner is using.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3007";
const API = "http://localhost:8080";
const OUT = resolve(process.cwd(), "../.planning/audits/menu-scope");
mkdirSync(OUT, { recursive: true });

const OWNER = {
  email: "owner@terrace.local",
  password: "Terrace#Owner1",
  totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
};

function b32(input) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0; const out = [];
  for (const ch of input.toUpperCase()) {
    const i = A.indexOf(ch); if (i < 0) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(s) {
  const c = Math.floor(Date.now() / 30000);
  const b = Buffer.alloc(8);
  b.writeUInt32BE(Math.floor(c / 2 ** 32), 0); b.writeUInt32BE(c >>> 0, 4);
  const h = createHmac("sha1", b32(s)).update(b).digest();
  const o = h[h.length - 1] & 0x0f;
  return String((((h[o] & 0x7f) << 24) | (h[o+1] << 16) | (h[o+2] << 8) | h[o+3]) % 1000000).padStart(6, "0");
}

const report = { base: BASE, api: API, stubbed: [], checks: [] };
const record = (name, pass, detail) => {
  report.checks.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

const browser = await chromium.launch({
  // See drive.mjs — the gateway's CORS allow-list names :3000, which is the LIVE frontend. This
  // removes a BROWSER-side origin check and nothing server-side; a 403 would still be a 403.
  args: ["--disable-web-security", "--disable-features=IsolateOrigins,site-per-process", "--disable-dev-shm-usage"],
});

/** Every PUT the client made to the menu-scope endpoint, captured verbatim off the wire. */
const puts = [];
/** What the stub currently claims the server holds. Mutated by the PUT, like a real server. */
let storedScope = [];
/** The owner's own user id, read off their token after sign-in — the till stub needs a cashierId. */
let ownerUserId = "6b1a2d3c-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.__console = [];
  page.on("console", (m) => { if (m.type() === "error") page.__console.push(m.text().slice(0, 250)); });
  page.on("pageerror", (e) => page.__console.push("pageerror: " + String(e).slice(0, 250)));

  // ── the stub, scoped as narrowly as it can be ─────────────────────────────────────────
  await page.route(`${API}/api/v1/users/*/menu-categories`, async (route) => {
    const req = route.request();
    if (req.method() === "PUT") {
      const body = JSON.parse(req.postData() || "null");
      puts.push({ url: req.url().replace(API, ""), body });
      storedScope = [{ branchId: body.branchId, categoryIds: body.categoryIds }];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: body.categoryIds.length ? storedScope : [] }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: storedScope }),
    });
  });
  report.stubbed.push("GET|PUT /api/v1/users/*/menu-categories (undeployed on this fleet)");

  await page.route(`${API}/api/v1/pos/tills?**`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      // Every field `apiTillSessionSchema` requires. A short stub was rejected by Zod and the
      // page said "we couldn't read the server response" — which is the schema doing its job,
      // and worth recording: this product does not render a half-parsed till.
      body: JSON.stringify({
        data: [{
          id: "0f2b1a44-2c9e-4b7a-9f21-0d3a5c7e9b11",
          branchId: "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03",
          cashierId: ownerUserId,
          cashierName: "Terrace Owner",
          openingFloatPaisa: 500000,
          expectedClosingPaisa: null,
          declaredClosingPaisa: null,
          variancePaisa: null,
          openedAt: new Date().toISOString(),
          closedAt: null,
          status: "OPEN",
          note: null,
          reviewStatus: "PENDING_REVIEW",
        }],
      }),
    });
  });
  report.stubbed.push("GET /api/v1/pos/tills (so the grid renders without opening a live till)");

  // ── sign in for real ──────────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.locator('input#email, input[name="email"]').first().fill(OWNER.email);
  await page.locator('input#password, input[name="password"]').first().fill(OWNER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);
  const t = page.locator('input[name="totpCode"], input#totpCode');
  if (await t.count()) {
    await t.first().fill(totp(OWNER.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(5000);
  }
  if (page.url().includes("/login")) throw new Error("login failed @ " + page.url());
  console.log("  signed in as", OWNER.email);
  ownerUserId = await page.evaluate(() => {
    const raw = localStorage.getItem("restaurantos-session") || "";
    const m = raw.match(/"userId":"([0-9a-f-]{36})"/);
    return m ? m[1] : null;
  }) ?? ownerUserId;
  console.log("  owner userId:", ownerUserId);

  // ── the Users screen, with the scope readable ─────────────────────────────────────────
  await page.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  await page.locator("text=cashier@terrace.local").first().click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/s1-detail-unrestricted.png` });

  const unrestricted = await page.evaluate(() => ({
    sentence: (document.querySelector('[data-testid="user-menu-category-unrestricted"]')?.textContent || "").trim(),
    section: (document.querySelector('[data-testid="user-menu-category-scope"]')?.textContent || "").trim().slice(0, 200),
  }));
  record(
    "a user with NO assignment reads as 'the whole menu', not as a blank or a lockout",
    /whole menu/i.test(unrestricted.sentence),
    unrestricted.sentence || unrestricted.section,
  );

  // ── the picker ────────────────────────────────────────────────────────────────────────
  await page.locator('button:has-text("Edit")').first().click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/s2-picker.png` });

  const picker = await page.evaluate(() => {
    const opts = document.querySelector('[data-testid="menu-category-assignment-options"]');
    return {
      count: opts ? opts.querySelectorAll('input[type="checkbox"]').length : 0,
      names: opts ? Array.from(opts.querySelectorAll("li")).map((li) => (li.textContent || "").trim()) : [],
      summary: (document.querySelector('[data-testid="menu-category-assignment-summary"]')?.textContent || "").trim(),
      delay: (document.querySelector('[data-testid="menu-category-assignment-delay-notice"]')?.textContent || "").trim(),
    };
  });
  record(
    "the multi-select is populated from the LIVE pos-service catalogue",
    picker.count > 1,
    `${picker.count} sections offered: ${picker.names.slice(0, 4).join(" / ")}`,
  );
  record(
    "'no assignment = the WHOLE menu' is spelled out in the UI copy",
    /WHOLE menu/i.test(picker.summary) && /default/i.test(picker.summary),
    picker.summary.slice(0, 200),
  );
  record(
    "the access-token delay is stated, not left to be discovered",
    /session next refreshes/i.test(picker.delay),
    picker.delay.slice(0, 130),
  );

  // Tick "Main Bar" — literally the section the owner named — plus one more.
  const boxes = page.locator('[data-testid="menu-category-assignment-options"] input[type="checkbox"]');
  const barIdx = picker.names.findIndex((n) => /bar/i.test(n));
  await boxes.nth(barIdx >= 0 ? barIdx : 0).check();
  await page.waitForTimeout(400);
  await boxes.nth((barIdx >= 0 ? barIdx : 0) === 0 ? 1 : 0).check();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/s3-two-ticked.png` });

  const ticked = await page.evaluate(() => ({
    summary: (document.querySelector('[data-testid="menu-category-assignment-summary"]')?.textContent || "").trim(),
    clear: !!document.querySelector('[data-testid="menu-category-assignment-clear"]'),
  }));
  record(
    "TWO sections can be assigned to one user — 'assign multiple menu to a user'",
    /only at/i.test(ticked.summary) && / and /.test(ticked.summary),
    ticked.summary.slice(0, 220),
  );
  record(
    "the restricted summary says the server refuses the rest, not that it hides it",
    /refused by the server/i.test(ticked.summary),
    ticked.summary.slice(0, 220),
  );
  record("a Clear control offers the whole menu back", ticked.clear, ticked.clear ? "present" : "absent");

  // ── save, and read the wire ───────────────────────────────────────────────────────────
  await page.locator('button:has-text("Save changes")').first().click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/s4-after-save.png` });

  record(
    "saving PUTs to the right path with the right shape",
    puts.length === 1
      && /\/api\/v1\/users\/[0-9a-f-]{36}\/menu-categories$/.test(puts[0].url)
      && typeof puts[0].body?.branchId === "string"
      && Array.isArray(puts[0].body?.categoryIds)
      && puts[0].body.categoryIds.length === 2,
    JSON.stringify(puts[0] ?? null).slice(0, 300),
  );

  // ── read it back on the panel ─────────────────────────────────────────────────────────
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/s5-panel-scoped.png` });
  const readback = await page.evaluate(() => ({
    section: (document.querySelector('[data-testid="user-menu-category-scope"]')?.textContent || "").trim(),
    stillUnrestricted: !!document.querySelector('[data-testid="user-menu-category-unrestricted"]'),
  }));
  record(
    "the panel reads the new scope back and stops saying 'whole menu'",
    !readback.stillUnrestricted && readback.section.length > "Menu sections".length,
    readback.section.slice(0, 220),
  );

  // ── the owner's own switch, on the POS ────────────────────────────────────────────────
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${OUT}/s6-pos-owner.png` });

  const sw = await page.evaluate(() => ({
    label: (document.querySelector('[data-testid="menu-scope-switch-toggle"]')?.textContent || "").trim(),
    confined: !!document.querySelector('[data-testid="menu-scope-confined-notice"]'),
    panelOpen: !!document.querySelector('[data-testid="menu-scope-switch-panel"]'),
    railPills: Array.from(document.querySelectorAll("button"))
      .map((b) => (b.textContent || "").trim())
      .filter((x) => x && x.length < 30).slice(0, 14),
  }));
  record(
    "an unrestricted OWNER gets the switch, COLLAPSED, saying 'whole menu'",
    /whole menu/i.test(sw.label) && !sw.panelOpen && !sw.confined,
    `label=${JSON.stringify(sw.label)} panelOpen=${sw.panelOpen}`,
  );

  if (sw.label) {
    const railBefore = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button")).map((b) => (b.textContent || "").trim())
        .filter((x) => x && x.length < 30).length);
    await page.locator('[data-testid="menu-scope-switch-toggle"]').click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/s7-switch-open.png` });
    const opened = await page.evaluate(() => ({
      boxes: document.querySelectorAll('[data-testid="menu-scope-switch-panel"] input[type="checkbox"]').length,
      notice: (document.querySelector('[data-testid="menu-scope-switch-notice"]')?.textContent || "").trim(),
    }));
    record("the switch offers the operator's own sections", opened.boxes > 1, `${opened.boxes} offered`);
    record(
      "it says IN WORDS that it changes nothing on the server — the claim that must not drift",
      /changes nothing on the server/i.test(opened.notice) && /Users screen/i.test(opened.notice),
      opened.notice.slice(0, 200),
    );

    await page.locator('[data-testid="menu-scope-switch-panel"] input[type="checkbox"]').first().check();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/s8-previewing.png` });
    const after = await page.evaluate(() => ({
      label: (document.querySelector('[data-testid="menu-scope-switch-toggle"]')?.textContent || "").trim(),
      back: !!document.querySelector('[data-testid="menu-scope-switch-all"]'),
      railPills: Array.from(document.querySelectorAll("button")).map((b) => (b.textContent || "").trim())
        .filter((x) => x && x.length < 30).length,
    }));
    record(
      "previewing one section narrows the rail and names what is showing",
      /^Working: /.test(after.label) && !/whole menu/i.test(after.label) && after.back
        && after.railPills < railBefore,
      `label=${JSON.stringify(after.label)} buttons ${railBefore} -> ${after.railPills} back=${after.back}`,
    );
  }

  report.puts = puts;
  report.consoleErrors = page.__console.slice(0, 10);
} catch (e) {
  report.fatal = String(e).slice(0, 700);
  console.log("FATAL:", report.fatal);
} finally {
  await browser.close();
  writeFileSync(`${OUT}/drive-stubbed.json`, JSON.stringify(report, null, 2));
  const passed = report.checks.filter((c) => c.pass).length;
  console.log(`\n${passed}/${report.checks.length} checks passed. Report: ${OUT}/drive-stubbed.json`);
}
