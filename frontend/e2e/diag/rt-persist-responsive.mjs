/*
 * RED TEAM #6
 *  a) Prove the "no UI-level checks" finding is not a one-off: create a vendor with a
 *     garbage email, RELOAD, and see whether it persisted.
 *  b) Attack "Responsive: WORKS" — 0px page overflow is a weak metric. At 390 can a user
 *     actually reach navigation, read a data table, and hit the primary action in a dialog
 *     that is TALLER than the viewport?
 *  c) Attack "Dark mode: WORKS" — check contrast-critical surfaces really flip, incl. inside
 *     a dialog and on a toast.
 */
import { go, login, browser, save, shot, openDialog, BASE } from "./rt-lib.mjs";

const run = async () => {
  const out = {};

  // ================= (a) vendor persistence =================
  {
    const { b, page } = await browser(1440, 900);
    const auth = await login(page, "owner");
    if (!auth.ok) { console.error("LOGIN FAIL", auth); process.exit(1); }
    await go(page, "/app/purchasing/vendors", "owner");
    const o = await openDialog(page, "Add vendor");
    out.vendorOpened = o.opened;
    if (o.opened) {
      const stamp = "RT" + Date.now().toString().slice(-6);
      out.vendorName = `RTBAD ${stamp}`;
      await page.locator('[data-slot="dialog-content"] [name="name"]').first().fill(out.vendorName);
      await page.locator('[data-slot="dialog-content"] [name="email"]').first().fill("not-an-email");
      const phone = page.locator('[data-slot="dialog-content"] [name="phone"]').first();
      if (await phone.count()) await phone.fill("!!!!");
      await page.waitForTimeout(400);
      out.vendorPreSubmitErrs = await page.evaluate(() => [...document.querySelectorAll('[data-slot="form-message"]')].map((e) => e.textContent.trim()).filter(Boolean));
      const s = page.locator('[data-slot="dialog-content"] button[type="submit"]').first();
      out.vendorSubmitDisabled = await s.isDisabled();
      if (!out.vendorSubmitDisabled) {
        await s.click();
        await page.waitForTimeout(3500);
        out.vendorToasts = await page.evaluate(() => [...document.querySelectorAll("[data-sonner-toast]")].map((e) => e.textContent.trim().slice(0, 200)));
        out.vendorDialogStillOpen = await page.evaluate(() => !!document.querySelector('[data-slot="dialog-content"]'));
      }
      // hard reload and look for it
      await page.goto(`${BASE}/app/purchasing/vendors`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4000);
      out.vendorAfterReload = await page.evaluate((n) => {
        const t = document.body.innerText;
        return { found: t.includes(n), badEmailShown: t.includes("not-an-email") };
      }, out.vendorName);
      await shot(page, "vendor-list-after-reload", "persist");
      console.log("VENDOR preErrs:", out.vendorPreSubmitErrs, "toasts:", out.vendorToasts, "afterReload:", JSON.stringify(out.vendorAfterReload));
    }
    await b.close();
  }

  // ================= (b) responsive at 390, real usability =================
  {
    const { b, page } = await browser(390, 844);
    const auth = await login(page, "owner");
    if (!auth.ok) { console.error("LOGIN FAIL 390", auth); process.exit(1); }
    const routes = ["/app/dashboard", "/app/menu/items", "/app/inventory/ingredients", "/app/purchasing/purchase-orders", "/app/hr/employees", "/app/pos"];
    out.mobile = [];
    for (const r of routes) {
      const nav = await go(page, r, "owner", { wait: 3500 });
      const m = await page.evaluate(() => {
        const de = document.documentElement;
        // is primary navigation reachable at all?
        const navEl = document.querySelector("nav, aside, [data-slot='sidebar']");
        const navVisible = navEl ? navEl.getBoundingClientRect().width > 40 && getComputedStyle(navEl).display !== "none" : false;
        const burger = [...document.querySelectorAll("button")].some((btn) => {
          const l = (btn.getAttribute("aria-label") || btn.textContent || "").toLowerCase();
          return /menu|navigation|open sidebar|toggle/.test(l) && btn.getBoundingClientRect().width > 0;
        });
        // any element wider than the viewport that is NOT in a scroll container
        const scrollers = [...document.querySelectorAll("*")].filter((e) => {
          const cs = getComputedStyle(e);
          return /auto|scroll/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 4;
        });
        const ctrl = [...document.querySelectorAll("button,a[href],input,select,[role=button]")].filter((e) => {
          const r2 = e.getBoundingClientRect();
          return r2.width > 0 && r2.height > 0;
        });
        return {
          overflowX: de.scrollWidth - de.clientWidth,
          navVisible,
          burger,
          horizontalScrollers: scrollers.length,
          hiddenScrollWidth: scrollers.map((e) => e.scrollWidth - e.clientWidth).sort((a, x) => x - a).slice(0, 3),
          controls: ctrl.length,
          under44: ctrl.filter((e) => { const r2 = e.getBoundingClientRect(); return r2.height < 44 || r2.width < 44; }).length,
          under24: ctrl.filter((e) => { const r2 = e.getBoundingClientRect(); return r2.height < 24 || r2.width < 24; }).length,
          smallestFont: Math.min(...[...document.querySelectorAll("td,span,p,div,label")].filter((e) => e.getBoundingClientRect().width > 0 && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => parseFloat(getComputedStyle(e).fontSize))),
        };
      });
      out.mobile.push({ route: r, nav, ...m });
      await shot(page, r.replace(/\W+/g, "_"), "m390");
      console.log("390", r, "ovf=" + m.overflowX, "nav=" + m.navVisible, "burger=" + m.burger, "scrollers=" + m.horizontalScrollers, "under24=" + m.under24 + "/" + m.controls, "minFont=" + m.smallestFont);
    }
    // tall dialog at 390: can the primary action be reached without the dialog clipping?
    await go(page, "/app/inventory/ingredients", "owner");
    const o = await openDialog(page, "Add ingredient");
    if (o.opened) {
      out.mobileDialog = await page.evaluate(() => {
        const d = document.querySelector('[data-slot="dialog-content"]');
        const r = d.getBoundingClientRect();
        const sub = d.querySelector('button[type="submit"]') || [...d.querySelectorAll("button")].pop();
        const sr = sub ? sub.getBoundingClientRect() : null;
        return {
          w: Math.round(r.width), h: Math.round(r.height),
          top: Math.round(r.top), bottom: Math.round(r.bottom),
          vh: window.innerHeight,
          clipTop: Math.max(0, -r.top), clipBottom: Math.max(0, r.bottom - window.innerHeight),
          innerScrollable: d.scrollHeight > d.clientHeight + 2,
          submitInViewport: sr ? sr.top >= 0 && sr.bottom <= window.innerHeight : null,
          submitTop: sr ? Math.round(sr.top) : null,
        };
      });
      await shot(page, "ingredient-dialog-390", "m390");
      console.log("390 dialog:", JSON.stringify(out.mobileDialog));
    }
    await b.close();
  }

  // ================= (c) dark mode =================
  {
    const { b, ctx, page } = await browser(1440, 900);
    await ctx.addInitScript(() => { try { localStorage.setItem("theme", "dark"); } catch {} });
    const auth = await login(page, "owner");
    if (!auth.ok) { console.error("LOGIN FAIL dark", auth); process.exit(1); }
    await go(page, "/app/dashboard", "owner");
    await page.evaluate(() => { document.documentElement.classList.add("dark"); document.documentElement.setAttribute("data-theme", "dark"); });
    await page.waitForTimeout(1200);
    out.dark = await page.evaluate(() => ({
      htmlDark: document.documentElement.classList.contains("dark"),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bodyColor: getComputedStyle(document.body).color,
    }));
    await shot(page, "dashboard-dark", "theme");
    // dialog + toast in dark
    await go(page, "/app/menu/items", "owner");
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    const o = await openDialog(page, "Add category");
    if (o.opened) {
      await page.locator('[data-slot="dialog-content"] [name="sortOrder"]').first().fill("!!");
      await page.locator('[data-slot="dialog-content"] [name="name"]').first().fill("RT dark probe");
      await page.locator('[data-slot="dialog-content"] button[type="submit"]').first().click();
      await page.waitForTimeout(2500);
      out.darkDialog = await page.evaluate(() => {
        const d = document.querySelector('[data-slot="dialog-content"]');
        const t = document.querySelector("[data-sonner-toast]");
        return {
          htmlDark: document.documentElement.classList.contains("dark"),
          dialogBg: d ? getComputedStyle(d).backgroundColor : null,
          dialogColor: d ? getComputedStyle(d).color : null,
          toastText: t ? t.textContent.trim().slice(0, 200) : null,
          toastBg: t ? getComputedStyle(t).backgroundColor : null,
          toastColor: t ? getComputedStyle(t).color : null,
          toastHasCloseButton: t ? !!t.querySelector("button") : null,
        };
      });
      await shot(page, "menu-category-dark-toast", "theme");
      console.log("DARK:", JSON.stringify(out.dark), JSON.stringify(out.darkDialog));
    }
    await b.close();
  }

  save("persist-responsive.json", out);
};
run();
