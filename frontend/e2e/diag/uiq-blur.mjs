/*
 * THE DECISIVE TEST for "is validation done at the UI as the user types".
 *
 * uiq-forms.mjs submitted empty FIRST, which puts react-hook-form into its post-submit
 * `reValidateMode: onChange` state — so any error seen afterwards proves nothing about
 * typing-time validation. This opens a FRESH dialog and never submits: type a bad value,
 * blur, wait, and look. Anything found here is genuine as-you-type validation.
 */
import { chromium } from "@playwright/test";
import { login, settle, shot, saveJson } from "./uiq-lib.mjs";

const CASES = [
  { key: "tables",     route: "/app/tables",                 trigger: "Add table",      field: "capacity",          bad: "-5",           why: "negative seat count" },
  { key: "menu-item",  route: "/app/menu/items",             trigger: "Add item",       field: "priceRupees",       bad: "-100",         why: "negative menu price" },
  { key: "ingredient", route: "/app/inventory/ingredients",  trigger: "Add ingredient", field: "name",              bad: "!",            why: "1-char punctuation name" },
  { key: "ingr-yield", route: "/app/inventory/ingredients",  trigger: "Add ingredient", field: "defaultYieldPct",   bad: "900",          why: "900% yield" },
  { key: "unit-factor",route: "/app/inventory/setup",        trigger: "Add unit",       field: "toBaseFactor",      bad: "-3",           why: "negative conversion factor" },
  { key: "receipt-qty",route: "/app/inventory/stock",        trigger: "Receipt",        field: "lines.0.qty",       bad: "-50",          why: "negative received qty" },
  { key: "vendor",     route: "/app/purchasing/vendors",     trigger: "Add vendor",     field: "email",             bad: "not-an-email", why: "malformed email" },
  { key: "po-qty",     route: "/app/purchasing/purchase-orders", trigger: "New Purchase Order", field: "lines.0.qty", bad: "-10",        why: "negative PO quantity" },
  { key: "expense",    route: "/app/finance/expenses",       trigger: "New expense",    field: "amountRupees",      bad: "-9999",        why: "negative expense amount" },
  { key: "employee",   route: "/app/hr/employees",           trigger: "New employee",   field: "cnic",              bad: "abc",          why: "non-numeric CNIC" },
  { key: "emp-salary", route: "/app/hr/employees",           trigger: "New employee",   field: "basicSalaryRupees", bad: "-500",         why: "negative salary" },
  { key: "user",       route: "/app/users",                  trigger: "Add user",       field: "email",             bad: "zzz",          why: "malformed email" },
  { key: "terminal",   route: "/app/terminals",              trigger: "Add terminal",   field: "terminal-code",     bad: "!!",           why: "punctuation terminal code" },
  { key: "station",    route: "/app/stations",               trigger: "Add station",    field: "code",              bad: "!!",           why: "punctuation station code" },
];

const ERRS = () => {
  const d = document.querySelector('[role="dialog"]');
  if (!d) return { open: false };
  const nodes = [...d.querySelectorAll('[role="alert"],[data-slot="form-message"],[id$="-error"],.text-destructive')]
    .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && (e.textContent || "").trim().length > 1; });
  const invalid = [...d.querySelectorAll('[aria-invalid="true"]')].length;
  return { open: true, n: nodes.length, texts: nodes.map((e) => e.textContent.trim().replace(/\s+/g, " ").slice(0, 120)), ariaInvalid: invalid };
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
if (!(await login(page, "owner")).ok) { console.log("LOGIN FAILED"); process.exit(1); }
console.log("signed in as owner — NO submit is pressed in this run\n");

const out = [];
for (const C of CASES) {
  const st = await settle(page, C.route, "owner");
  if (!st.clean) { console.log(`SKIP ${C.key}: route not clean ${JSON.stringify(st).slice(0,120)}`); out.push({ ...C, skipped: st }); continue; }
  const btn = page.locator(`button:has-text("${C.trigger}")`).first();
  if (!(await btn.count())) { console.log(`SKIP ${C.key}: no trigger`); continue; }
  await btn.click().catch(() => {});
  await page.waitForTimeout(1300);

  const loc = page.locator(`[role="dialog"] [name="${C.field}"]`).first();
  if (!(await loc.count())) { console.log(`SKIP ${C.key}: field ${C.field} not in dialog`); out.push({ ...C, skipped: "field absent" }); await page.keyboard.press("Escape"); continue; }

  if (await loc.isDisabled().catch(() => true)) {
    console.log(`SKIP ${C.key}: field ${C.field} is disabled on open`);
    out.push({ ...C, skipped: "field disabled" });
    await page.keyboard.press("Escape"); await page.waitForTimeout(400); continue;
  }
  // type character by character, like a person
  await loc.click();
  await loc.pressSequentially(C.bad, { delay: 120 });
  await page.waitForTimeout(900);
  const whileTyping = await page.evaluate(ERRS);

  await loc.blur();
  await page.waitForTimeout(1200);
  const afterBlur = await page.evaluate(ERRS);
  await shot(page, `blur-${C.key}`, "blur");

  const meta = await loc.evaluate((el) => ({ type: el.type, inputMode: el.inputMode || el.getAttribute("inputmode"), pattern: el.pattern || null, min: el.min || null, max: el.max || null, step: el.step || null, required: el.required, maxLength: el.maxLength }));
  const rec = { ...C, whileTyping, afterBlur, meta };
  out.push(rec);
  console.log(
    `${C.key.padEnd(12)} ${C.field.padEnd(11)} = "${C.bad}"  (${C.why})\n` +
    `             input: type=${meta.type} inputMode=${meta.inputMode||"-"} min=${meta.min||"-"} pattern=${meta.pattern||"-"} required=${meta.required}\n` +
    `             typing: ${whileTyping.n} err / aria-invalid=${whileTyping.ariaInvalid}` +
    `   |  after blur: ${afterBlur.n} err / aria-invalid=${afterBlur.ariaInvalid}` +
    (afterBlur.texts?.length ? `\n             text: ${JSON.stringify(afterBlur.texts)}` : "")
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
}
saveJson("blur.json", out);
await browser.close();
