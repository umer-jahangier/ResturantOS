/*
 * DIAGNOSIS ONLY — tax configuration & fiscal setup.
 *
 * Signs in as the OWNER (the persona who would actually configure tax) and walks every
 * surface that could plausibly host tax configuration. Asserts against refusal pages and
 * error alerts before filing any shot, because a screenshot of "Access denied" or
 * "Couldn't load" looks exactly like a screenshot of a missing feature.
 *
 * Run: node e2e/diag/tax-config-audit.mjs
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/diagnosis/tax-config");
const BASE = "http://localhost:3000";

const OWNER = {
  slug: "floating-terrace",
  email: "owner@terrace.local",
  password: "Terrace#Owner1",
  totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
};

const REFUSAL = /Access denied|You do not have permission|403|Forbidden/i;
const BROKEN = /Couldn't load|Could not load|Something went wrong|Failed to load|Try again/i;

const ROUTES = [
  { name: "settings", route: "/app/settings" },
  { name: "menu-items", route: "/app/menu/items" },
  { name: "hr-settings-tax", route: "/app/hr/settings/tax" },
  { name: "reports-index", route: "/app/reports" },
  { name: "reports-fbr", route: "/app/reports/fbr" },
  { name: "pos", route: "/app/pos" },
  { name: "finance-periods", route: "/app/finance/periods" },
];

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
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
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(OWNER.slug);
  await page.locator('input[name="email"], input#email').first().fill(OWNER.email);
  await page.locator('input[name="password"], input#password').first().fill(OWNER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  const totp = page.locator('input[name="totpCode"], input#totpCode');
  if (await totp.count()) {
    await totp.first().fill(totpNow(OWNER.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4500);
  }
  return !page.url().includes("/login");
}

async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: true });
}

const report = [];
function log(...a) { const s = a.join(" "); console.log(s); report.push(s); }

async function visit(page, name, route, { retry = true } = {}) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  // TRAP: a full page load can land on /login?reason=session_expired. A screenshot of the
  // login page filed as "this feature is missing" is the exact failure this audit must avoid.
  let bounces = 0;
  while (page.url().includes("/login") && bounces < 3) {
    bounces += 1;
    log(`  BOUNCED to login on ${name} (${page.url()}) — re-authenticating, attempt ${bounces}`);
    await login(page);
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
  }
  if (page.url().includes("/login")) {
    log(`  STILL on login after ${bounces} re-auths — cannot measure ${name}`);
    await shot(page, `LOGINWALL-${name}`);
    return { body: "", refused: false, broken: true, unreachable: true };
  }

  let body = await page.locator("body").innerText();
  let alerts = await page.locator('[role="alert"]').allInnerTexts();

  if ((BROKEN.test(body) || alerts.some((t) => BROKEN.test(t))) && retry) {
    log(`  RETRY ${name}: first load showed an error state — reloading`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    body = await page.locator("body").innerText();
    alerts = await page.locator('[role="alert"]').allInnerTexts();
  }

  const refused = REFUSAL.test(body);
  const broken = BROKEN.test(body) || alerts.some((t) => BROKEN.test(t));
  await shot(page, refused ? `REFUSED-${name}` : broken ? `ERROR-${name}` : name);

  log(`\n### ${name}  (${route})`);
  log(`  url=${page.url()}`);
  log(`  refused=${refused} broken=${broken}`);
  if (alerts.length) log(`  alerts: ${JSON.stringify(alerts.slice(0, 4))}`);
  const taxHits = body.split("\n").filter((l) => /tax|gst|ntn|strn|fbr|service charge|vat/i.test(l));
  log(`  lines mentioning tax/fiscal (${taxHits.length}): ${JSON.stringify(taxHits.slice(0, 25))}`);
  return { body, refused, broken };
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log("    ! page error:", String(e).slice(0, 200)));

  if (!(await login(page))) {
    log("LOGIN FAILED as owner — url " + page.url());
    await shot(page, "LOGIN-FAILED");
    await browser.close();
    writeFileSync(`${OUT}/audit-log.txt`, report.join("\n"));
    process.exit(1);
  }
  log("signed in as owner@terrace.local");

  // ---- 0. Does the navigation offer ANY tax configuration entry at all? ----
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const navLinks = await page.locator("nav a, aside a").allInnerTexts();
  const navHrefs = await page.locator("nav a, aside a").evaluateAll((els) =>
    els.map((e) => e.getAttribute("href")),
  );
  log(`\n### NAVIGATION (owner)`);
  log(`  nav entries (${navLinks.length}): ${JSON.stringify(navLinks.map((t) => t.trim()).filter(Boolean))}`);
  log(`  hrefs matching tax/fiscal: ${JSON.stringify(navHrefs.filter((h) => h && /tax|fiscal|fbr/i.test(h)))}`);
  await shot(page, "nav-owner");

  for (const { name, route } of ROUTES) {
    await visit(page, name, route);
  }

  // ---- Menu item edit dialog: is there a tax field on the item? ----
  log(`\n### MENU ITEM EDIT DIALOG — can an owner set a per-item tax rate/code?`);
  await visit(page, "menu-items-for-dialog", "/app/menu/items");
  const editBtn = page
    .locator('button:has-text("Edit"), [aria-label*="Edit" i], button:has-text("New item"), button:has-text("Add item")')
    .first();
  if (await editBtn.count()) {
    await editBtn.click();
    await page.waitForTimeout(2500);
    const dialog = page.locator('[role="dialog"]').first();
    if (await dialog.count()) {
      const box = await dialog.boundingBox();
      log(`  dialog rendered: ${JSON.stringify(box)}`);
      const labels = await dialog.locator("label").allInnerTexts();
      const inputs = await dialog.locator("input, select, textarea").evaluateAll((els) =>
        els.map((e) => ({ name: e.getAttribute("name"), type: e.getAttribute("type"), id: e.id })),
      );
      log(`  dialog labels: ${JSON.stringify(labels)}`);
      log(`  dialog inputs: ${JSON.stringify(inputs)}`);
      log(`  any tax control? ${labels.some((l) => /tax/i.test(l))}`);
      await shot(page, "menu-item-dialog");
    } else {
      log("  NO DIALOG opened");
      await shot(page, "menu-item-dialog-MISSING");
    }
  } else {
    log("  no Edit/New button found on /app/menu/items");
    await shot(page, "menu-items-no-edit-button");
  }

  await browser.close();
  writeFileSync(`${OUT}/audit-log.txt`, report.join("\n"));
  console.log("\nevidence →", OUT);
}

main();
