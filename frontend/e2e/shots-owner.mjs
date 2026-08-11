/*
 * Visual evidence for the surfaces `e2e/shots.mjs` could not actually reach (34-06, 34-07).
 *
 * <h3>Why a second harness rather than a flag on the first</h3>
 *
 * `shots.mjs` signs in as `manager@terrace.local`. That persona does NOT hold `rbac.manage`,
 * so every "settings" screenshot it has ever produced is a picture of an Access-denied page —
 * filed as evidence that the settings restyle landed. The same is true of the owner dashboard:
 * the manager preset has no `TrendChart`, so the chart reveal appears in none of those shots.
 *
 * So this harness signs in as the OWNER, which needs a TOTP code, and — more importantly —
 * ASSERTS THE PRECONDITION BEFORE EVERY SHOT. A screenshot of a screen the persona could not
 * reach is worse than no screenshot: it is evidence of the opposite of what it is filed as.
 *
 * Run:  node e2e/shots-owner.mjs after
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const LABEL = process.argv[2] ?? "owner";
const OUT = resolve(process.cwd(), "../.planning/phases/34-visual-design-language/evidence", LABEL);
const BASE = "http://localhost:3000";

const OWNER = {
  slug: "floating-terrace",
  email: "owner@terrace.local",
  password: "Terrace#Owner1",
  // scripts/CREDENTIALS.md — development credentials, committed, rotate before deployment.
  totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
};

/**
 * Every route captured, with the thing that MUST be on screen first.
 *
 * `forbid` is the other half: a selector whose presence means the shot would be a lie. The
 * settings rows carry both, because "Access denied" is a perfectly well-rendered page and a
 * harness with no negative condition files it happily.
 */
const ROUTES = [
  {
    name: "owner-dashboard",
    route: "/app/dashboard",
    require: '[data-testid="trend-chart"]',
    forbid: /Access denied|You do not have permission/i,
  },
  {
    name: "settings",
    route: "/app/settings",
    require: "h1, h2",
    forbid: /Access denied|You do not have permission/i,
  },
  {
    name: "appearance",
    route: "/settings/appearance",
    require: "h1, h2",
    forbid: /Access denied|You do not have permission/i,
  },
];

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

async function assertTheme(page, theme) {
  const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  if (isDark !== (theme === "dark")) {
    throw new Error(`theme did not apply: asked for ${theme}, html.dark=${isDark}`);
  }
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slugField = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slugField.count()) await slugField.first().fill(OWNER.slug);
  await page.locator('input[name="email"], input#email').first().fill(OWNER.email);
  await page.locator('input[name="password"], input#password').first().fill(OWNER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(2500);

  // The owner holds rbac.manage, so the service asks for a second factor. That is the whole
  // reason the manager was used before and the whole reason the settings screens went
  // unverified.
  const totpField = page.locator('input[name="totpCode"], input#totpCode');
  if (await totpField.count()) {
    await totpField.first().fill(totpNow(OWNER.totpSecret));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4000);
  }
  return !page.url().includes("/login");
}

async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: false });
  console.log("  ✓", `${name}.png`);
}

async function main() {
  const browser = await chromium.launch();
  const failures = [];

  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: theme,
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("    ! page error:", String(e).slice(0, 160)));

    if (!(await login(page))) {
      failures.push(`login failed as ${OWNER.email} (${theme}) — url ${page.url()}`);
      await ctx.close();
      continue;
    }
    console.log(`  signed in as owner (${theme})`);

    for (const { name, route, require, forbid } of ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(5000);
      await assertTheme(page, theme);

      const body = await page.locator("body").innerText();
      if (forbid.test(body)) {
        failures.push(`${name}-${theme}: the page is a refusal, not the screen (matched ${forbid})`);
        await shot(page, `REFUSED-${name}-${theme}`);
        continue;
      }
      if ((await page.locator(require).count()) === 0) {
        failures.push(`${name}-${theme}: ANCHOR NOT FOUND — "${require}" is not on the page`);
        await shot(page, `ANCHORLESS-${name}-${theme}`);
        continue;
      }
      await shot(page, `${name}-${theme}`);
    }

    await ctx.close();
  }

  await browser.close();
  console.log("evidence →", OUT);
  if (failures.length) {
    console.log("\nFAILURES (a shot was NOT filed as evidence for these):");
    for (const f of failures) console.log("  ·", f);
    process.exitCode = 1;
  }
}

main();
