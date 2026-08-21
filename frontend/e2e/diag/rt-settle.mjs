/*
 * RED TEAM #8 — settle two open questions with direct evidence.
 *  a) Vendor create said "Added ..." but the row never appeared. Capture the POST response
 *     AND the subsequent GET list response body. Success toast + absent row = a lie.
 *  b) At 375x667 the ingredient dialog is 691px tall, clipped 12px top and bottom, and
 *     NOT scrollable. What exactly is unreachable? And is HR's submit reachable by scrolling?
 */
import { go, login, browser, save, shot, openDialog, BASE } from "./rt-lib.mjs";

const run = async () => {
  const out = {};

  // ---------------- (a) ----------------
  {
    const { b, page } = await browser(1440, 900);
    const bodies = [];
    page.on("response", async (r) => {
      const u = r.url();
      if (!u.includes("/api/v1/purchasing/vendors") && !u.includes("/vendors")) return;
      let body = null;
      try { body = (await r.text()).slice(0, 1500); } catch { body = "<unreadable>"; }
      bodies.push({ m: r.request().method(), url: u.replace("http://localhost:8080", ""), status: r.status(), body });
    });
    const a = await login(page, "owner"); if (!a.ok) { console.error("login fail"); process.exit(1); }
    await go(page, "/app/purchasing/vendors", "owner", { wait: 4000 });
    bodies.length = 0;

    const name = "RTPERSIST" + Date.now().toString().slice(-6);
    out.name = name;
    const o = await openDialog(page, "Add vendor");
    if (o.opened) {
      await page.locator('[data-slot="dialog-content"] [name="name"]').first().fill(name);
      await page.locator('[data-slot="dialog-content"] [name="email"]').first().fill("still-not-an-email");
      await page.locator('[data-slot="dialog-content"] button[type="submit"]').first().click();
      await page.waitForTimeout(4000);
      out.toast = await page.evaluate(() => [...document.querySelectorAll("[data-sonner-toast]")].map((e) => e.textContent.trim().slice(0, 200)));
      out.listAfterCreateNoReload = await page.evaluate((n) => ({
        inDom: document.body.innerText.includes(n),
        count: (document.body.innerText.match(/(\d+)\s*\n?\s*Vendors/i) || [])[1] || null,
      }), name);
      await shot(page, "vendor-immediately-after-create", "persist");
    }
    // hard reload
    await page.goto(`${BASE}/app/purchasing/vendors`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    out.afterReload = await page.evaluate((n) => ({
      inDom: document.body.innerText.includes(n),
      text: document.body.innerText.slice(0, 1200),
    }), out.name);
    out.network = bodies;
    await shot(page, "vendor-after-hard-reload", "persist");
    console.log("TOAST:", out.toast);
    console.log("IMMEDIATELY IN LIST:", JSON.stringify(out.listAfterCreateNoReload));
    console.log("AFTER RELOAD inDom:", out.afterReload.inDom);
    for (const n of bodies) console.log("NET", n.m, n.status, n.url, "|", n.body?.slice(0, 300));
    await b.close();
  }

  // ---------------- (b) ----------------
  {
    const { b, page } = await browser(375, 667);
    const a = await login(page, "owner"); if (!a.ok) process.exit(1);

    await go(page, "/app/inventory/ingredients", "owner", { wait: 3500 });
    const o = await openDialog(page, "Add ingredient");
    if (o.opened) {
      out.ingredientSE = await page.evaluate(() => {
        const d = document.querySelector('[data-slot="dialog-content"]');
        const dr = d.getBoundingClientRect();
        const vh = window.innerHeight;
        const clipped = [];
        for (const el of d.querySelectorAll("label,input,select,textarea,button,h2,p")) {
          const r = el.getBoundingClientRect();
          if (r.height === 0) continue;
          if (r.top < 0 || r.bottom > vh) {
            clipped.push({
              tag: el.tagName.toLowerCase(),
              text: (el.textContent || el.getAttribute("name") || "").trim().slice(0, 34),
              top: Math.round(r.top), bottom: Math.round(r.bottom),
            });
          }
        }
        return {
          dialog: { h: Math.round(dr.height), top: Math.round(dr.top), bottom: Math.round(dr.bottom), vh },
          dialogScrollable: d.scrollHeight > d.clientHeight + 2,
          overflowY: getComputedStyle(d).overflowY,
          bodyScrollable: document.documentElement.scrollHeight > vh,
          clippedElements: clipped,
        };
      });
      // try to scroll inside the dialog and see if anything moves
      await page.mouse.move(187, 400);
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(800);
      out.ingredientSEAfterScroll = await page.evaluate(() => {
        const d = document.querySelector('[data-slot="dialog-content"]');
        const r = d.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), scrollTop: d.scrollTop, winY: window.scrollY };
      });
      await shot(page, "ingredient-se375-clipped", "se375");
      console.log("SE ingredient:", JSON.stringify(out.ingredientSE, null, 1));
      console.log("after wheel:", JSON.stringify(out.ingredientSEAfterScroll));
    }

    await go(page, "/app/hr/employees", "owner", { wait: 3500 });
    const o2 = await openDialog(page, "New employee");
    if (o2.opened) {
      out.hrSEBefore = await page.evaluate(() => {
        const d = document.querySelector('[data-slot="dialog-content"]');
        const sub = [...d.querySelectorAll("button")].find((x) => /add employee/i.test(x.textContent));
        const r = sub ? sub.getBoundingClientRect() : null;
        return { submitTop: r ? Math.round(r.top) : null, submitBottom: r ? Math.round(r.bottom) : null, vh: window.innerHeight, scrollable: d.scrollHeight > d.clientHeight + 2 };
      });
      const sub = page.getByRole("button", { name: /Add employee/i }).first();
      await sub.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(600);
      out.hrSEAfterScroll = await page.evaluate(() => {
        const d = document.querySelector('[data-slot="dialog-content"]');
        const sub2 = [...d.querySelectorAll("button")].find((x) => /add employee/i.test(x.textContent));
        const r = sub2 ? sub2.getBoundingClientRect() : null;
        return { submitTop: r ? Math.round(r.top) : null, submitBottom: r ? Math.round(r.bottom) : null, vh: window.innerHeight, visible: r ? r.top >= 0 && r.bottom <= window.innerHeight : null };
      });
      await shot(page, "hr-se375-submit", "se375");
      console.log("HR SE before:", JSON.stringify(out.hrSEBefore), "after scroll:", JSON.stringify(out.hrSEAfterScroll));
    }
    await b.close();
  }

  save("settle.json", out);
};
run();
