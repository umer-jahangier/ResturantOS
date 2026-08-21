/*
 * RED TEAM #7 — follow-ups
 *  a) Did the garbage vendor actually persist? (search the list, don't trust page 1)
 *  b) At 390 the sidebar is hidden behind a burger — does the burger actually open nav?
 *  c) iPhone SE (375x667) — does the 14-field ingredient dialog still fit / scroll?
 *  d) Toast: how long does an error toast live, and can it be dismissed?
 *  e) What are the 25 sub-24px controls on /app/purchasing/purchase-orders at 390?
 */
import { go, login, browser, save, shot, openDialog, BASE } from "./rt-lib.mjs";

const run = async () => {
  const out = {};

  // ---------- (a) vendor persistence, properly ----------
  {
    const { b, page } = await browser(1440, 900);
    const a = await login(page, "owner"); if (!a.ok) process.exit(1);
    await go(page, "/app/purchasing/vendors", "owner", { wait: 4000 });
    out.vendorPage = await page.evaluate(() => {
      const t = document.body.innerText;
      return {
        hasRTBAD: /RTBAD/.test(t),
        hasNotAnEmail: /not-an-email/.test(t),
        vendorCountLine: (t.match(/\d+\s+vendors?/i) || [])[0] || null,
        snippet: t.slice(0, 900),
      };
    });
    // try the search box
    const search = page.locator('input[type="search"], input[placeholder*="Search" i]').first();
    if (await search.count()) {
      await search.fill("RTBAD");
      await page.waitForTimeout(2500);
      out.vendorSearch = await page.evaluate(() => ({
        hasRTBAD: /RTBAD/.test(document.body.innerText),
        hasNotAnEmail: /not-an-email/.test(document.body.innerText),
        body: document.body.innerText.slice(0, 700),
      }));
    }
    await shot(page, "vendor-search-rtbad", "persist");
    console.log("VENDOR PAGE:", JSON.stringify({ ...out.vendorPage, snippet: undefined }), "SEARCH:", JSON.stringify({ ...(out.vendorSearch || {}), body: undefined }));
    await b.close();
  }

  // ---------- (b)(c)(e) mobile ----------
  {
    const { b, page } = await browser(390, 844);
    const a = await login(page, "owner"); if (!a.ok) process.exit(1);
    await go(page, "/app/dashboard", "owner", { wait: 3500 });
    // find and click the burger
    const burger = page.locator('button[aria-label*="menu" i]:visible, button[aria-label*="navigation" i]:visible, button[aria-label*="sidebar" i]:visible').first();
    out.burgerFound = (await burger.count()) > 0;
    out.allButtonsAtMobile = await page.evaluate(() => [...document.querySelectorAll("button")].filter(e=>e.getBoundingClientRect().width>0).map(e=>({l:(e.getAttribute("aria-label")||e.textContent||"").trim().slice(0,30)})).slice(0,20));
    if (out.burgerFound) {
      await burger.click().catch(()=>{});
      await page.waitForTimeout(1500);
      out.burgerOpens = await page.evaluate(() => {
        const links = [...document.querySelectorAll("a[href^='/app']")].filter((e) => e.getBoundingClientRect().width > 0);
        return { visibleNavLinks: links.length, sample: links.slice(0, 6).map((e) => e.textContent.trim()) };
      });
      await shot(page, "burger-open-390", "m390");
    }
    console.log("BURGER:", out.burgerFound, JSON.stringify(out.burgerOpens));

    // (e) what are the tiny controls on purchase-orders
    await go(page, "/app/purchasing/purchase-orders", "owner", { wait: 3500 });
    out.tinyControls = await page.evaluate(() => {
      const ctrl = [...document.querySelectorAll("button,a[href],input,select,[role=button]")].filter((e) => {
        const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0;
      });
      return ctrl.filter((e) => { const r = e.getBoundingClientRect(); return r.height < 24 || r.width < 24; })
        .slice(0, 12)
        .map((e) => {
          const r = e.getBoundingClientRect();
          return { tag: e.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height), label: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 30) };
        });
    });
    console.log("TINY:", JSON.stringify(out.tinyControls));
    await b.close();
  }

  // ---------- (c) iPhone SE ----------
  {
    const { b, page } = await browser(375, 667);
    const a = await login(page, "owner"); if (!a.ok) process.exit(1);
    out.se = [];
    for (const [route, trigger] of [["/app/inventory/ingredients", "Add ingredient"], ["/app/hr/employees", "New employee"], ["/app/purchasing/purchase-orders", "New Purchase Order"]]) {
      await go(page, route, "owner", { wait: 3500 });
      const o = await openDialog(page, trigger);
      if (!o.opened) { out.se.push({ route, opened: false }); continue; }
      const m = await page.evaluate(() => {
        const d = document.querySelector('[data-slot="dialog-content"]');
        const r = d.getBoundingClientRect();
        const sub = d.querySelector('button[type="submit"]') || [...d.querySelectorAll("button")].pop();
        const sr = sub ? sub.getBoundingClientRect() : null;
        return {
          w: Math.round(r.width), h: Math.round(r.height), vh: window.innerHeight,
          clipTop: Math.max(0, Math.round(-r.top)), clipBottom: Math.max(0, Math.round(r.bottom - window.innerHeight)),
          innerScrollable: d.scrollHeight > d.clientHeight + 2,
          submitVisible: sr ? sr.top >= 0 && sr.bottom <= window.innerHeight : null,
          submitLabel: sub ? sub.textContent.trim().slice(0, 24) : null,
          pageScrollY: window.scrollY, docScrollable: document.documentElement.scrollHeight > window.innerHeight,
        };
      });
      out.se.push({ route, opened: true, ...m });
      await shot(page, route.replace(/\W+/g, "_"), "se375");
      console.log("SE375", route, JSON.stringify(m));
    }
    await b.close();
  }

  // ---------- (d) toast lifetime ----------
  {
    const { b, page } = await browser(1440, 900);
    const a = await login(page, "owner"); if (!a.ok) process.exit(1);
    await go(page, "/app/menu/items", "owner");
    const o = await openDialog(page, "Add category");
    if (o.opened) {
      await page.locator('[data-slot="dialog-content"] [name="name"]').first().fill("RT toast probe");
      await page.locator('[data-slot="dialog-content"] [name="sortOrder"]').first().fill("!!");
      await page.locator('[data-slot="dialog-content"] button[type="submit"]').first().click();
      const t0 = Date.now();
      const samples = [];
      for (let i = 0; i < 16; i += 1) {
        await page.waitForTimeout(1000);
        const n = await page.evaluate(() => document.querySelectorAll("[data-sonner-toast]").length);
        samples.push({ tMs: Date.now() - t0, toasts: n });
        if (n === 0 && i > 1) break;
      }
      out.toastLifetime = samples;
      out.toastShape = await page.evaluate(() => {
        const t = document.querySelector("[data-sonner-toast]");
        if (!t) return null;
        const r = t.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height), lines: t.textContent.split("\n").length, buttons: t.querySelectorAll("button").length };
      });
      console.log("TOAST LIFETIME:", JSON.stringify(samples), "SHAPE:", JSON.stringify(out.toastShape));
    }
    await b.close();
  }

  save("followups.json", out);
};
run();
