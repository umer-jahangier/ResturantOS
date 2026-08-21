/*
 * RED TEAM #1 — attack the "Modals/dialogs usable and consistent: WORKS" verdict.
 *
 * The prior audit measured radius/padding/aria-modal/Escape-closes and called it WORKS.
 * "Escape closes 13 of 13" is only a quality result if nothing is lost when it does.
 * This probe tests what happens to a HALF-FILLED form when the dialog is dismissed, plus
 * focus trap, focus restore, and required-field markers INCLUDING aria-required (which the
 * prior probe did not measure).
 */
import { go, login, browser, save, shot, openDialog } from "./rt-lib.mjs";

const CASES = [
  { key: "po", route: "/app/purchasing/purchase-orders", trigger: "New Purchase Order" },
  { key: "expense", route: "/app/finance/expenses", trigger: "New expense" },
  { key: "employee", route: "/app/hr/employees", trigger: "New employee" },
  { key: "user", route: "/app/users", trigger: "Add user" },
  { key: "station", route: "/app/stations", trigger: "Add station" },
];

const MEASURE = () => {
  const d = document.querySelector('[data-slot="dialog-content"], [role="dialog"]');
  if (!d) return null;
  const cs = getComputedStyle(d);
  const r = d.getBoundingClientRect();
  const fields = [...d.querySelectorAll("input,select,textarea")].filter((el) => {
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && el.type !== "hidden";
  });
  const labelFor = (el) => {
    let t = "";
    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) t = l.textContent || "";
    }
    if (!t) {
      const l = el.closest("label");
      if (l) t = l.textContent || "";
    }
    if (!t) t = el.getAttribute("aria-label") || "";
    return t.trim();
  };
  return {
    w: Math.round(r.width),
    h: Math.round(r.height),
    radius: cs.borderRadius,
    padding: cs.padding,
    ariaModal: d.getAttribute("aria-modal"),
    role: d.getAttribute("role"),
    scrollable: d.scrollHeight > d.clientHeight + 2,
    fields: fields.map((el) => ({
      name: el.name || el.id || el.getAttribute("aria-label") || el.tagName.toLowerCase(),
      tag: el.tagName.toLowerCase(),
      type: el.type || null,
      label: labelFor(el),
      labelMarksRequired: /\*|\(required\)|required/i.test(labelFor(el)),
      htmlRequired: el.required === true,
      ariaRequired: el.getAttribute("aria-required"),
      ariaInvalid: el.getAttribute("aria-invalid"),
      describedBy: !!el.getAttribute("aria-describedby"),
    })),
    focusables: d.querySelectorAll(
      'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ).length,
  };
};

const run = async () => {
  const { b, page } = await browser(1440, 900);
  const auth = await login(page, "owner");
  if (!auth.ok) { console.error("LOGIN FAILED", auth); await b.close(); process.exit(1); }
  console.log("logged in", auth);

  const results = [];
  for (const c of CASES) {
    const rec = { ...c };
    const nav = await go(page, c.route, "owner");
    rec.nav = nav;
    if (!nav.ok) { results.push(rec); console.log(c.key, "NAV FAIL", nav); continue; }

    // --- open + measure -------------------------------------------------
    const o1 = await openDialog(page, c.trigger);
    rec.opened = o1.opened;
    if (!o1.opened) { results.push(rec); console.log(c.key, "NO DIALOG"); continue; }
    rec.geom = await page.evaluate(MEASURE);

    // --- focus on open --------------------------------------------------
    rec.focusOnOpen = await page.evaluate(() => {
      const d = document.querySelector('[data-slot="dialog-content"], [role="dialog"]');
      const a = document.activeElement;
      return {
        inside: !!(d && a && d.contains(a)),
        el: a ? `${a.tagName.toLowerCase()}${a.getAttribute("name") ? "#" + a.getAttribute("name") : ""}` : null,
      };
    });

    // --- focus TRAP: tab past the end, must wrap back inside ------------
    const n = Math.min((rec.geom?.focusables || 5) + 3, 40);
    for (let i = 0; i < n; i += 1) await page.keyboard.press("Tab");
    rec.focusTrap = await page.evaluate(() => {
      const d = document.querySelector('[data-slot="dialog-content"], [role="dialog"]');
      const a = document.activeElement;
      return { inside: !!(d && a && d.contains(a)), el: a ? a.tagName.toLowerCase() : null };
    });

    // --- THE DATA-LOSS TEST ---------------------------------------------
    // Type into the first text field, then press Escape. Does anything warn?
    const first = page.locator(
      '[data-slot="dialog-content"] input[type=text]:not([disabled]), [data-slot="dialog-content"] input:not([type]):not([disabled]), [role="dialog"] input[type=text]:not([disabled])',
    ).first();
    let typed = null;
    if (await first.count()) {
      typed = "REDTEAM-DIRTY-" + c.key;
      await first.fill(typed);
      await page.waitForTimeout(300);
    }
    rec.typedValue = typed;
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1200);
    rec.escape = await page.evaluate(() => {
      const dialogs = [...document.querySelectorAll('[data-slot="dialog-content"], [role="dialog"], [role="alertdialog"]')];
      const body = document.body.innerText;
      return {
        dialogsOpen: dialogs.length,
        confirmShown: /unsaved|discard|are you sure|lose your changes/i.test(body),
      };
    });
    await shot(page, `${c.key}-after-escape-with-dirty-data`, "dataloss");

    // --- reopen: is the typed value still there? ------------------------
    if (rec.escape.dialogsOpen === 0) {
      const o2 = await openDialog(page, c.trigger);
      if (o2.opened) {
        rec.reopenValue = await page.evaluate(() => {
          const d = document.querySelector('[data-slot="dialog-content"], [role="dialog"]');
          const i = d?.querySelector('input[type=text]:not([disabled]), input:not([type]):not([disabled])');
          return i ? i.value : null;
        });
        rec.dataLost = rec.reopenValue !== typed;

        // --- OUTSIDE-CLICK dismissal, also with dirty data ---------------
        const f2 = page.locator(
          '[data-slot="dialog-content"] input[type=text]:not([disabled]), [data-slot="dialog-content"] input:not([type]):not([disabled]), [role="dialog"] input[type=text]:not([disabled])',
        ).first();
        if (await f2.count()) await f2.fill("REDTEAM-OUTSIDE");
        await page.mouse.click(8, 8); // far corner, on the overlay
        await page.waitForTimeout(1200);
        rec.outsideClick = await page.evaluate(() => ({
          dialogsOpen: document.querySelectorAll('[data-slot="dialog-content"], [role="dialog"]').length,
          confirmShown: /unsaved|discard|are you sure/i.test(document.body.innerText),
        }));
      }
    }

    // --- focus restore after close --------------------------------------
    rec.focusAfterClose = await page.evaluate(() => {
      const a = document.activeElement;
      return a ? `${a.tagName.toLowerCase()}:${(a.textContent || "").trim().slice(0, 30)}` : "none";
    });

    results.push(rec);
    console.log(
      c.key,
      "w=" + rec.geom?.w,
      "fields=" + (rec.geom?.fields.length || 0),
      "reqLabels=" + (rec.geom?.fields.filter((f) => f.labelMarksRequired).length || 0),
      "ariaReq=" + (rec.geom?.fields.filter((f) => f.ariaRequired === "true").length || 0),
      "trap=" + rec.focusTrap?.inside,
      "escClosed=" + (rec.escape?.dialogsOpen === 0),
      "confirm=" + rec.escape?.confirmShown,
      "dataLost=" + rec.dataLost,
      "outsideClosed=" + (rec.outsideClick ? rec.outsideClick.dialogsOpen === 0 : "n/a"),
    );
  }

  save("dialogs-part2.json", results);
  await b.close();
};
run();
