/*
 * RECHECK B — "Business details" on the brand-new tenant, as its own OWNER, in the browser.
 * The first audit says PUT /branches/{id} answers 409 for any address and silently drops the phone
 * that travelled with it. Re-drive it: type both, save, watch the network, reload, read back.
 * Then try phone ALONE (their isolation says that one succeeds) and read back again.
 */
import { launch, loginAs, visit, OUT, BASE, totpNow } from "./rc-lib.mjs";

const OWNER = {
  slug: "",
  email: process.argv[2],
  password: process.argv[3],
  totp: process.argv[4],
};

const ADDRESS = "14 Jinnah Boulevard, F-7 Markaz, Islamabad";
const PHONE = "+92-51-2345678";

const { browser, page } = await launch();
const net = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!u.includes("/api/v1/")) return;
  const rec = { m: r.request().method(), s: r.status(), u: u.split("/api/v1")[1] };
  if (r.request().method() !== "GET") {
    rec.req = r.request().postData()?.slice(0, 300);
    try { rec.res = (await r.text()).slice(0, 300); } catch { /* consumed */ }
  }
  net.push(rec);
});

try {
  await loginAs(page, OWNER, "fresh-owner");

  const s = await visit(page, "/app/settings", "B1-settings", { chars: 2500 });
  console.log("\n=== FIELDS ON THE SETTINGS PAGE ===");
  const fields = await page.locator("input, select, textarea").evaluateAll((els) =>
    els.map((e) => ({ id: e.id, name: e.name, type: e.type, disabled: e.disabled, readOnly: e.readOnly, value: e.value })),
  );
  console.log(JSON.stringify(fields, null, 1));
  const tabs = await page.locator('[role="tab"], nav a').allInnerTexts();
  console.log("TABS/NAV:", JSON.stringify(tabs.slice(0, 40)));

  // ── fill address + phone together, exactly as an owner would ────────────────────────
  net.length = 0;
  const addr = page.locator("#address, input[name=address]").first();
  const phone = page.locator("#phone, input[name=phone]").first();
  console.log("address field count:", await page.locator("#address, input[name=address]").count());
  await addr.fill(ADDRESS);
  await phone.fill(PHONE);
  await page.screenshot({ path: `${OUT}/B2-filled.png`, fullPage: true });
  await page.getByRole("button", { name: /save changes|save/i }).first().click();
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${OUT}/B3-after-save.png`, fullPage: true });
  console.log("\n=== NETWORK ON SAVE (address+phone) ===");
  console.log(JSON.stringify(net.filter((x) => x.m !== "GET"), null, 1));
  const afterSave = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  console.log("TOASTS/ALERTS:", (await page.locator('[role="alert"], [data-sonner-toast]').allInnerTexts()).join(" | "));
  console.log("BODY after save:", afterSave.slice(0, 900));

  // ── reload and read back ────────────────────────────────────────────────────────────
  await page.goto(`${BASE}/app/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/B4-readback.png`, fullPage: true });
  const rbAddr = await page.locator("#address, input[name=address]").first().inputValue();
  const rbPhone = await page.locator("#phone, input[name=phone]").first().inputValue();
  console.log(`READBACK address="${rbAddr}"  phone="${rbPhone}"`);

  // ── now phone ALONE ────────────────────────────────────────────────────────────────
  net.length = 0;
  await page.locator("#phone, input[name=phone]").first().fill(PHONE);
  await page.getByRole("button", { name: /save changes|save/i }).first().click();
  await page.waitForTimeout(6000);
  console.log("\n=== NETWORK ON SAVE (phone only) ===");
  console.log(JSON.stringify(net.filter((x) => x.m !== "GET"), null, 1));
  await page.goto(`${BASE}/app/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const rb2Phone = await page.locator("#phone, input[name=phone]").first().inputValue();
  const rb2Addr = await page.locator("#address, input[name=address]").first().inputValue();
  console.log(`READBACK2 address="${rb2Addr}"  phone="${rb2Phone}"`);
  await page.screenshot({ path: `${OUT}/B5-phone-only-readback.png`, fullPage: true });

  // ── is NTN/STRN enterable anywhere on this screen? ──────────────────────────────────
  const all = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  console.log("\nNTN/STRN CONTEXT:", (all.match(/.{0,220}(NTN|STRN|tax registration).{0,260}/i) ?? ["<not mentioned>"])[0]);
  const taxInputs = await page.locator('input[id*=ntn i], input[id*=strn i], input[name*=ntn i], input[name*=strn i]').count();
  console.log("EDITABLE NTN/STRN INPUTS:", taxInputs);

  // ── the other settings surfaces the sidebar offers ─────────────────────────────────
  await visit(page, "/settings/appearance", "B6-appearance", { chars: 1200 });
  const appFields = await page.locator("input, select, textarea").evaluateAll((els) =>
    els.map((e) => ({ id: e.id, name: e.name, type: e.type, value: (e.value || "").slice(0, 40) })),
  );
  console.log("APPEARANCE FIELDS:", JSON.stringify(appFields));
} catch (e) {
  console.error("FAILED:", e.message);
  await page.screenshot({ path: `${OUT}/B-FAIL.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
