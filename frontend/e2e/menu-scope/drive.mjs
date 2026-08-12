/*
 * Program A — driving the per-user menu-scope UI in real Chromium.
 *
 * WHAT THIS CAN AND CANNOT PROVE, stated before the first assertion because the answer is not
 * the one the task assumed:
 *
 *   - The FRONTEND under test is THIS build, served by `next dev` on :3007. Real.
 *   - The BACKEND is the live fleet on :8080, which is NOT this build. Measured this session:
 *       GET /api/v1/users/{id}/menu-categories -> 404 "No endpoint matches this path"
 *       GET /api/v1/users/{id}/stations        -> 200            (the control: route + auth fine)
 *       OPA /v1/policies                       -> 17 policies, no menu_categories rule
 *     So the assignment API is not deployed either — the user-service proxy hop is part of THIS
 *     change. A drive therefore proves the UI, the catalogue read, and how the screen behaves
 *     when the endpoint is absent. It cannot prove the write, the read-back, or the enforcement.
 *   - Deploying to close that gap is task #41's, and doing it in the wrong order stops every till.
 *
 * Everything below is therefore scored honestly: each check records what it actually observed.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3007";
const API = "http://localhost:8080";
const OUT = resolve(process.cwd(), "../.planning/audits/menu-scope");
mkdirSync(OUT, { recursive: true });

const PEOPLE = {
  owner: {
    slug: "floating-terrace",
    email: "owner@terrace.local",
    password: "Terrace#Owner1",
    totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
  },
  cashier: {
    slug: "floating-terrace",
    email: "cashier@terrace.local",
    password: "Terrace#Cashier1",
  },
};

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    const i = alphabet.indexOf(ch);
    if (i === -1) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpNow(secret) {
  const counter = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const c = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(c % 1000000).padStart(6, "0");
}

const report = { base: BASE, api: API, checks: [] };
const record = (name, pass, detail) => {
  report.checks.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  page.__console = [];
  page.__requests = [];
  page.on("console", (m) => { if (m.type() === "error") page.__console.push(m.text().slice(0, 300)); });
  page.on("pageerror", (e) => page.__console.push("pageerror: " + String(e).slice(0, 300)));
  page.on("response", (r) => {
    const u = r.url();
    if (u.startsWith(API)) page.__requests.push({ m: r.request().method(), s: r.status(), u });
  });
  return page;
}

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3500);
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    await totp.first().fill(totpNow(who.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4500);
  }
  if (page.url().includes("/login")) throw new Error(`login failed for ${who.email} @ ${page.url()}`);
  console.log(`  signed in as ${who.email}`);
}

const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`    shot: ${name}.png`);
};

/*
 * `--disable-web-security` is a HARNESS concession, not a product change, and it is worth saying
 * exactly what it buys and what it does not.
 *
 * The gateway's CORS allow-list names `http://localhost:3000`, and :3000 is the LIVE frontend this
 * session must not disturb — so this build is served on :3007 and every XHR to :8080 is refused at
 * preflight. Relaxing the BROWSER's same-origin enforcement removes that, and removes nothing else:
 * CORS is a browser-side control over which ORIGINS may read a response. Every server-side gate in
 * play here — the JWT, `@PreAuthorize`, OPA — is evaluated on the request and is completely
 * unaffected. A 403 stays a 403.
 */
const browser = await chromium.launch({
  args: [
    "--disable-web-security",
    "--disable-features=IsolateOrigins,site-per-process",
    "--disable-dev-shm-usage",
  ],
});

try {
  // ── (1) OWNER on the Users screen ──────────────────────────────────────────────────────
  const owner = await newPage(browser);
  await login(owner, PEOPLE.owner);

  await owner.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(4000);
  await shot(owner, "01-users-screen");

  // Pick the cashier out of the roster and open their detail panel.
  const row = owner.locator('text=cashier@terrace.local').first();
  const found = (await row.count()) > 0;
  record("the roster loads and lists the cashier", found, found ? "row present" : "no row");
  if (found) {
    await row.click();
    await owner.waitForTimeout(3500);
  }
  await shot(owner, "02-cashier-detail");

  const panel = await owner.evaluate(() => {
    const s = document.querySelector('[data-testid="user-menu-category-scope"]');
    return {
      present: !!s,
      text: s ? (s.textContent || "").trim().slice(0, 400) : null,
      unrestricted: !!document.querySelector('[data-testid="user-menu-category-unrestricted"]'),
      hasQueryError: !!(s && s.querySelector('[data-testid="query-error"]')),
    };
  });
  record(
    "the detail panel has a Menu sections section at all",
    panel.present,
    panel.present ? JSON.stringify(panel.text).slice(0, 260) : "absent — the screen this task exists to add",
  );
  // The read 404s against this fleet. The property under test is that the panel says so rather
  // than rendering the unrestricted sentence — reporting "whole menu" over a failed read is the
  // exact GA-001 shape this repo keeps re-committing.
  record(
    "a FAILED scope read is reported as a failure, not as 'the whole menu'",
    panel.present && panel.hasQueryError && !panel.unrestricted,
    `queryError=${panel.hasQueryError} unrestrictedSentence=${panel.unrestricted}`,
  );

  const mcCalls = owner.__requests.filter((r) => r.u.includes("/menu-categories"));
  record(
    "the screen actually calls the new endpoint",
    mcCalls.length > 0,
    mcCalls.map((r) => `${r.m} ${r.s} ${r.u.replace(API, "")}`).join(" | ") || "no call made",
  );

  // ── (2) the assignment field, inside the edit dialog ───────────────────────────────────
  const editBtn = owner.locator('button:has-text("Edit")').first();
  if (await editBtn.count()) {
    await editBtn.click();
    await owner.waitForTimeout(4000);
  }
  await shot(owner, "03-edit-dialog");

  const field = await owner.evaluate(() => {
    const f = document.querySelector('[data-testid="menu-category-assignment-field"]');
    const opts = document.querySelector('[data-testid="menu-category-assignment-options"]');
    const sum = document.querySelector('[data-testid="menu-category-assignment-summary"]');
    return {
      fieldPresent: !!f,
      optionCount: opts ? opts.querySelectorAll('input[type="checkbox"]').length : 0,
      optionNames: opts
        ? Array.from(opts.querySelectorAll("li")).slice(0, 8).map((li) => (li.textContent || "").trim())
        : [],
      summary: sum ? (sum.textContent || "").trim() : null,
      delay: (document.querySelector('[data-testid="menu-category-assignment-delay-notice"]')?.textContent || "").trim(),
      dialogText: (document.querySelector('[role="dialog"]')?.textContent || "").slice(0, 300),
    };
  });
  record(
    "the multi-select renders, sourced from the LIVE pos-service catalogue",
    field.fieldPresent && field.optionCount > 0,
    `${field.optionCount} checkboxes: ${field.optionNames.slice(0, 5).join(" / ")}`,
  );
  record(
    "'no assignment = full menu' is spelled out in the UI copy",
    !!field.summary && /WHOLE menu/i.test(field.summary),
    field.summary ? field.summary.slice(0, 200) : "no summary rendered",
  );
  record(
    "the token-refresh delay is stated rather than left to be discovered",
    /session next refreshes/i.test(field.delay || ""),
    (field.delay || "").slice(0, 140),
  );

  // Tick one and read the summary back — the multi-select is interactive, not decorative.
  const boxes = owner.locator('[data-testid="menu-category-assignment-options"] input[type="checkbox"]');
  let afterTick = null;
  if (await boxes.count()) {
    await boxes.first().check();
    await owner.waitForTimeout(600);
    await boxes.nth(1).check();
    await owner.waitForTimeout(600);
    afterTick = await owner.evaluate(() => ({
      summary: (document.querySelector('[data-testid="menu-category-assignment-summary"]')?.textContent || "").trim(),
      hasClear: !!document.querySelector('[data-testid="menu-category-assignment-clear"]'),
    }));
  }
  await shot(owner, "04-two-sections-ticked");
  record(
    "ticking TWO sections is possible and reported — 'assign multiple menu to a user'",
    !!afterTick && /only at/i.test(afterTick.summary) && afterTick.summary.includes(","),
    afterTick ? afterTick.summary.slice(0, 220) : "could not tick",
  );
  record(
    "a Clear control restores the whole menu",
    !!afterTick?.hasClear,
    afterTick?.hasClear ? "present" : "absent",
  );

  // ── (3) the OWNER's own switch, on the POS ─────────────────────────────────────────────
  await owner.keyboard.press("Escape");
  await owner.waitForTimeout(800);
  await owner.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(7000);
  await shot(owner, "05-pos-owner");

  const sw = await owner.evaluate(() => {
    const t = document.querySelector('[data-testid="menu-scope-switch-toggle"]');
    return {
      present: !!t,
      label: t ? (t.textContent || "").trim() : null,
      panelOpen: !!document.querySelector('[data-testid="menu-scope-switch-panel"]'),
      confinedNotice: !!document.querySelector('[data-testid="menu-scope-confined-notice"]'),
    };
  });
  record(
    "an unrestricted OWNER gets the switch, collapsed, saying 'whole menu'",
    sw.present && /whole menu/i.test(sw.label || "") && !sw.panelOpen,
    `label=${JSON.stringify(sw.label)} panelOpen=${sw.panelOpen} confinedNotice=${sw.confinedNotice}`,
  );

  if (sw.present) {
    await owner.locator('[data-testid="menu-scope-switch-toggle"]').first().click();
    await owner.waitForTimeout(900);
    const opened = await owner.evaluate(() => {
      const p = document.querySelector('[data-testid="menu-scope-switch-panel"]');
      return {
        open: !!p,
        boxes: p ? p.querySelectorAll('input[type="checkbox"]').length : 0,
        notice: (document.querySelector('[data-testid="menu-scope-switch-notice"]')?.textContent || "").trim(),
      };
    });
    await shot(owner, "06-pos-switch-open");
    record(
      "the switch opens and offers the operator's own categories",
      opened.open && opened.boxes > 0,
      `${opened.boxes} sections offered`,
    );
    record(
      "the switch says IN WORDS that it changes nothing on the server",
      /changes nothing on the server/i.test(opened.notice),
      opened.notice.slice(0, 200),
    );

    // Narrow to one section and count the tiles before and after.
    const before = await owner.evaluate(
      () => document.querySelectorAll('[data-testid^="menu-item-"], button[aria-pressed]').length,
    );
    const pbox = owner.locator('[data-testid="menu-scope-switch-panel"] input[type="checkbox"]').first();
    await pbox.check();
    await owner.waitForTimeout(2500);
    const after = await owner.evaluate(() => ({
      tiles: document.querySelectorAll('[data-testid^="menu-item-"], button[aria-pressed]').length,
      label: (document.querySelector('[data-testid="menu-scope-switch-toggle"]')?.textContent || "").trim(),
      backLink: !!document.querySelector('[data-testid="menu-scope-switch-all"]'),
    }));
    await shot(owner, "07-pos-previewing-one-section");
    record(
      "previewing one section narrows the grid and names what is showing",
      /Working: /.test(after.label) && !/whole menu/i.test(after.label) && after.backLink,
      `label=${JSON.stringify(after.label)} tiles ${before} -> ${after.tiles} backLink=${after.backLink}`,
    );
  }

  // ── (4) the CASHIER — the no-regression case, because nobody has a scope today ─────────
  const cashier = await newPage(browser);
  await login(cashier, PEOPLE.cashier);
  await cashier.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await cashier.waitForTimeout(7000);
  await shot(cashier, "08-pos-cashier");

  const cash = await cashier.evaluate(() => {
    const pills = Array.from(document.querySelectorAll("button"))
      .map((b) => (b.textContent || "").trim())
      .filter((t) => t && t.length < 40);
    return {
      categoriesOnRail: pills.filter((p) => /^(All|Starters|Mains|Soft Drinks|Desserts)$/.test(p)),
      switchPresent: !!document.querySelector('[data-testid="menu-scope-switch-toggle"]'),
      confined: !!document.querySelector('[data-testid="menu-scope-confined-notice"]'),
      tiles: document.querySelectorAll('[data-testid^="menu-item-"], button[aria-pressed]').length,
    };
  });
  record(
    "an UNASSIGNED cashier still sees the whole menu — the no-regression case",
    cash.categoriesOnRail.length > 1 && cash.tiles > 0 && !cash.confined,
    `rail=${cash.categoriesOnRail.join(",")} tiles=${cash.tiles} confinedNotice=${cash.confined}`,
  );

  report.consoleErrors = { owner: owner.__console.slice(0, 8), cashier: cashier.__console.slice(0, 8) };
  report.menuCategoryCalls = owner.__requests
    .filter((r) => r.u.includes("/menu-categories"))
    .map((r) => `${r.m} ${r.s} ${r.u.replace(API, "")}`);
} catch (e) {
  report.fatal = String(e).slice(0, 600);
  console.log("FATAL:", report.fatal);
} finally {
  await browser.close();
  writeFileSync(`${OUT}/drive.json`, JSON.stringify(report, null, 2));
  const passed = report.checks.filter((c) => c.pass).length;
  console.log(`\n${passed}/${report.checks.length} checks passed. Report: ${OUT}/drive.json`);
}
