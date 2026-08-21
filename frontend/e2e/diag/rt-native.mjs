/* RED TEAM #5 — is native browser constraint validation swallowing the submit? */
import { go, login, browser, save, shot, openDialog } from "./rt-lib.mjs";

const PROBE = () => {
  const d = document.querySelector('[data-slot="dialog-content"]');
  if (!d) return { open: false };
  const form = d.querySelector("form") || document.querySelector(`form#${d.querySelector("button[type=submit]")?.getAttribute("form") || "__none"}`);
  const inputs = [...d.querySelectorAll("input,select,textarea")].filter((e) => e.type !== "hidden");
  return {
    open: true,
    formFound: !!form,
    formNoValidate: form ? form.noValidate : null,
    submitFormNoValidate: (() => {
      const b = d.querySelector("button[type=submit]");
      if (!b) return null;
      const f = b.form;
      return f ? f.noValidate : null;
    })(),
    inputs: inputs.map((e) => ({
      name: e.name || e.id,
      type: e.type,
      value: e.value,
      willValidate: e.willValidate,
      valid: e.validity ? e.validity.valid : null,
      typeMismatch: e.validity ? e.validity.typeMismatch : null,
      valueMissing: e.validity ? e.validity.valueMissing : null,
      nativeMessage: e.validationMessage || null,
    })),
    formCheckValidity: form ? form.checkValidity() : null,
  };
};

const CASES = [
  { key: "user", route: "/app/users", trigger: "Add user", field: "email", bad: "zzz", submitName: /Create user/i },
  { key: "vendor", route: "/app/purchasing/vendors", trigger: "Add vendor", field: "email", bad: "not-an-email", submitName: /Add vendor|Save|Create/i },
];

const run = async () => {
  const { b, page } = await browser(1440, 900);
  const auth = await login(page, "owner");
  if (!auth.ok) { console.error("LOGIN FAILED", auth); await b.close(); process.exit(1); }
  const out = [];
  for (const c of CASES) {
    const rec = { ...c };
    await go(page, c.route, "owner");
    const o = await openDialog(page, c.trigger);
    if (!o.opened) { rec.opened = false; out.push(rec); continue; }
    await page.locator(`[data-slot="dialog-content"] [name="${c.field}"]`).first().fill(c.bad);
    await page.waitForTimeout(300);
    rec.probe = await page.evaluate(PROBE);
    out.push(rec);
    console.log("==", c.key, "formNoValidate:", rec.probe.formNoValidate, "checkValidity:", rec.probe.formCheckValidity);
    for (const i of rec.probe.inputs) {
      if (i.valid === false || i.type === "email") console.log("   ", i.name, i.type, "value=", JSON.stringify(i.value), "valid=", i.valid, "native=", JSON.stringify(i.nativeMessage));
    }
  }
  save("native.json", out);
  await b.close();
};
run();
