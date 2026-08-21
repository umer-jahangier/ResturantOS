/*
 * The money test: create a brand-new restaurant from the browser as SuperAdmin, then be its
 * owner on day one. Everything a real operator would have to do to open the doors.
 */
import { launch, login, visit, OUT, BASE } from "./onboarding-lib.mjs";
import { createHmac } from "node:crypto";

const STAMP = Date.now().toString().slice(-6);
const BRAND = `Diag Bistro ${STAMP}`;
const EMAIL = `owner@diag-bistro-${STAMP}.local`;

function b32(input) {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0; const out = [];
  for (const c of input.replace(/=+$/, "").toUpperCase()) {
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

const { browser, ctx, page } = await launch();
try {
  await login(page, "superadmin");
  await page.goto(`${BASE}/platform/tenants`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: /create tenant/i }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/nt-00-dialog-open.png`, fullPage: true });
  console.log("DIALOGS:", await page.locator('[role="dialog"]').count());
  await page.locator('#brand-name').first().fill(BRAND);
  await page.locator('#admin-email').first().fill(EMAIL);
  await page.locator('#tier').first().selectOption("GROWTH");
  await page.screenshot({ path: `${OUT}/nt-01-create-dialog-filled.png`, fullPage: true });
  const dlg = page.locator('[role="dialog"]').last();
  await dlg.getByRole("button", { name: /create tenant/i }).click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/nt-02-after-create.png`, fullPage: true });
  const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  console.log("AFTER CREATE:", after.slice(0, 1200));

  // Does the UI hand back the one-time password? (Redis TTL 1h; if it is not shown, it is lost.)
  const pwMatch = after.match(/(?:temporary|one-time|initial)[^A-Za-z0-9]{0,20}password[^A-Za-z0-9]{0,10}([^\s]{8,40})/i);
  console.log("TEMP PASSWORD IN UI:", pwMatch ? pwMatch[1] : "NOT SHOWN ANYWHERE");
  // grab any monospace / code element
  const codeEls = await page.locator("code, pre, [data-testid*=password], [data-testid*=temp]").allInnerTexts();
  console.log("CODE-ish ELEMENTS:", JSON.stringify(codeEls.slice(0, 10)));
} catch (e) {
  console.error("PHASE-1 FAILED:", e.message);
  await page.screenshot({ path: `${OUT}/nt-FAIL-create.png`, fullPage: true });
} finally {
  await browser.close();
}
console.log("BRAND:", BRAND, "EMAIL:", EMAIL);
