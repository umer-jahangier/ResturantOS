/*
 * Stage 2 — the heart of the diagnosis.
 *
 * For each form dialog across modules: open it, measure the surface, then fill it BADLY on
 * purpose and record WHEN validation fires — as the user types/blurs, or only on submit.
 *
 * The distinction that matters to the product owner is:
 *   errorsAfterBlur  > 0  → the UI validates as you go
 *   errorsAfterBlur == 0 and errorsAfterSubmit > 0 → the UI validates only on submit
 *   both == 0, and the server 4xx's → there is no UI validation at all
 */
import { chromium } from "@playwright/test";
import { login, settle, shot, saveJson, BASE } from "./uiq-lib.mjs";

const FORMS = [
  { mod: "Tables", route: "/app/tables", trigger: "Add table" },
  { mod: "Menu", route: "/app/menu/items", trigger: "Add item" },
  { mod: "Menu", route: "/app/menu/items", trigger: "Add category", key: "menu-category" },
  { mod: "Inventory", route: "/app/inventory/ingredients", trigger: "Add ingredient" },
  { mod: "Inventory", route: "/app/inventory/setup", trigger: "Add unit" },
  { mod: "Inventory", route: "/app/inventory/stock", trigger: "Receipt" },
  { mod: "Inventory", route: "/app/inventory/stock", trigger: "Count", key: "stock-count" },
  { mod: "Purchasing", route: "/app/purchasing/vendors", trigger: "Add vendor" },
  { mod: "Purchasing", route: "/app/purchasing/purchase-orders", trigger: "New Purchase Order" },
  { mod: "Finance", route: "/app/finance/expenses", trigger: "New expense" },
  { mod: "HR", route: "/app/hr/employees", trigger: "New employee" },
  { mod: "Users", route: "/app/users", trigger: "Add user" },
  { mod: "Stations", route: "/app/stations", trigger: "Add station" },
  { mod: "Terminals", route: "/app/terminals", trigger: "Add terminal" },
];

/** Everything measurable about the dialog currently on screen. */
const DIALOG_PROBE = () => {
  const d = document.querySelector('[role="dialog"]:not([data-state="closed"])');
  if (!d) return { open: false };
  const r = d.getBoundingClientRect();
  const cs = getComputedStyle(d);
  const px = (v) => Math.round(parseFloat(v) || 0);
  const fields = [...d.querySelectorAll("input,select,textarea")].filter((el) => {
    const b = el.getBoundingClientRect();
    return el.type !== "hidden" && b.width > 0 && b.height > 0;
  });
  const labelFor = (el) => {
    if (el.getAttribute("aria-label")) return el.getAttribute("aria-label");
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l.textContent.trim();
    }
    const w = el.closest("label");
    return w ? w.textContent.trim() : null;
  };
  // A visible, non-empty error message inside the dialog.
  const errorNodes = [...d.querySelectorAll('[role="alert"],[data-slot="form-message"],[id$="-error"],.text-destructive,[aria-live]')]
    .filter((e) => {
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && (e.textContent || "").trim().length > 1;
    });
  return {
    open: true,
    w: Math.round(r.width),
    h: Math.round(r.height),
    radius: cs.borderRadius,
    bg: cs.backgroundColor,
    padding: cs.padding,
    ariaModal: d.getAttribute("aria-modal"),
    ariaLabelledby: d.getAttribute("aria-labelledby"),
    title: (d.querySelector('[data-slot="dialog-title"],h2,h3')?.textContent || "").trim(),
    hasDescription: !!d.querySelector('[data-slot="dialog-description"]'),
    hasFooter: !!d.querySelector('[data-slot="dialog-footer"]'),
    hasCloseX: !!d.querySelector('[data-slot="dialog-close"]'),
    scrollable: d.scrollHeight > d.clientHeight + 2,
    offscreenBottom: Math.max(0, Math.round(r.bottom - window.innerHeight)),
    fields: fields.map((el) => ({
      name: el.name || el.id || "",
      tag: el.tagName.toLowerCase(),
      type: el.type || "",
      required: el.required || el.getAttribute("aria-required") === "true",
      label: labelFor(el),
      // "required indicator" = an asterisk or the word required in the label
      labelMarksRequired: /\*|required/i.test(labelFor(el) || ""),
      h: Math.round(el.getBoundingClientRect().height),
      ariaInvalid: el.getAttribute("aria-invalid"),
      describedBy: el.getAttribute("aria-describedby"),
    })),
    rawSelects: fields.filter((e) => e.tagName === "SELECT").length,
    errors: errorNodes.map((e) => e.textContent.trim().replace(/\s+/g, " ").slice(0, 140)),
    buttons: [...d.querySelectorAll("button")].map((b) => ({
      t: (b.textContent || "").trim().slice(0, 30),
      disabled: b.disabled,
      type: b.type,
      h: Math.round(b.getBoundingClientRect().height),
    })),
    focusInside: !!(document.activeElement && d.contains(document.activeElement)),
    focusEl: document.activeElement ? `${document.activeElement.tagName.toLowerCase()}${document.activeElement.name ? "#" + document.activeElement.name : ""}` : null,
  };
};

const BAD = (f) => {
  if (f.type === "number") return "-99999";
  if (f.type === "email") return "not-an-email";
  if (f.type === "date") return "1901-01-01";
  if (f.type === "tel") return "abc";
  if (f.type === "password") return "a";
  return "!!";               // 2 chars of punctuation: fails any sane min-length/format rule
};

async function openDialog(page, trigger) {
  const btn = page.locator(`button:has-text("${trigger}"), a:has-text("${trigger}")`).first();
  if (!(await btn.count())) return { ok: false, why: `trigger "${trigger}" not found` };
  await btn.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1400);
  const open = await page.locator('[role="dialog"]').count();
  return { ok: open > 0, why: open > 0 ? null : "no [role=dialog] appeared after click" };
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
if (!(await login(page, "owner")).ok) { console.log("LOGIN FAILED"); process.exit(1); }
console.log("signed in as owner\n");

const results = [];
for (const F of FORMS) {
  const key = F.key || `${F.mod}-${F.trigger}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const rec = { ...F, key };
  const st = await settle(page, F.route, "owner");
  if (!st.clean) { rec.error = `route not clean: ${JSON.stringify(st)}`; results.push(rec); console.log(`SKIP ${key}: ${rec.error}`); continue; }

  const opened = await openDialog(page, F.trigger);
  if (!opened.ok) { rec.error = opened.why; results.push(rec); console.log(`SKIP ${key}: ${opened.why}`); continue; }

  rec.onOpen = await page.evaluate(DIALOG_PROBE);
  await shot(page, `${key}-1-open`, "forms");

  // ---- pass A: submit completely empty ----
  const submitSel = '[role="dialog"] button[type="submit"], [role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("Create"), [role="dialog"] button:has-text("Add")';
  const sub = page.locator(submitSel).last();
  if (await sub.count()) {
    await sub.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1600);
    rec.afterEmptySubmit = await page.evaluate(DIALOG_PROBE);
    await shot(page, `${key}-2-empty-submit`, "forms");
  }

  // ---- pass B: fill everything badly, blurring each field, and probe BEFORE submitting ----
  const fields = (rec.afterEmptySubmit?.open === false ? [] : rec.onOpen.fields) || [];
  for (const f of fields) {
    if (!f.name) continue;
    const loc = page.locator(`[role="dialog"] [name="${f.name}"]`).first();
    if (!(await loc.count())) continue;
    try {
      if (f.tag === "select") continue;                     // leaving a select unset IS the bad value
      await loc.fill(BAD(f), { timeout: 3000 });
      await loc.blur({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(220);
    } catch { /* readonly / masked */ }
  }
  await page.waitForTimeout(900);
  rec.afterBadFillBlur = await page.evaluate(DIALOG_PROBE);
  await shot(page, `${key}-3-bad-filled-before-submit`, "forms");

  // ---- now submit the bad values ----
  if (await sub.count()) {
    await sub.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(2200);
    rec.afterBadSubmit = await page.evaluate(DIALOG_PROBE);
    await shot(page, `${key}-4-bad-submit`, "forms");
  }

  // ---- keyboard: does Escape close it? ----
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  rec.escapeCloses = (await page.locator('[role="dialog"]').count()) === 0;

  const o = rec.onOpen;
  // "closed" means the dialog is gone — for a BAD submit that means the app ACCEPTED garbage.
  const n = (p) => (p == null ? "-" : p.open === false ? "CLOSED" : String(p.errors.length));
  console.log(
    `${key.padEnd(26)} ${String(o.w).padStart(4)}x${String(o.h).padStart(3)} ` +
    `flds=${String(o.fields.length).padStart(2)} reqMark=${o.fields.filter((f) => f.labelMarksRequired).length} ` +
    `unlbl=${o.fields.filter((f) => !f.label).length} rawSel=${o.rawSelects} ` +
    `| errs: open=${n(o)} emptySubmit=${n(rec.afterEmptySubmit)} badBlur=${n(rec.afterBadFillBlur)} badSubmit=${n(rec.afterBadSubmit)} ` +
    `| ariaModal=${o.ariaModal} esc=${rec.escapeCloses}`
  );
  results.push(rec);
}

saveJson("forms.json", results);
await browser.close();
