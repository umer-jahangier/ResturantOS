import { P, login, newPage, shot, visit } from "./hrrt-lib.mjs";

const { browser, page } = await newPage();
const net = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!/\/api\/v1\/hr\//.test(u)) return;
  let t = "";
  if (r.status() >= 400) { try { t = (await r.text()).slice(0, 200); } catch {} }
  if (r.request().method() !== "GET" || r.status() >= 400)
    net.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")}${t ? " :: " + t : ""}`);
});
const toasts = async () =>
  (await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])).map((s) => s.replace(/\n/g, " | "));
const stamp = String(Date.now()).slice(-5);

try {
  await login(page, P.owner);

  // ---------- REACTIVATION: can a former employee be brought back? ----------
  await visit(page, "/app/hr/employees", { persona: P.owner });
  const cb = page.locator('input[type="checkbox"]').first();
  if (await cb.count()) { await cb.check().catch(() => {}); await page.waitForTimeout(3000); }
  const formerRow = page.locator("main tr", { hasText: "Former" }).first();
  if (await formerRow.count()) {
    console.log("[reactivate] former row:", (await formerRow.innerText()).replace(/\n/g, " | "));
    console.log("[reactivate] row buttons:", JSON.stringify(await formerRow.locator("button").allInnerTexts()));
    await formerRow.getByRole("button", { name: /^Edit$/i }).click();
    await page.waitForTimeout(1800);
    const d = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();
    console.log("[reactivate] edit dialog text:", (await d.innerText()).replace(/\n{2,}/g, " | ").slice(0, 700));
    console.log("[reactivate] dialog controls:", JSON.stringify(await d.locator("button, input[type=checkbox]").allInnerTexts()));
    await shot(page, "ds-00-former-edit-dialog");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  } else {
    console.log("[reactivate] no Former row found");
  }

  // ---------- DEPARTMENTS ----------
  await visit(page, "/app/hr/settings/departments", { persona: P.owner });
  await page.getByRole("button", { name: /New department/i }).click();
  await page.waitForTimeout(1600);
  const dd = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();
  console.log("[dept] dialog box:", JSON.stringify(await dd.boundingBox()));
  const dfields = await dd.locator("input, select").evaluateAll((e) => e.map((x) => x.name || x.id));
  console.log("[dept] fields:", JSON.stringify(dfields));
  const dname = `RTDept ${stamp}`;
  await dd.locator('input[name="name"]').first().fill(dname);
  const codeF = dd.locator('input[name="code"]');
  if (await codeF.count()) await codeF.first().fill(`RD${stamp}`);
  await dd.getByRole("button", { name: /Add|Save|Create/i }).first().click();
  await page.waitForTimeout(3500);
  console.log("[dept] toasts:", JSON.stringify(await toasts()));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  console.log("[dept] after reload present:", (await page.locator("main").innerText()).includes(dname) ? "YES" : "NO");
  await shot(page, "ds-01-dept-created");

  // Does the new department appear on the EMPLOYEE form? (the screen says it is chosen there)
  await visit(page, "/app/hr/employees", { persona: P.owner });
  await page.getByRole("button", { name: /New employee/i }).click();
  await page.waitForTimeout(1800);
  const ed = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();
  const deptOpts = await ed.locator('select[name="departmentId"] option').allInnerTexts();
  console.log("[dept] options on the employee form:", JSON.stringify(deptOpts));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // Retire it, then try to bring it back.
  await visit(page, "/app/hr/settings/departments", { persona: P.owner });
  const drow = page.locator("main tr", { hasText: dname }).first();
  await drow.getByRole("button", { name: /Retire/i }).click();
  await page.waitForTimeout(3500);
  console.log("[dept] toasts after retire:", JSON.stringify(await toasts()));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  console.log("[dept] in default list after retire:", (await page.locator("main").innerText()).includes(dname) ? "YES" : "no");
  const showRetired = page.locator('input[type="checkbox"]').first();
  if (await showRetired.count()) {
    await showRetired.check().catch(() => {});
    await page.waitForTimeout(3000);
    const rrow = page.locator("main tr", { hasText: dname }).first();
    console.log("[dept] retired row:", (await rrow.innerText().catch(() => "(gone)")).replace(/\n/g, " | "));
    console.log("[dept] retired row buttons:", JSON.stringify(await rrow.locator("button").allInnerTexts().catch(() => [])));
  }
  await shot(page, "ds-02-dept-retired");

  // ---------- SCHEDULE / ROSTER ----------
  await visit(page, "/app/hr/schedule", { persona: P.owner });
  await shot(page, "ds-03-schedule");
  await page.getByRole("button", { name: /Add shift/i }).click();
  await page.waitForTimeout(1800);
  const sd = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();
  const opened = (await sd.count()) > 0 && (await sd.isVisible().catch(() => false));
  console.log("[shift] dialog opened:", opened, "box:", JSON.stringify(await sd.boundingBox().catch(() => null)));
  if (opened) {
    console.log("[shift] dialog text:", (await sd.innerText()).replace(/\n{2,}/g, " | ").slice(0, 500));
    const sf = await sd.locator("input, select").evaluateAll((e) => e.map((x) => ({ n: x.name || x.id, t: x.type })));
    console.log("[shift] fields:", JSON.stringify(sf));
    await shot(page, "ds-04-shift-dialog");
    const nm = sd.locator('input[name="name"]');
    if (await nm.count()) await nm.first().fill(`RT Shift ${stamp}`);
    const times = sd.locator('input[type="time"]');
    if (await times.count() >= 2) { await times.nth(0).fill("16:00"); await times.nth(1).fill("23:00"); }
    await sd.getByRole("button", { name: /Add|Save|Create/i }).first().click();
    await page.waitForTimeout(3500);
    console.log("[shift] toasts:", JSON.stringify(await toasts()));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    console.log("[shift] after reload, grid contains 16:00:", (await page.locator("main").innerText()).includes("16:00") ? "YES" : "NO");
    await shot(page, "ds-05-shift-created");
  }

  // Is there ANY way to assign without drag-and-drop? And is there a published/notify step?
  const smain = await page.locator("main").innerText();
  console.log("\n[schedule] full grid text:\n" + smain.replace(/\n{3,}/g, "\n"));
  console.log("[schedule] buttons:", JSON.stringify((await page.locator("main button").allInnerTexts()).map((s) => s.trim())));
} catch (e) {
  console.log("FATAL", String(e).slice(0, 600));
  await shot(page, "ds-FATAL");
} finally {
  console.log("\n[network]");
  for (const l of net) console.log("   " + l);
  await browser.close();
}
