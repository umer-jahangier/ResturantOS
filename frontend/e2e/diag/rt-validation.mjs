/*
 * RED TEAM #2 — attack the validation verdicts.
 *  a) Re-drive on-blur validation independently (their MISSING claim).
 *  b) Does it become live AFTER the first failed submit? (reValidateMode default = onChange)
 *     — a mitigating fact their report does not state.
 *  c) Is the submit button ever disabled / does it ever explain itself?
 *  d) Re-drive the raw Zod-blob toast.
 *  e) Toast accessibility: role, live region, dismissible, auto-hide.
 */
import { go, login, browser, save, shot, openDialog } from "./rt-lib.mjs";

const CASES = [
  { key: "menu-item", route: "/app/menu/items", trigger: "Add item", field: "priceRupees", bad: "-100", fix: "450" },
  { key: "vendor", route: "/app/purchasing/vendors", trigger: "Add vendor", field: "email", bad: "not-an-email", fix: "a@b.com" },
  { key: "expense", route: "/app/finance/expenses", trigger: "New expense", field: "amountRupees", bad: "-9999", fix: "120" },
  { key: "user", route: "/app/users", trigger: "Add user", field: "email", bad: "zzz", fix: "zzz@x.com" },
  // HR control — the module that DOES use useStandardForm
  { key: "employee", route: "/app/hr/employees", trigger: "New employee", field: "cnic", bad: "abc", fix: "1234567890123" },
];

const ERRSTATE = () => {
  const d = document.querySelector('[data-slot="dialog-content"], [role="dialog"]');
  if (!d) return { open: false };
  const msgs = [...d.querySelectorAll('[data-slot="form-message"],[role="alert"],.text-destructive')]
    .map((e) => (e.textContent || "").trim()).filter(Boolean);
  const submit = d.querySelector('button[type="submit"], [data-slot="form-submit"]')
    || [...d.querySelectorAll("button")].pop();
  return {
    open: true,
    n: [...new Set(msgs)].length,
    texts: [...new Set(msgs)],
    ariaInvalid: d.querySelectorAll('[aria-invalid="true"]').length,
    submitDisabled: submit ? submit.disabled : null,
    submitLabel: submit ? (submit.textContent || "").trim() : null,
    submitReason: d.querySelector('[data-slot="form-submit-reason"]')?.textContent?.trim() || null,
  };
};

const run = async () => {
  const { b, page } = await browser(1440, 900);
  const auth = await login(page, "owner");
  if (!auth.ok) { console.error("LOGIN FAILED", auth); await b.close(); process.exit(1); }

  const out = [];
  for (const c of CASES) {
    const rec = { ...c };
    const nav = await go(page, c.route, "owner");
    rec.nav = nav;
    if (!nav.ok) { out.push(rec); continue; }
    const o = await openDialog(page, c.trigger);
    if (!o.opened) { rec.opened = false; out.push(rec); continue; }
    rec.opened = true;
    rec.onOpen = await page.evaluate(ERRSTATE);

    const f = page.locator(`[data-slot="dialog-content"] [name="${c.field}"], [role="dialog"] [name="${c.field}"]`).first();
    if (!(await f.count())) { rec.fieldMissing = true; out.push(rec); continue; }

    // 1. type character by character, never submit
    await f.click();
    await page.keyboard.type(c.bad, { delay: 110 });
    await page.waitForTimeout(700);
    rec.whileTyping = await page.evaluate(ERRSTATE);

    // 2. blur
    await page.keyboard.press("Tab");
    await page.waitForTimeout(900);
    rec.afterBlur = await page.evaluate(ERRSTATE);
    await shot(page, `${c.key}-after-blur`, "validation");

    // 3. NOW press submit
    const submit = page.locator('[data-slot="dialog-content"] button[type="submit"], [role="dialog"] button[type="submit"]').first();
    if (await submit.count()) {
      rec.submitWasDisabled = await submit.isDisabled();
      if (rec.submitWasDisabled) {
        rec.blockedBeforeSubmit = await page.evaluate(ERRSTATE);
        out.push(rec);
        console.log(c.key, "| SUBMIT DISABLED, reason:", rec.blockedBeforeSubmit?.submitReason, "| blur errs:", rec.afterBlur?.n);
        continue;
      }
      await submit.click();
      await page.waitForTimeout(1800);
      rec.afterSubmit = await page.evaluate(ERRSTATE);
      rec.toastAfterSubmit = await page.evaluate(() => {
        const els = [...document.querySelectorAll('[data-sonner-toast],[role="status"],[role="alert"]')]
          .filter((e) => !e.closest('[data-slot="dialog-content"]'));
        return els.map((e) => ({
          text: (e.textContent || "").trim().slice(0, 400),
          role: e.getAttribute("role"),
          live: e.getAttribute("aria-live") || e.closest("[aria-live]")?.getAttribute("aria-live") || null,
          hasClose: !!e.querySelector("button"),
        }));
      });
      await shot(page, `${c.key}-after-submit`, "validation");

      // 4. does fixing it now clear the error LIVE (post-submit revalidation)?
      const f2 = page.locator(`[data-slot="dialog-content"] [name="${c.field}"], [role="dialog"] [name="${c.field}"]`).first();
      if (await f2.count()) {
        await f2.fill("");
        await f2.click();
        await page.keyboard.type(c.fix, { delay: 60 });
        await page.waitForTimeout(900);
        rec.afterFixNoBlur = await page.evaluate(ERRSTATE);
      }
    }
    out.push(rec);
    console.log(
      c.key,
      "| open:", rec.onOpen?.n, "err submitDisabled=", rec.onOpen?.submitDisabled,
      "| typing:", rec.whileTyping?.n, "| blur:", rec.afterBlur?.n,
      "| submit:", rec.afterSubmit?.n, "| afterFix(live):", rec.afterFixNoBlur?.n,
      "| reason:", rec.onOpen?.submitReason,
    );
  }
  save("validation.json", out);
  await b.close();
};
run();
