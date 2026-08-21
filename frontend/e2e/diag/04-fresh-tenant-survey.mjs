/* Survey: what a brand-new tenant's owner can actually set up, screen by screen. */
import { launch, visit, OUT, BASE } from "./onboarding-lib.mjs";
import { createHmac } from "node:crypto";

const SLUG = process.argv[2];
const EMAIL = process.argv[3];
const PW = process.argv[4];
const SECRET = process.argv[5];

function b32(input) {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0; const out = [];
  for (const c of input.replace(/[^A-Za-z2-7]/g, "").toUpperCase()) {
    const i = a.indexOf(c); if (i === -1) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", b32(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const code = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(code % 1e6).padStart(6, "0");
}

const { browser, page } = await launch();
try {
  await page.goto(`${BASE}/login?tenant=${SLUG}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.locator('input[name="email"], input#email').first().fill(EMAIL);
  await page.locator('input[name="password"], input#password').first().fill(PW);
  const tf = page.locator('input[name="totpCode"], input#totpCode');
  if (await tf.count()) await tf.first().fill(totp(SECRET));
  const sf = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await sf.count()) await sf.first().fill(SLUG);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(6000);
  if (page.url().includes("/login")) {
    const tf2 = page.locator('input[name="totpCode"], input#totpCode');
    if (await tf2.count()) {
      await tf2.first().fill(totp(SECRET));
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(7000);
    }
  }
  console.log("LANDED:", page.url());
  if (page.url().includes("/login")) {
    console.log("BODY:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 500));
    throw new Error("could not sign in as the fresh owner");
  }
  await page.screenshot({ path: `${OUT}/fresh-00-landed.png`, fullPage: true });

  const nav = (await page.locator("nav").allInnerTexts()).join(" | ").replace(/\s+/g, " ");
  console.log("SIDEBAR:", nav.slice(0, 1500));
  // Brand shown in the shell — the G-14 env-var bug
  const shellText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  console.log("SHELL HEAD:", shellText.slice(0, 400));

  const ALL = {
    a: [
      ["/app/dashboard", "fresh-01-dashboard"],
      ["/app/settings", "fresh-02-settings"],
      ["/app/users", "fresh-03-users"],
      ["/app/tables", "fresh-04-tables"],
    ],
    b: [
      ["/app/stations", "fresh-05-stations"],
      ["/app/terminals", "fresh-06-terminals"],
      ["/app/menu/items", "fresh-07-menu"],
      ["/app/pos", "fresh-08-pos"],
    ],
    c: [
      ["/app/inventory/setup", "fresh-09-inventory-setup"],
      ["/app/hr/settings", "fresh-10-hr-settings"],
      ["/app/finance/periods", "fresh-11-periods"],
      ["/app/kitchen", "fresh-12-kitchen"],
    ],
  };
  for (const [route, name] of ALL[process.argv[6] ?? "a"]) {
    const r = await visit(page, route, name, { chars: 900 });
    if (/Sign in to RestaurantOS/.test(r.text)) {
      console.log("  !! SESSION DIED at", route);
      break;
    }
    await page.waitForTimeout(2500);
  }
} catch (e) {
  console.error("FAILED:", e.message);
  await page.screenshot({ path: `${OUT}/fresh-FAIL.png`, fullPage: true });
} finally {
  await browser.close();
}
