/* RED TEAM #4 — why does "Create user" do nothing with a malformed email? */
import { go, login, browser, save, shot, openDialog } from "./rt-lib.mjs";

const run = async () => {
  const { b, page } = await browser(1440, 900);
  const console_ = [];
  const net = [];
  page.on("console", (m) => console_.push(`${m.type()}: ${m.text().slice(0, 300)}`));
  page.on("pageerror", (e) => console_.push(`PAGEERROR: ${String(e).slice(0, 400)}`));
  page.on("request", (r) => { if (r.url().includes("/api/") && r.method() !== "GET") net.push(`${r.method()} ${r.url().replace("http://localhost:8080", "")}`); });

  const auth = await login(page, "owner");
  if (!auth.ok) { console.error("LOGIN FAILED", auth); await b.close(); process.exit(1); }

  const nav = await go(page, "/app/users", "owner");
  console.log("nav:", JSON.stringify(nav));
  const out = { nav };

  // what is on the page at all?
  out.pageText = (await page.locator("body").innerText()).slice(0, 1200);
  out.rowCounts = await page.evaluate(() => ({
    tables: document.querySelectorAll("table").length,
    tbodyRows: document.querySelectorAll("table tbody tr").length,
    gridRows: document.querySelectorAll('[data-testid="data-grid"] [role="row"], [role="row"]').length,
  }));
  await shot(page, "users-page", "user");
  console.log("rowCounts:", JSON.stringify(out.rowCounts));

  const o = await openDialog(page, "Add user");
  out.opened = o.opened;
  if (!o.opened) { save("user.json", out); await b.close(); return; }

  await page.locator('[data-slot="dialog-content"] [name="email"]').first().fill("zzz");
  await page.locator('[data-slot="dialog-content"] [name="fullName"]').first().fill("RT Probe");
  await page.waitForTimeout(400);

  net.length = 0; console_.length = 0;
  // click by role/name so we hit exactly what a user hits
  const btn = page.getByRole("button", { name: /Create user/i }).first();
  out.btnCount = await btn.count();
  out.btnDisabled = await btn.isDisabled();
  await btn.click();
  await page.waitForTimeout(2500);

  out.after = await page.evaluate(() => {
    const d = document.querySelector('[data-slot="dialog-content"]');
    return {
      dialogStillOpen: !!d,
      formMessages: [...document.querySelectorAll('[data-slot="form-message"]')].map((e) => e.textContent.trim()),
      allRed: [...document.querySelectorAll(".text-destructive, [data-slot='form-message']")].map((e) => e.textContent.trim()).filter(Boolean),
      ariaInvalid: document.querySelectorAll('[aria-invalid="true"]').length,
      toasts: [...document.querySelectorAll("[data-sonner-toast]")].map((e) => e.textContent.trim().slice(0, 300)),
      emailValue: d?.querySelector('[name="email"]')?.value,
      dialogHTML: d ? d.innerHTML.length : 0,
    };
  });
  out.net = [...net];
  out.console = console_.slice(0, 25);
  await shot(page, "users-after-create-click", "user");
  console.log("AFTER:", JSON.stringify(out.after, null, 1));
  console.log("NET:", out.net);
  console.log("CONSOLE:", out.console);

  // Now do it with a VALID email but no branch/role -> should it work?
  await page.locator('[data-slot="dialog-content"] [name="email"]').first().fill("rt.probe.valid@terrace.local");
  await page.waitForTimeout(300);
  net.length = 0;
  await page.getByRole("button", { name: /Create user/i }).first().click();
  await page.waitForTimeout(3500);
  out.validAttempt = await page.evaluate(() => ({
    dialogStillOpen: !!document.querySelector('[data-slot="dialog-content"]'),
    toasts: [...document.querySelectorAll("[data-sonner-toast]")].map((e) => e.textContent.trim().slice(0, 300)),
    formMessages: [...document.querySelectorAll('[data-slot="form-message"]')].map((e) => e.textContent.trim()),
    bodySnippet: document.body.innerText.slice(0, 600),
  }));
  out.validNet = [...net];
  await shot(page, "users-after-valid-create", "user");
  console.log("VALID ATTEMPT:", JSON.stringify(out.validAttempt, null, 1), "NET:", out.validNet);

  save("user.json", out);
  await b.close();
};
run();
