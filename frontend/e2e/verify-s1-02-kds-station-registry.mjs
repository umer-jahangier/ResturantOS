/*
 * S1-02 — the KDS station registry, proved in Chromium.
 *
 * The two symptoms this drives, both from the product gap register:
 *   #17  an admin-created station is invisible on the KDS until its first ticket arrives
 *   #18  /app/kitchen/NOPE123 renders a healthy empty board with a green LIVE badge
 *
 * The rule this harness follows, because the register says six routes were once audited
 * mid-failure: every assertion checks for [role="alert"] and "Couldn't load" BEFORE it
 * concludes anything from an empty or a missing element. An error state read as an empty
 * state is the defect being repaired, and a harness that makes the same mistake is worse
 * than no harness.
 *
 * Run:  node e2e/verify-s1-02-kds-station-registry.mjs
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/repair/S1-02");
const BASE = "http://localhost:3000";
const SLUG = "floating-terrace";

// scripts/CREDENTIALS.md — development credentials, committed, rotate before deployment.
const ADMIN = {
  email: "admin@terrace.local",
  password: "Terrace#Admin1",
  totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS",
};
const KITCHEN = { email: "kitchen@terrace.local", password: "Terrace#Kitchen1", totpSecret: null };

const STATION_CODE = "PANTRY1";
const STATION_NAME = "Cold prep";
const STATION_TYPE = "PANTRY";

let failures = 0;
let checks = 0;
function check(ok, label, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(char);
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

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(SLUG);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(who.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(2500);

  const totpField = page.locator('input[name="totpCode"], input#totpCode');
  if (await totpField.count()) {
    if (!who.totpSecret) throw new Error(`${who.email} was challenged for TOTP and has no secret`);
    await totpField.first().fill(totpNow(who.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4000);
  }
  await page.waitForTimeout(1500);
  if (page.url().includes("/login")) {
    throw new Error(`${who.email} did not get past /login — still at ${page.url()}`);
  }
  console.log(`  signed in as ${who.email} → ${page.url()}`);
}

/**
 * The guard against auditing a page mid-failure. Returns a description of any error state.
 *
 * Blank `[role="alert"]` nodes are ignored on purpose: the app mounts empty live regions on
 * every screen, and treating those as failures made this harness report every page as broken —
 * the mirror image of the defect it is here to catch.
 */
async function errorStateOn(page) {
  const alerts = (await page.locator('[role="alert"]').allTextContents())
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const body = (await page.locator("body").innerText()).slice(0, 4000);
  const loadFailure = /Couldn't load|Could not load|Something went wrong|SERVICE_UNAVAILABLE/i.exec(
    body,
  );
  if (alerts.length === 0 && !loadFailure) return null;
  return JSON.stringify({ alerts, loadFailure: loadFailure?.[0] ?? null });
}

async function gotoStable(page, path) {
  // One retry, because the register records six routes audited mid-failure and a gateway that
  // has returned 429 on ordinary navigation.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const err = await errorStateOn(page);
    if (!err) return null;
    console.log(`  ${path} showed an error state on attempt ${attempt}: ${err} — retrying`);
    await page.waitForTimeout(2500);
  }
  return await errorStateOn(page);
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

/**
 * sRGB relative luminance from an `[r, g, b]` triple.
 *
 * The triple is resolved IN THE PAGE by painting the computed colour onto a 1×1 canvas — never by
 * regex over the computed string. The first version of this function parsed `rgb(...)` and this
 * design system emits `oklch(...)`: every colour parsed as garbage and every pair scored exactly
 * 1.00:1, so a correct screen was reported as unreadable. A broken instrument that reads "fail" is
 * only luckier than one that reads "pass", not better.
 */
function luminanceOf(rgb) {
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * COMPUTED colour, never the class list.
 *
 * The first run of this harness passed every DOM assertion on the unknown-station screen while
 * the screenshot showed near-black text on a near-black board: the shared <EmptyState> paints its
 * title `text-foreground`, which follows the viewer's light/dark theme, and the KDS surface is
 * permanently dark. A state that is in the DOM and invisible on the wall has not shipped.
 */
async function contrastOf(page, selector) {
  return await page.evaluate((sel) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d");
    /** Any CSS colour → sRGB, by asking the renderer instead of parsing its answer. */
    const toRgb = (value) => {
      if (!value) return null;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000000";
      ctx.fillStyle = value; // ignored if unparseable, leaving the sentinel black
      const before = ctx.fillStyle;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return { rgb: [d[0], d[1], d[2]], resolved: before };
    };
    const el = document.querySelector(sel);
    if (!el) return null;
    let bgEl = el;
    let bg = "";
    while (bgEl) {
      const c = getComputedStyle(bgEl).backgroundColor;
      if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") {
        bg = c;
        break;
      }
      bgEl = bgEl.parentElement;
    }
    const color = getComputedStyle(el).color;
    return { colorCss: color, backgroundCss: bg, color: toRgb(color), background: toRgb(bg) };
  }, selector);
}

async function checkReadable(page, selector, label) {
  const pair = await contrastOf(page, selector);
  if (!pair) return check(false, `${label} — element ${selector} is not in the DOM`);
  const lt = luminanceOf(pair.color?.rgb);
  const lb = luminanceOf(pair.background?.rgb);
  if (lt === null || lb === null) {
    return check(false, `${label} — could not resolve colours`, JSON.stringify(pair));
  }
  const ratio = (Math.max(lt, lb) + 0.05) / (Math.min(lt, lb) + 0.05);
  check(
    ratio >= 4.5,
    `${label} (computed contrast ${ratio.toFixed(2)}:1, needs 4.5)`,
    `${pair.colorCss} on ${pair.backgroundCss} → rgb(${pair.color.rgb}) on rgb(${pair.background.rgb})`,
  );
}

/**
 * The instrument's own calibration, run before it is trusted on anything.
 *
 * Two controls, both required: an oklch pair that MUST read as unreadable and an oklch pair that
 * MUST read as readable. The first version of `checkReadable` scored every pair at exactly 1.00:1
 * because it regex-parsed `rgb(...)` against a design system that emits `oklch(...)` — it reported
 * a correct screen as broken, and it would have reported a broken screen as broken too, for the
 * same wrong reason. An instrument that cannot tell the two apart is not evidence.
 */
async function calibrateContrastProbe(page) {
  await page.evaluate(() => {
    const mk = (id, fg, bg) => {
      const box = document.createElement("div");
      box.style.backgroundColor = bg;
      const p = document.createElement("p");
      p.id = id;
      p.style.color = fg;
      p.textContent = "calibration";
      box.appendChild(p);
      document.body.appendChild(box);
    };
    mk("probe-bad", "oklch(0.15 0.006 195)", "oklch(0.15 0.006 195)");
    mk("probe-good", "oklch(0.968 0.004 195)", "oklch(0.15 0.006 195)");
  });
  const bad = await contrastOf(page, "#probe-bad");
  const good = await contrastOf(page, "#probe-good");
  const ratio = (a, b) => {
    const la = luminanceOf(a);
    const lb = luminanceOf(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const badRatio = ratio(bad?.color?.rgb, bad?.background?.rgb);
  const goodRatio = ratio(good?.color?.rgb, good?.background?.rgb);
  check(
    badRatio < 1.2 && goodRatio > 10,
    `the contrast probe can tell readable from unreadable (bad ${badRatio.toFixed(2)}:1, good ${goodRatio.toFixed(2)}:1)`,
  );
  await page.evaluate(() => {
    document.getElementById("probe-bad")?.parentElement?.remove();
    document.getElementById("probe-good")?.parentElement?.remove();
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // ─────────────────────────────────────────────────────────────── ADMIN ────
  const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminCtx.newPage();
  await login(admin, ADMIN);
  await calibrateContrastProbe(admin);

  // 1. Create the station. Nothing is fired at it, now or ever, in this script.
  let err = await gotoStable(admin, "/app/stations");
  check(err === null, "/app/stations rendered without an error state", err ?? "");

  const alreadyThere = await admin.getByText(STATION_CODE, { exact: false }).count();
  if (alreadyThere === 0) {
    await admin.getByRole("button", { name: "Add station" }).first().click();
    await admin.waitForTimeout(800);
    await admin.locator('input[placeholder="BAR"]').fill(STATION_CODE);
    await admin.locator('input[placeholder="Main bar"]').fill(STATION_NAME);
    await admin.locator('[data-testid="station-type-select"]').selectOption(STATION_TYPE);
    await admin.locator('button[type="submit"][form="station-form"]').click();
    await admin.waitForTimeout(3000);
  } else {
    console.log(`  ${STATION_CODE} already exists at this branch — reusing it`);
  }
  await shot(admin, "01-admin-stations-after-create");
  const stationsText = await admin.locator("body").innerText();
  check(
    stationsText.includes(STATION_CODE) && stationsText.includes(STATION_NAME),
    `${STATION_CODE} (${STATION_NAME}) is listed on /app/stations`,
  );

  // 2. The station picker — the screen that used to omit it entirely.
  err = await gotoStable(admin, "/app/kitchen");
  check(err === null, "/app/kitchen rendered without an error state", err ?? "");
  await shot(admin, "02-admin-kitchen-station-picker");
  const tile = admin.locator(`[data-testid="station-tile-${STATION_CODE}"]`);
  check(
    (await tile.count()) > 0,
    `#17 — ${STATION_CODE} is an available board on /app/kitchen with NO ticket ever fired at it`,
    `tiles on screen: ${JSON.stringify(
      await admin.locator('[data-testid^="station-tile-"]').allTextContents(),
    ).slice(0, 300)}`,
  );

  // 3. The board itself.
  err = await gotoStable(admin, `/app/kitchen/${STATION_CODE}`);
  check(err === null, `/app/kitchen/${STATION_CODE} rendered without an error state`, err ?? "");
  await shot(admin, "03-admin-pantry1-board");
  check(
    (await admin.locator('[data-testid="kds-board"]').count()) > 0,
    `/app/kitchen/${STATION_CODE} renders a real board`,
  );
  check(
    (await admin.locator('[data-testid="kds-station-unknown"]').count()) === 0,
    `/app/kitchen/${STATION_CODE} is NOT the unknown-station state`,
  );
  const h1 = await admin.locator("h1").first().innerText();
  check(h1.trim() === STATION_NAME, `the board's heading is the station's NAME`, `h1 = ${h1}`);
  const ticketCount = await admin.locator('[data-testid="kds-ticket-count"]').innerText();
  check(/^0 tickets$/.test(ticketCount.trim()), "the board is empty, honestly", ticketCount);

  // 4. #18 — the typo.
  await admin.goto(`${BASE}/app/kitchen/NOPE123`, { waitUntil: "domcontentloaded" });
  await admin.waitForTimeout(3500);
  await shot(admin, "04-admin-nope123-unknown-station");
  check(
    (await admin.locator('[data-testid="kds-station-unknown"]').count()) > 0,
    "#18 — /app/kitchen/NOPE123 shows an unknown-station state",
  );
  const nopeBody = await admin.locator("body").innerText();
  check(
    (await admin.locator('[data-testid="kds-connection"]').count()) === 0,
    "#18 — no connection badge (it read a green LIVE before)",
  );
  check(
    (await admin.getByRole("heading", { name: "NOPE123" }).count()) === 0,
    "#18 — the typo is not rendered as the board's h1",
  );
  check(nopeBody.includes("No such station"), "#18 — the screen says so in words");
  await checkReadable(
    admin,
    '[data-testid="kds-station-unknown-title"]',
    "#18 — and the words are legible on the permanently-dark KDS surface",
  );

  // 5. Scope the kitchen persona to the brand-new station, exactly as the register describes
  //    the bartender being set up.
  err = await gotoStable(admin, "/app/users");
  check(err === null, "/app/users rendered without an error state", err ?? "");
  await admin.getByText(KITCHEN.email, { exact: false }).first().click();
  await admin.waitForTimeout(1500);
  await admin.getByRole("button", { name: "Edit", exact: true }).first().click();
  await admin.waitForTimeout(1500);
  const stationBox = admin.locator('[data-testid="station-assignment-field"]');
  check(
    (await stationBox.count()) > 0,
    "the Edit-user dialog offers a station assignment",
  );
  const pantryRow = stationBox.locator("li", { hasText: STATION_NAME });
  check(
    (await pantryRow.count()) > 0,
    `${STATION_NAME} is offered as an assignable station without ever having had a ticket`,
    JSON.stringify(await stationBox.locator("li").allTextContents()).slice(0, 300),
  );
  if ((await pantryRow.count()) > 0) {
    const box = pantryRow.locator('input[type="checkbox"]').first();
    if (!(await box.isChecked())) await box.check();
  }
  await shot(admin, "05-admin-assign-pantry1-to-kitchen-user");
  await admin.getByRole("button", { name: /Save changes/ }).first().click();
  await admin.waitForTimeout(3000);
  await shot(admin, "06-admin-after-save-station-scope");

  await adminCtx.close();

  // ───────────────────────────────────────────────────────── KITCHEN USER ────
  // A fresh context: the scope lives in the JWT, so the persona must sign in AFTER the
  // assignment or they carry the old token — which would make this prove nothing.
  const cookCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const cook = await cookCtx.newPage();
  await login(cook, KITCHEN);

  err = await gotoStable(cook, "/app/kitchen");
  check(err === null, "/app/kitchen rendered without an error state for the kitchen persona", err ?? "");
  await cook.waitForTimeout(2500); // the picker auto-navigates when there is exactly one station
  await shot(cook, "07-kitchen-persona-kitchen-screen");
  const cookBody = await cook.locator("body").innerText();
  check(
    !cookBody.includes("No active stations configured"),
    `#17/§4.1 — the station-scoped kitchen persona does NOT see "No active stations configured"`,
    cookBody.slice(0, 200).replace(/\s+/g, " "),
  );
  check(
    cookBody.includes(STATION_NAME) || cookBody.includes(STATION_CODE),
    `the kitchen persona can see ${STATION_CODE}`,
    `url=${cook.url()}`,
  );

  err = await gotoStable(cook, `/app/kitchen/${STATION_CODE}`);
  check(err === null, `kitchen persona: /app/kitchen/${STATION_CODE} without an error state`, err ?? "");
  await shot(cook, "08-kitchen-persona-pantry1-board");
  check(
    (await cook.locator('[data-testid="kds-board"]').count()) > 0,
    `kitchen persona gets a real board at /app/kitchen/${STATION_CODE}`,
  );

  await cook.goto(`${BASE}/app/kitchen/NOPE123`, { waitUntil: "domcontentloaded" });
  await cook.waitForTimeout(3500);
  await shot(cook, "09-kitchen-persona-nope123");
  check(
    (await cook.locator('[data-testid="kds-station-unknown"]').count()) > 0,
    "#18 — the kitchen persona also gets the unknown-station state for NOPE123",
  );

  await cookCtx.close();

  // ─────────────────────────────────────────────────────────────── RESET ────
  // Ten agents share this stack. Leaving kitchen@terrace.local pinned to a single pantry board
  // would make everyone else's KDS look broken for a reason nothing in their session explains,
  // so the assignment is undone once it has been photographed. The evidence is the screenshots
  // and this log; the shared environment goes back the way it was found.
  const resetCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const reset = await resetCtx.newPage();
  await login(reset, ADMIN);
  await gotoStable(reset, "/app/users");
  await reset.getByText(KITCHEN.email, { exact: false }).first().click();
  await reset.waitForTimeout(1500);
  await reset.getByRole("button", { name: "Edit", exact: true }).first().click();
  await reset.waitForTimeout(1500);
  const resetRow = reset
    .locator('[data-testid="station-assignment-field"]')
    .locator("li", { hasText: STATION_NAME });
  if ((await resetRow.count()) > 0) {
    const box = resetRow.locator('input[type="checkbox"]').first();
    if (await box.isChecked()) await box.uncheck();
  }
  await reset.getByRole("button", { name: /Save changes/ }).first().click();
  await reset.waitForTimeout(3000);
  await shot(reset, "10-station-scope-reset");
  const resetBody = await reset.locator("body").innerText();
  check(
    !/They will see Cold prep only/.test(resetBody),
    "the kitchen persona's station scope was handed back unrestricted",
  );
  await resetCtx.close();

  await browser.close();

  console.log(`\n${checks - failures}/${checks} checks passed. Screenshots in ${OUT}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exitCode = 1;
});
