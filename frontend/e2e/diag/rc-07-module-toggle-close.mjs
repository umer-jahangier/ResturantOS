/*
 * RECHECK E2 — the FEATURE_HR row did not change after "Disable" was clicked. Is the toggle
 * inert, or did the click miss? Watch the network, the toast, and the row, closely.
 * argv: <brandName>
 */
import { launch, login, OUT, BASE } from "./rc-lib.mjs";

const BRAND = process.argv[2];
const { browser, page } = await launch();
const net = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!u.includes("/api/v1/")) return;
  if (r.request().method() === "GET") { net.push({ m: "GET", s: r.status(), u: u.split("/api/v1")[1] }); return; }
  let body = "";
  try { body = (await r.text()).slice(0, 400); } catch { /* consumed */ }
  net.push({ m: r.request().method(), s: r.status(), u: u.split("/api/v1")[1], req: r.request().postData()?.slice(0, 200), res: body });
});

try {
  await login(page, "superadmin");
  await page.goto(`${BASE}/platform/tenants`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  await page.getByText(BRAND, { exact: false }).first().click();
  await page.waitForTimeout(5000);
  console.log("URL:", page.url());

  const row = page.locator("tr", { hasText: "FEATURE_HR" }).first();
  console.log("ROW BEFORE:", (await row.innerText()).replace(/\s+/g, " "));
  const btns = await row.locator("button").evaluateAll((els) => els.map((e) => ({ text: e.innerText.trim(), disabled: e.disabled, aria: e.getAttribute("aria-label") })));
  console.log("BUTTONS IN ROW:", JSON.stringify(btns));

  net.length = 0;
  await row.locator("button").last().click();
  await page.waitForTimeout(3000);
  // any confirmation dialog?
  const dlg = page.locator('[role="dialog"], [role="alertdialog"]');
  console.log("DIALOG AFTER CLICK:", await dlg.count());
  if (await dlg.count()) {
    console.log("DIALOG TEXT:", (await dlg.last().innerText()).replace(/\s+/g, " ").slice(0, 600));
    console.log("DIALOG BOX:", JSON.stringify(await dlg.last().boundingBox()));
    await page.screenshot({ path: `${OUT}/F1-confirm-dialog.png`, fullPage: true });
    const typeBox = dlg.last().locator("input").first();
    if (await typeBox.count()) { await typeBox.fill(BRAND); await page.waitForTimeout(800); }
    const confirm = dlg.last().locator('[data-testid="confirm-destructive-submit"]');
    if (await confirm.count()) { await confirm.first().click(); await page.waitForTimeout(6000); }
  }
  await page.waitForTimeout(4000);
  console.log("NETWORK ON TOGGLE:", JSON.stringify(net.filter((x) => x.m !== "GET"), null, 1));
  console.log("TOASTS:", (await page.locator('[data-sonner-toast], [role="alert"]').allInnerTexts()).join(" | ").slice(0, 500));
  console.log("ROW AFTER:", (await page.locator("tr", { hasText: "FEATURE_HR" }).first().innerText()).replace(/\s+/g, " "));
  await page.screenshot({ path: `${OUT}/F2-after-toggle.png`, fullPage: true });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  console.log("ROW AFTER RELOAD:", (await page.locator("tr", { hasText: "FEATURE_HR" }).first().innerText()).replace(/\s+/g, " "));
  await page.screenshot({ path: `${OUT}/F3-after-reload.png`, fullPage: true });
} catch (e) {
  console.error("FAILED:", e.message);
  await page.screenshot({ path: `${OUT}/F-FAIL.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
