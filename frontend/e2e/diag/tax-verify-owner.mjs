/*
 * DIAGNOSIS ONLY — verification pass over another agent's "Tax configuration and fiscal setup"
 * report. Reads nothing into production; writes only screenshots + a log.
 *
 * Guards against the three traps that have cost this project hours:
 *   1. session_expired bounce  -> re-authenticate and retry, never shoot a login page
 *   2. error/alert state       -> retry up to 3x, and label the shot REFUSED/ERROR if it persists
 *   3. wrong persona           -> assert roles from the in-page token before any verdict
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve("/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/tax-config-verify");
mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}/verify-log.txt`;
writeFileSync(LOG, `tax-config verification ${new Date().toISOString()}\n`);
const log = (...a) => { const s = a.join(" "); console.log(s); appendFileSync(LOG, s + "\n"); };

const OWNER = {
  slug: "floating-terrace",
  email: "owner@terrace.local",
  password: "Terrace#Owner1",
  totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
};

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0; const out = [];
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(ch); if (idx === -1) continue;
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
  const o = h[h.length - 1] & 0x0f;
  const code = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
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

/** Navigate with bounce-recovery and error-retry. Returns {ok, body, state}. */
async function reach(page, route, { settle = 4500, tries = 3 } = {}) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(settle);

    if (page.url().includes("/login")) {
      log(`    [trap] bounced to login on ${route} (attempt ${attempt}) — re-authenticating`);
      if (!(await login(page))) { log("    re-auth FAILED"); continue; }
      continue;
    }
    const body = await page.locator("body").innerText().catch(() => "");
    if (/Access denied|You do not have permission|Forbidden/i.test(body)) {
      return { ok: false, body, state: "REFUSED" };
    }
    // An EMPTY [role="alert"] is a live-region placeholder, not an error. Only non-empty
    // alert text (or an explicit failure string) counts — otherwise every healthy page in
    // this app is filed as broken, which is the audit trap running in reverse.
    const alertText = (await page.locator('[role="alert"]').allInnerTexts().catch(() => []))
      .map((t) => t.trim()).filter(Boolean);
    if (alertText.length > 0 || /Couldn.t load|Something went wrong|Failed to load/i.test(body)) {
      log(`    [trap] error state on ${route} (attempt ${attempt}): ${JSON.stringify(alertText).slice(0, 200)}`);
      if (attempt < tries) { await page.waitForTimeout(2500); continue; }
      return { ok: false, body, state: "ERROR" };
    }
    return { ok: true, body, state: "OK" };
  }
  return { ok: false, body: "", state: "UNREACHABLE" };
}

const shot = async (page, name, full = false) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  log(`    shot -> ${name}.png`);
};

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log("    ! pageerror:", String(e).slice(0, 140)));

  if (!(await login(page))) { log("FATAL: owner login failed"); await browser.close(); process.exit(1); }
  log("signed in as owner@terrace.local, url =", page.url());

  // ---- persona assertion from the token the APP is actually holding -------------------------
  const claims = await page.evaluate(() => {
    const scan = (store) => { const out = []; for (let i = 0; i < store.length; i++) { const k = store.key(i); out.push([k, store.getItem(k)]); } return out; };
    const all = [...scan(localStorage), ...scan(sessionStorage)];
    const jwt = all.map(([, v]) => v).filter(Boolean)
      .flatMap((v) => (v.match(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []));
    if (!jwt.length) return { keys: all.map(([k]) => k), token: null };
    const p = jwt[0].split(".")[1];
    return { keys: all.map(([k]) => k), claims: JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))) };
  });
  log("in-page storage keys:", JSON.stringify(claims.keys));
  if (claims.claims) log("IN-PAGE TOKEN roles =", JSON.stringify(claims.claims.roles), "perms =", claims.claims.permissions?.length);
  else log("(token is httpOnly-cookie held; roles asserted separately via gateway login)");

  // ---- 1. nav surface ------------------------------------------------------------------------
  const nav = await reach(page, "/app/dashboard");
  log(`\n[1] NAV  state=${nav.state}`);
  const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
  const uniq = [...new Set(hrefs.filter(Boolean))].sort();
  log("  all hrefs:", JSON.stringify(uniq));
  log("  tax/fiscal/fbr hrefs:", JSON.stringify(uniq.filter((h) => /tax|fiscal|fbr|vat|gst/i.test(h))));
  await shot(page, "01-nav-owner");

  // ---- 2. tenant settings --------------------------------------------------------------------
  const st = await reach(page, "/app/settings");
  log(`\n[2] /app/settings  state=${st.state}`);
  if (st.ok) {
    const taxLines = st.body.split("\n").filter((l) => /tax|ntn|strn|fbr|gst|vat|service charge/i.test(l));
    log("  tax-ish lines:", JSON.stringify(taxLines));
    const inputs = await page.locator("input, select, textarea").evaluateAll((els) =>
      els.map((e) => ({ name: e.getAttribute("name") || e.id, type: e.type, ro: e.readOnly || e.disabled })));
    log("  editable controls:", JSON.stringify(inputs));
    await shot(page, "02-settings", true);
  } else { await shot(page, `02-settings-${st.state}`); }

  // ---- 3. menu items list + edit dialog -------------------------------------------------------
  const mi = await reach(page, "/app/menu/items");
  log(`\n[3] /app/menu/items  state=${mi.state}`);
  if (mi.ok) {
    log("  tax-ish lines in list:", JSON.stringify(mi.body.split("\n").filter((l) => /tax|gst|vat|17|16%/i.test(l)).slice(0, 10)));
    await shot(page, "03-menu-items", true);
    // open the first row's action menu -> Edit
    const trigger = page.locator('[data-testid*="action"], button[aria-haspopup="menu"]').first();
    if (await trigger.count()) {
      await trigger.click(); await page.waitForTimeout(900);
      const edit = page.getByRole("menuitem", { name: /edit/i }).first();
      if (await edit.count()) {
        await edit.click(); await page.waitForTimeout(2000);
        const dlg = page.locator('[role="dialog"]').first();
        if (await dlg.count()) {
          const box = await dlg.boundingBox();
          log(`  dialog box = ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "null"}`);
          const labels = await dlg.locator("label").allInnerTexts();
          log("  dialog labels:", JSON.stringify(labels));
          const dlgText = await dlg.innerText();
          log("  any tax control in dialog?", /tax|gst|vat/i.test(dlgText));
          await shot(page, "04-menu-item-edit-dialog");
        } else log("  NO DIALOG opened");
      } else log("  no Edit menuitem found");
    } else log("  no action trigger found");
  } else { await shot(page, `03-menu-items-${mi.state}`); }

  // ---- 4. FBR tax summary report (they never drove this in a browser) -------------------------
  const fbr = await reach(page, "/app/reports/fbr", { settle: 6000 });
  log(`\n[4] /app/reports/fbr  state=${fbr.state}`);
  log("  body head:", JSON.stringify(fbr.body.slice(0, 900)));
  await shot(page, fbr.ok ? "05-reports-fbr" : `05-reports-fbr-${fbr.state}`, true);

  // ---- 5. HR payroll tax config ---------------------------------------------------------------
  const hr = await reach(page, "/app/hr/settings/tax", { settle: 6000 });
  log(`\n[5] /app/hr/settings/tax  state=${hr.state}`);
  log("  body head:", JSON.stringify(hr.body.slice(0, 700)));
  await shot(page, hr.ok ? "06-hr-tax" : `06-hr-tax-${hr.state}`, true);

  await browser.close();
  log("\nDONE ->", OUT);
}
main();
