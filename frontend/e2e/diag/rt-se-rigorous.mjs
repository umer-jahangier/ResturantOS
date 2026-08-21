/*
 * RED TEAM #11 — I nearly filed a false positive: the ingredient dialog HAS an inner
 * `max-h-[65vh] overflow-y-auto` form that scrolls. Redo the 375x667 case properly:
 * scroll the inner form and check every control is actually reachable and clickable.
 */
import { go, login, browser, save, shot, openDialog } from "./rt-lib.mjs";

const run = async () => {
  const out = {};
  for (const [w, h, label] of [[375, 667, "iphone-se"], [390, 844, "iphone-14"], [360, 640, "android-small"]]) {
    const { b, page } = await browser(w, h);
    const a = await login(page, "owner"); if (!a.ok) process.exit(1);
    await go(page, "/app/inventory/ingredients", "owner", { wait: 3500 });
    const o = await openDialog(page, "Add ingredient");
    if (!o.opened) { out[label] = { opened: false }; await b.close(); continue; }

    const geom = await page.evaluate(() => {
      const d = document.querySelector('[data-slot="dialog-content"]');
      const f = d.querySelector("form");
      const dr = d.getBoundingClientRect();
      return {
        vh: window.innerHeight,
        dialog: { top: Math.round(dr.top), bottom: Math.round(dr.bottom), h: Math.round(dr.height) },
        clipTop: Math.max(0, Math.round(-dr.top)),
        clipBottom: Math.max(0, Math.round(dr.bottom - window.innerHeight)),
        innerForm: f ? { maxH: getComputedStyle(f).maxHeight, overflowY: getComputedStyle(f).overflowY, scrollH: f.scrollHeight, clientH: f.clientHeight, canScroll: f.scrollHeight > f.clientHeight + 2 } : null,
        pageScrollable: document.documentElement.scrollHeight > window.innerHeight,
      };
    });

    // Reachability: can every named control be scrolled into view AND clicked?
    const names = await page.evaluate(() => {
      const d = document.querySelector('[data-slot="dialog-content"]');
      return [...d.querySelectorAll("input[name],select[name],textarea[name]")].map((e) => e.name);
    });
    const reach = [];
    for (const n of names) {
      const loc = page.locator(`[data-slot="dialog-content"] [name="${n}"]`).first();
      let ok = true, why = null;
      try {
        await loc.scrollIntoViewIfNeeded({ timeout: 4000 });
        const box = await loc.boundingBox();
        ok = !!box && box.y >= 0 && box.y + box.height <= h;
        if (!ok) why = `box=${JSON.stringify(box)} vh=${h}`;
      } catch (e) { ok = false; why = String(e).slice(0, 90); }
      reach.push({ name: n, reachable: ok, why });
    }

    // The primary action + the close (X) button
    const submitReach = await (async () => {
      const s = page.locator('[data-slot="dialog-content"] button[type="submit"]').first();
      try {
        await s.scrollIntoViewIfNeeded({ timeout: 4000 });
        const bx = await s.boundingBox();
        return { found: true, box: bx, inViewport: !!bx && bx.y >= 0 && bx.y + bx.height <= h };
      } catch (e) { return { found: false, err: String(e).slice(0, 90) }; }
    })();
    const closeReach = await page.evaluate((vh) => {
      const d = document.querySelector('[data-slot="dialog-content"]');
      const c = [...d.querySelectorAll("button")].find((e) => /close/i.test(e.getAttribute("aria-label") || e.textContent || ""));
      if (!c) return { found: false };
      const r = c.getBoundingClientRect();
      return { found: true, top: Math.round(r.top), bottom: Math.round(r.bottom), fullyVisible: r.top >= 0 && r.bottom <= vh };
    }, h);

    out[label] = { w, h, geom, reach, unreachable: reach.filter((r) => !r.reachable), submitReach, closeReach };
    await shot(page, `ingredient-${label}`, "se-rigorous");
    console.log(`== ${label} ${w}x${h} dialogH=${geom.dialog.h} clipTop=${geom.clipTop} clipBottom=${geom.clipBottom} innerScroll=${geom.innerForm?.canScroll} (maxH ${geom.innerForm?.maxH}, ${geom.innerForm?.scrollH}/${geom.innerForm?.clientH})`);
    console.log(`   fields=${reach.length} unreachable=${out[label].unreachable.length}`, JSON.stringify(out[label].unreachable.slice(0, 5)));
    console.log(`   submit inViewport=${submitReach.inViewport} box=${JSON.stringify(submitReach.box)} | closeBtn fullyVisible=${closeReach.fullyVisible} top=${closeReach.top}`);
    await b.close();
  }
  save("se-rigorous.json", out);
};
run();
