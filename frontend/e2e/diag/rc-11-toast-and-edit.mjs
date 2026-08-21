/*
 * RECHECK H — two loose ends:
 *  (1) WHAT does the owner actually see when the address save 409s? (toasts vanish; catch it fast)
 *  (2) What can a SuperAdmin EDIT about a tenant — is the restaurant's own brand name editable
 *      by anyone, and by whom?
 * argv: <ownerEmail> <ownerPassword> <ownerTotp> <brandName>
 */
import { launch, login, loginAs, OUT, BASE } from "./rc-lib.mjs";

const OWNER = { slug: "", email: process.argv[2], password: process.argv[3], totp: process.argv[4] };
const BRAND = process.argv[5];

const { browser, page } = await launch();
try {
  await loginAs(page, OWNER, "owner");
  await page.goto(`${BASE}/app/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await page.locator("input[name=address]").first().fill("14 Jinnah Boulevard, F-7 Markaz, Islamabad");
  await page.getByRole("button", { name: /save changes/i }).first().click();
  for (const ms of [900, 1800, 3000]) {
    await page.waitForTimeout(ms === 900 ? 900 : 900);
    const toasts = await page.locator('[data-sonner-toast], li[data-sonner-toast], [role="status"], [role="alert"]').allInnerTexts();
    console.log(`t=${ms}ms TOASTS:`, JSON.stringify(toasts.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean)));
    if (ms === 1800) await page.screenshot({ path: `${OUT}/J1-error-toast.png`, fullPage: false });
  }

  // (2) SuperAdmin edit dialog
  const c = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const sp = await c.newPage();
  await login(sp, "superadmin");
  await sp.goto(`${BASE}/platform/tenants`, { waitUntil: "domcontentloaded" });
  await sp.waitForTimeout(4500);
  await sp.getByText(BRAND, { exact: false }).first().click();
  await sp.waitForTimeout(5000);
  await sp.getByRole("button", { name: /^edit$/i }).first().click();
  await sp.waitForTimeout(3000);
  const d = sp.locator('[role="dialog"]').last();
  console.log("\nEDIT DIALOG BOX:", JSON.stringify(await d.boundingBox()));
  console.log("EDIT DIALOG TEXT:", (await d.innerText()).replace(/\s+/g, " ").slice(0, 900));
  console.log("EDIT DIALOG FIELDS:", JSON.stringify(await d.locator("input, select, textarea").evaluateAll((els) =>
    els.map((e) => ({ id: e.id, name: e.name, type: e.type, value: (e.value || "").slice(0, 40) })))));
  await sp.screenshot({ path: `${OUT}/J2-tenant-edit-dialog.png`, fullPage: true });
} catch (e) {
  console.error("FAILED:", e.message);
  await page.screenshot({ path: `${OUT}/J-FAIL.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
