/*
 * RED TEAM #3
 *  a) /app/users "Add user" swallowed email "zzz" with ZERO field errors. What happened?
 *  b) Re-drive the raw Zod-blob toast (/app/menu/items > Add category, sortOrder="!!").
 *  c) Does the `!!` unit of measure the prior audit created still exist? (persistence proof)
 *  d) Toast capture done properly ([data-sonner-toast]).
 */
import { go, login, browser, save, shot, openDialog } from "./rt-lib.mjs";

const TOASTS = () =>
  [...document.querySelectorAll("[data-sonner-toast], li[data-sonner-toast]")].map((e) => ({
    text: (e.textContent || "").trim().slice(0, 600),
    type: e.getAttribute("data-type"),
    role: e.getAttribute("role") || e.closest("[role]")?.getAttribute("role") || null,
    live: e.getAttribute("aria-live") || e.closest("[aria-live]")?.getAttribute("aria-live") || null,
    closeBtn: !!e.querySelector('button[data-close-button], button[aria-label*="lose" i]'),
  }));

const ERRS = () => {
  const d = document.querySelector('[data-slot="dialog-content"], [role="dialog"]');
  if (!d) return { open: false };
  return {
    open: true,
    texts: [...new Set([...d.querySelectorAll('[data-slot="form-message"]')].map((e) => e.textContent.trim()).filter(Boolean))],
  };
};

const run = async () => {
  const { b, page } = await browser(1440, 900);
  const netPosts = [];
  page.on("response", async (r) => {
    if (r.request().method() !== "GET" && r.url().includes("/api/")) {
      netPosts.push({ m: r.request().method(), url: r.url().replace("http://localhost:8080", ""), status: r.status() });
    }
  });
  const auth = await login(page, "owner");
  if (!auth.ok) { console.error("LOGIN FAILED", auth); await b.close(); process.exit(1); }
  const out = {};

  // ---------- (c) does `!!` still exist in Units of measure? -------------
  const navSetup = await go(page, "/app/inventory/setup", "owner");
  out.uomNav = navSetup;
  out.uomRows = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("table tbody tr")].map((r) =>
      [...r.querySelectorAll("td")].map((c) => c.textContent.trim()).join(" | "),
    );
    return { total: rows.length, first8: rows.slice(0, 8), bangRows: rows.filter((r) => r.includes("!!")) };
  });
  await shot(page, "uom-table-persisted-junk", "junk");
  console.log("UOM rows:", out.uomRows.total, "junk rows:", out.uomRows.bangRows);

  // ---------- (b) the Zod blob ------------------------------------------
  await go(page, "/app/menu/items", "owner");
  const oc = await openDialog(page, "Add category");
  out.categoryDialogOpened = oc.opened;
  if (oc.opened) {
    const nameF = page.locator('[data-slot="dialog-content"] [name="name"]').first();
    if (await nameF.count()) await nameF.fill("RT Zod Probe");
    const sort = page.locator('[data-slot="dialog-content"] [name="sortOrder"]').first();
    out.sortFieldPresent = (await sort.count()) > 0;
    if (await sort.count()) {
      await sort.fill("!!");
      await page.waitForTimeout(400);
      out.zodBlurErrs = await page.evaluate(ERRS);
      const s = page.locator('[data-slot="dialog-content"] button[type="submit"]').first();
      out.zodSubmitDisabled = await s.isDisabled();
      if (!out.zodSubmitDisabled) {
        await s.click();
        await page.waitForTimeout(2500);
        out.zodToasts = await page.evaluate(TOASTS);
        out.zodDialogErrs = await page.evaluate(ERRS);
        await shot(page, "menu-category-zod-blob", "junk");
      }
    }
    console.log("ZOD toasts:", JSON.stringify(out.zodToasts));
  }

  // ---------- (a) Add user with a malformed email -----------------------
  await go(page, "/app/users", "owner");
  const ou = await openDialog(page, "Add user");
  out.userDialogOpened = ou.opened;
  if (ou.opened) {
    out.userFields = await page.evaluate(() => {
      const d = document.querySelector('[data-slot="dialog-content"]');
      return [...d.querySelectorAll("input,select,textarea")].map((e) => ({
        name: e.name || e.id, tag: e.tagName.toLowerCase(), type: e.type, value: e.value,
      }));
    });
    const email = page.locator('[data-slot="dialog-content"] [name="email"]').first();
    await email.fill("zzz");
    const full = page.locator('[data-slot="dialog-content"] [name="fullName"], [data-slot="dialog-content"] [name="name"]').first();
    if (await full.count()) await full.fill("RT Bad Email");
    await page.waitForTimeout(400);
    await shot(page, "user-dialog-filled-bad-email", "junk");
    netPosts.length = 0;
    const s = page.locator('[data-slot="dialog-content"] button[type="submit"]').first();
    out.userSubmitDisabled = await s.isDisabled();
    if (!out.userSubmitDisabled) {
      await s.click();
      await page.waitForTimeout(3000);
      out.userToasts = await page.evaluate(TOASTS);
      out.userDialogErrs = await page.evaluate(ERRS);
      out.userNet = [...netPosts];
      await shot(page, "user-after-bad-email-submit", "junk");
    }
    console.log("USER submitDisabled:", out.userSubmitDisabled, "toasts:", JSON.stringify(out.userToasts), "errs:", JSON.stringify(out.userDialogErrs), "net:", JSON.stringify(out.userNet));
  }

  // did a user with email "zzz" get created?
  await go(page, "/app/users", "owner");
  out.userTable = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("table tbody tr")].map((r) => r.textContent.trim());
    return { total: rows.length, zzz: rows.filter((r) => /zzz/i.test(r)) };
  });
  console.log("USER TABLE zzz rows:", out.userTable.zzz);

  save("junk.json", out);
  await b.close();
};
run();
