/*
 * S1-09 acceptance drive — the whole DONE MEANS, in one Chromium session.
 *
 *   1. baseline, everything up: manager on /app/pos, owner on /app/settings/health
 *   2. stop pos-service on purpose
 *   3. WITHOUT a reload, the owner's health screen flips pos-service to DOWN
 *   4. the manager's till shows a plain-language [role=alert] naming what is unavailable and
 *      what still works, with a retry — never "Your till is closed"
 *   5. restart pos-service
 *   6. WITHOUT a reload, the health screen flips pos-service back to UP
 *   7. the till recovers on Try again — no reload
 *
 * Run:  node e2e/repair/s1-09-verify.mjs <outDir>
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";

const OUT =
  process.argv[2] ??
  "/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/repair/S1-09/after";
const BASE = "http://localhost:3000";
const ROOT = "/Users/muhammadumer/Documents/Projects/ResturantOS";
mkdirSync(OUT, { recursive: true });

const MANAGER = {
  slug: "floating-terrace",
  email: "manager@terrace.local",
  password: "Terrace#Manager1",
};
const OWNER = {
  slug: "floating-terrace",
  email: "owner@terrace.local",
  password: "Terrace#Owner1",
  totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
};

const log = [];
function say(line) {
  console.log(line);
  log.push(line);
}

// ── TOTP (same implementation as e2e/shots-owner.mjs) ────────────────────────
function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totpNow(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The OWNER's login is two submits, not one.
 *
 * `login-form.tsx:156` reveals the `totpCode` field only AFTER auth-service answers the first
 * attempt with TOTP_REQUIRED — so filling it before the first submit finds no element, the code is
 * never sent, and the harness reports "login failed" against a perfectly working login. Observed
 * exactly that on the first run of this file.
 */
async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4000);

  if (who.totpSecret && page.url().includes("/login")) {
    const totp = page.locator('input[name="totpCode"], input#totpCode');
    if (await totp.count()) {
      await totp.first().fill(totpNow(who.totpSecret));
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(5000);
    }
  }
  return !page.url().includes("/login");
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  say(`  shot ${name}.png`);
}

function pos(action) {
  const out = execFileSync("bash", [`${ROOT}/scripts/ops/s1-09-pos-toggle.sh`, action], {
    encoding: "utf8",
  });
  say(`  pos-service ${action}: ${out.trim()}`);
}

/**
 * What the health screen currently says about one service — read from the DOM, not from the API.
 *
 * `pill` is measured with `getComputedStyle`, not by reading the class list. The first build of
 * this row set `border-success text-success-foreground` on the state pill; every class was
 * present in the DOM and the word "Up" rendered near-white on a white card, i.e. an empty
 * capsule. A class-list assertion would have called that green.
 */
async function healthRow(page, service) {
  return page.evaluate((name) => {
    const li = document.querySelector(`[data-testid="fleet-service-${name}"]`);
    if (!li) return null;
    const pill = document.querySelector(`[data-testid="fleet-state-${name}"]`);
    const style = pill ? getComputedStyle(pill) : null;
    return {
      state: li.getAttribute("data-state"),
      lastReachable:
        document.querySelector(`[data-testid="fleet-last-reachable-${name}"]`)?.textContent ?? null,
      pill: pill
        ? {
            word: pill.textContent.trim(),
            color: style.color,
            background: style.backgroundColor,
            legible: style.color !== style.backgroundColor,
          }
        : null,
      text: li.textContent.replace(/\s+/g, " ").trim().slice(0, 220),
    };
  }, service);
}

async function tillState(page) {
  return page.evaluate(() => {
    const alerts = [...document.querySelectorAll('[role="alert"]')].map((e) =>
      e.textContent.replace(/\s+/g, " ").trim(),
    );
    return {
      alerts,
      outage: !!document.querySelector('[data-testid="query-service-outage"]'),
      retry: !!document.querySelector('[data-testid="query-error-retry"]'),
      healthLink: !!document.querySelector('[data-testid="query-outage-health-link"]'),
      saysTillClosed: document.body.innerText.includes("Your till is closed"),
      saysNoItems: document.body.innerText.includes("No items available"),
      menuGrid: !!document.querySelector('[data-testid="menu-grid"]'),
    };
  });
}

const results = {};
const browser = await chromium.launch();

try {
  // Everything must start healthy, or nothing measured below means anything.
  pos("start");

  const ctxManager = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const manager = await ctxManager.newPage();
  const ctxOwner = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const owner = await ctxOwner.newPage();

  say("STEP 1 — sign in");
  // Retried, because /api/v1/auth/login carries a deliberately tight per-IP budget
  // (replenishRate 2/s) and a harness re-run inside a minute can spend it — a 429 there looks
  // exactly like a wrong password and would be reported as one.
  for (const [name, page, who] of [
    ["manager", manager, MANAGER],
    ["owner", owner, OWNER],
  ]) {
    let ok = false;
    for (let i = 0; i < 4 && !ok; i += 1) {
      if (i > 0) await sleep(20000);
      ok = await login(page, who);
    }
    say(`  ${name}: ${ok ? "OK" : "FAILED " + page.url()}`);
    if (!ok) throw new Error(`${name} could not sign in`);
  }

  say("STEP 2 — the sidebar entry an owner reaches the screen through");
  await owner.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(3500);
  const navLink = owner.locator('a[href="/app/settings/health"]');
  results.sidebarEntryVisible = (await navLink.count()) > 0;
  say(`  sidebar has a link to /app/settings/health: ${results.sidebarEntryVisible}`);
  await shot(owner, "01-owner-sidebar");
  if (results.sidebarEntryVisible) {
    await navLink.first().click();
  } else {
    await owner.goto(`${BASE}/app/settings/health`, { waitUntil: "domcontentloaded" });
  }
  // Wait for the LIST, not for a stopwatch. The first run of this harness read the URL 4s after
  // the click, while the client-side navigation was still in flight, and recorded "landed on
  // /app/dashboard, services listed: 0" for a screen that was about to render fifteen rows —
  // a harness reporting a failure the product did not have.
  await owner.waitForSelector('[data-testid="fleet-health-list"]', { timeout: 30000 });
  await owner.waitForTimeout(1500);
  results.landedOn = new URL(owner.url()).pathname;
  say(`  landed on ${results.landedOn}`);
  // The baseline must actually BE a baseline. The previous run of this harness photographed
  // "02-health-all-up" while pos-service was in fact down — a sibling agent had restarted it
  // underneath the drive — which would have made every later assertion measure nothing. Wait for
  // the screen itself to say pos-service is UP before stopping anything, and refuse to continue
  // if it never does.
  let baselineUp = false;
  for (let i = 0; i < 24; i += 1) {
    const row = await healthRow(owner, "pos-service");
    if (row?.state === "UP") {
      baselineUp = true;
      break;
    }
    await sleep(2500);
  }
  results.baselineWasHealthy = baselineUp;
  if (!baselineUp) throw new Error("baseline is not healthy: pos-service never read UP");

  results.baselineFleet = await owner.evaluate(() =>
    [...document.querySelectorAll("[data-testid^='fleet-service-']")].map((li) => ({
      name: li.getAttribute("data-service"),
      state: li.getAttribute("data-state"),
    })),
  );
  say(`  services listed: ${results.baselineFleet.length}`);
  say(`  ${results.baselineFleet.map((s) => s.name + "=" + s.state).join(" ")}`);
  await shot(owner, "02-health-all-up");

  await manager.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await manager.waitForTimeout(6000);
  results.tillBeforeOutage = await tillState(manager);
  say(`  till baseline: menuGrid=${results.tillBeforeOutage.menuGrid}`);
  if (!results.tillBeforeOutage.menuGrid) {
    throw new Error("baseline is not healthy: the till did not render a menu grid before the outage");
  }
  await shot(manager, "03-till-healthy");

  say("STEP 3 — stop pos-service on purpose");
  pos("stop");

  say("STEP 4 — the health screen must notice WITHOUT a reload");
  let downRow = null;
  for (let i = 0; i < 24; i += 1) {
    await sleep(2500);
    downRow = await healthRow(owner, "pos-service");
    if (downRow && downRow.state === "DOWN") break;
  }
  await owner.evaluate(() =>
    document
      .querySelector('[data-testid="fleet-service-pos-service"]')
      ?.scrollIntoView({ block: "center" }),
  );
  await sleep(600);
  results.posDownRow = downRow;
  results.healthNoticedDownWithoutReload = downRow?.state === "DOWN";
  say(`  pos-service row (no reload): ${JSON.stringify(downRow)}`);
  results.summaryWhileDown = await owner.evaluate(
    () =>
      document.querySelector('[data-testid="fleet-health-summary"]')?.textContent?.replace(/\s+/g, " ").trim() ??
      null,
  );
  say(`  summary: ${results.summaryWhileDown}`);
  await shot(owner, "04-health-pos-down");

  say("STEP 5 — the till, as the manager finds it");
  await manager.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await manager.waitForTimeout(8000);
  results.tillDuringOutage = await tillState(manager);
  say(`  ${JSON.stringify(results.tillDuringOutage, null, 1)}`);
  await shot(manager, "05-till-outage");

  say("STEP 6 — restart pos-service");
  pos("start");

  say("STEP 7 — the health screen must recover WITHOUT a reload");
  let upRow = null;
  for (let i = 0; i < 32; i += 1) {
    await sleep(2500);
    upRow = await healthRow(owner, "pos-service");
    if (upRow && upRow.state === "UP") break;
  }
  results.posUpRow = upRow;
  results.healthRecoveredWithoutReload = upRow?.state === "UP";
  results.reloadsSinceLoad = await owner.evaluate(() => performance.getEntriesByType("navigation").length);
  say(`  pos-service row (still no reload): ${JSON.stringify(upRow)}`);
  await shot(owner, "06-health-pos-back-up");

  say("STEP 8 — the till recovers on Try again, without a reload");
  let recovered = null;
  const retryStartedAt = Date.now();
  let retryPresses = 0;
  for (let i = 0; i < 24; i += 1) {
    const retry = manager.locator('[data-testid="query-error-retry"]').first();
    if (await retry.count()) {
      await retry.click();
      retryPresses += 1;
    }
    await sleep(5000);
    recovered = await tillState(manager);
    if (recovered.menuGrid) break;
  }
  results.tillAfterRetry = recovered;
  results.tillRecoveredOnRetry = !!recovered?.menuGrid;
  // Recorded rather than hidden: a restarted JVM needs time before it serves, and the gateway's
  // circuit breaker needs a probe window on top. "Recovers on retry" is only an honest claim if
  // the number of presses and the elapsed time are on the record beside it.
  results.retryPresses = retryPresses;
  results.retrySecondsToRecover = Math.round((Date.now() - retryStartedAt) / 1000);
  say(`  presses=${retryPresses} elapsed=${results.retrySecondsToRecover}s`);
  say(`  after retry: ${JSON.stringify(recovered)}`);
  await shot(manager, "07-till-recovered");

  say("STEP 8b — an OWNER hitting an outage is offered the health screen from the notice");
  pos("stop");
  await owner.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(8000);
  results.ownerTillOutage = await tillState(owner);
  say(`  owner till: outage=${results.ownerTillOutage.outage} healthLink=${results.ownerTillOutage.healthLink}`);
  await shot(owner, "09-owner-till-outage-with-link");
  pos("start");

  say("STEP 9 — a persona WITHOUT ops.health.view must not get the screen");
  await manager.goto(`${BASE}/app/settings/health`, { waitUntil: "domcontentloaded" });
  await manager.waitForTimeout(4000);
  results.managerOnHealth = await manager.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    return {
      path: location.pathname,
      // The MAIN region, not the whole body: the body starts with the sidebar, and slicing it
      // photographs the nav instead of the answer. A settings area was once "verified" for weeks
      // as a picture of an access-denied page; this is the same mistake pointing the other way.
      main: main.innerText.replace(/\s+/g, " ").trim().slice(0, 260),
      hasList: !!document.querySelector('[data-testid="fleet-health-list"]'),
      accessDenied: main.innerText.includes("Access denied"),
    };
  });
  results.managerSidebarHasHealth = await manager.evaluate(
    () => !!document.querySelector('a[href="/app/settings/health"]'),
  );
  say(`  ${JSON.stringify(results.managerOnHealth)}`);
  say(`  manager sidebar offers it: ${results.managerSidebarHasHealth}`);
  await shot(manager, "08-manager-refused");
} finally {
  await browser.close();
  writeFileSync(`${OUT}/RESULT.json`, JSON.stringify(results, null, 2));
  writeFileSync(`${OUT}/RUN-LOG.txt`, log.join("\n") + "\n");
  console.log("\nevidence →", OUT);
}
