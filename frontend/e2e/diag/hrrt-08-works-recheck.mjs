/* Re-drive the three WORKS verdicts: tax config, employee CRUD, departments. */
import { P, login, newPage, shot, visit } from "./hrrt-lib.mjs";

const { browser, page } = await newPage();
const net = [];
page.on("response", async (r) => {
  const u = r.url();
  if (!/\/api\/v1\/hr\//.test(u)) return;
  let t = "";
  if (r.status() >= 400) { try { t = (await r.text()).slice(0, 200); } catch {} }
  net.push(`${r.status()} ${r.request().method()} ${u.replace("http://localhost:8080", "")}${t ? " :: " + t : ""}`);
});
const toasts = async () =>
  (await page.locator("[data-sonner-toast]").allInnerTexts().catch(() => [])).map((s) => s.replace(/\n/g, " | "));
const stamp = String(Date.now()).slice(-6);

try {
  await login(page, P.owner);

  // ================= 1. TAX: does the saved FY2027 table load back? =================
  await visit(page, "/app/hr/settings/tax", { persona: P.owner });
  const fySel = page.locator("main select").first();
  console.log("[tax] fiscal-year options:", JSON.stringify(await fySel.locator("option").allInnerTexts()));
  console.log("[tax] selected on load:", await fySel.inputValue());
  const vals = await page.locator("main input").evaluateAll((els) =>
    els.map((e) => ({ name: e.name || e.getAttribute("aria-label") || e.placeholder || e.type, v: e.value, checked: e.checked })));
  console.log("[tax] input values on load:");
  for (const v of vals) console.log("      ", JSON.stringify(v));
  await shot(page, "wk-01-tax-loaded");
  console.log("[tax] main text tail:", (await page.locator("main").innerText()).slice(-700).replace(/\n{2,}/g, " | "));

  // Can it be edited and re-saved? Change EOBI employer 5 -> 6, save, reload, confirm.
  const btns = await page.locator("main button").allInnerTexts();
  console.log("[tax] buttons:", JSON.stringify(btns.map((b) => b.trim())));

  // ================= 2. EMPLOYEES: create, RELOAD, edit, deactivate =================
  await visit(page, "/app/hr/employees", { persona: P.owner });
  await page.getByRole("button", { name: /New employee/i }).click();
  await page.waitForTimeout(1600);
  const dlg = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();
  const box = await dlg.boundingBox();
  console.log("[emp] dialog box:", JSON.stringify(box));
  const fields = await dlg.locator("input, select, textarea").evaluateAll((els) =>
    els.map((e) => ({ tag: e.tagName, name: e.name, id: e.id, type: e.type, label: e.getAttribute("aria-label") || e.placeholder || "" })));
  console.log("[emp] dialog fields (" + fields.length + "):", JSON.stringify(fields));
  await shot(page, "wk-02-employee-dialog");

  const no = `RT${stamp}`;
  const fill = async (sel, v) => { const l = dlg.locator(sel); if (await l.count()) await l.first().fill(v); };
  await fill('input[name="employeeNo"], input#employeeNo', no);
  await fill('input[name="fullName"], input#fullName', `RedTeam ${stamp}`);
  await fill('input[name="joinDate"], input#joinDate, input[type="date"]', "2026-03-01");
  await fill('input[name="basicSalaryRupees"]', "45000");
  await fill('input[name="cnic"], input#cnic', "3520112345678");
  await fill('input[name="bankAccountNo"], input#bankAccountNo', "PK00TEST0000000000001");
  await shot(page, "wk-03-employee-filled");
  const submit = dlg.getByRole("button", { name: /Add employee|Save|Create/i }).first();
  await submit.click();
  await page.waitForTimeout(4000);
  console.log("[emp] toasts after add:", JSON.stringify(await toasts()));
  const errs = await dlg.locator('[role="alert"], .text-destructive, p.text-sm.text-destructive').allInnerTexts().catch(() => []);
  console.log("[emp] inline validation messages:", JSON.stringify(errs.filter(Boolean)));
  await shot(page, "wk-03b-after-submit");

  // HARD TEST: full page reload, is it still there?
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  const listed = (await page.locator("main").innerText()).includes(no);
  console.log(`[emp] after FULL RELOAD, ${no} present:`, listed ? "YES" : "NO");
  await shot(page, "wk-04-employee-after-reload");

  // EDIT
  const row = page.locator("main tr", { hasText: no }).first();
  if (await row.count()) {
    await row.getByRole("button", { name: /^Edit$/i }).click();
    await page.waitForTimeout(1800);
    const d2 = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();
    console.log("[emp] edit dialog box:", JSON.stringify(await d2.boundingBox()));
    const nameField = d2.locator('input[name="fullName"], input#fullName');
    if (await nameField.count()) {
      console.log("[emp] edit dialog prefilled name:", await nameField.first().inputValue());
      await nameField.first().fill(`RedTeam ${stamp} EDITED`);
    }
    await shot(page, "wk-05-employee-edit-dialog");
    await d2.getByRole("button", { name: /Save|Update|Add employee/i }).first().click();
    await page.waitForTimeout(4000);
    console.log("[emp] toasts after edit:", JSON.stringify(await toasts()));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4500);
    console.log("[emp] EDITED persisted after reload:",
      (await page.locator("main").innerText()).includes("EDITED") ? "YES" : "NO");
    await shot(page, "wk-06-employee-after-edit-reload");
  } else {
    console.log("[emp] row not found — cannot test Edit");
  }

  // DEACTIVATE
  const row2 = page.locator("main tr", { hasText: no }).first();
  if (await row2.count()) {
    await row2.getByRole("button", { name: /Deactivate/i }).click();
    await page.waitForTimeout(4000);
    console.log("[emp] toasts after deactivate:", JSON.stringify(await toasts()));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4500);
    const stillDefault = (await page.locator("main").innerText()).includes(no);
    console.log("[emp] after deactivate+reload, still in DEFAULT list:", stillDefault ? "YES (bug?)" : "no");
    const showFormer = page.getByLabel(/Show former staff/i).or(page.locator('input[type="checkbox"]').first());
    if (await showFormer.count()) {
      await showFormer.first().check().catch(() => {});
      await page.waitForTimeout(3000);
      const t = await page.locator("main").innerText();
      console.log("[emp] with 'Show former staff' on, present:", t.includes(no) ? "YES" : "NO");
      const m = t.match(new RegExp(`${no}[^\\n]*`));
      console.log("[emp] row text:", m ? m[0] : "(not found)");
      // Can it be reactivated?
      const r3 = page.locator("main tr", { hasText: no }).first();
      console.log("[emp] buttons on a former-staff row:", JSON.stringify(await r3.locator("button").allInnerTexts()));
    }
    await shot(page, "wk-07-employee-deactivated");
  }
} catch (e) {
  console.log("FATAL", String(e).slice(0, 600));
  await shot(page, "wk-FATAL");
} finally {
  console.log("\n[network]");
  for (const l of net) console.log("   " + l);
  await browser.close();
}
