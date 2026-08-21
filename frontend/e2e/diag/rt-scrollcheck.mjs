/*
 * RED TEAM #10 — before claiming the ingredient dialog is unreachable, rule out an INNER
 * scroll container. Find every scrollable descendant, then actually try to reach the
 * bottom-most control by scrolling and by keyboard Tab, and screenshot the result.
 */
import { go, login, browser, save, shot, openDialog } from "./rt-lib.mjs";

const SCROLLERS = () => {
  const d = document.querySelector('[data-slot="dialog-content"]');
  if (!d) return null;
  const all = [d, ...d.querySelectorAll("*")];
  const scrollers = all.filter((e) => {
    const cs = getComputedStyle(e);
    return /auto|scroll/.test(cs.overflowY) || e.scrollHeight > e.clientHeight + 2;
  }).map((e) => ({
    tag: e.tagName.toLowerCase(),
    cls: (e.className || "").toString().slice(0, 70),
    overflowY: getComputedStyle(e).overflowY,
    maxHeight: getComputedStyle(e).maxHeight,
    scrollH: e.scrollHeight, clientH: e.clientHeight,
    canScroll: e.scrollHeight > e.clientHeight + 2,
  }));
  const dr = d.getBoundingClientRect();
  return {
    dialogBox: { top: Math.round(dr.top), bottom: Math.round(dr.bottom), h: Math.round(dr.height) },
    dialogMaxHeight: getComputedStyle(d).maxHeight,
    dialogOverflowY: getComputedStyle(d).overflowY,
    vh: window.innerHeight,
    scrollers,
  };
};

const run = async () => {
  const out = {};
  const { b, page } = await browser(1440, 900);
  const a = await login(page, "owner"); if (!a.ok) process.exit(1);
  await go(page, "/app/inventory/ingredients", "owner", { wait: 3500 });
  const o = await openDialog(page, "Add ingredient");
  if (!o.opened) { console.log("no dialog"); await b.close(); return; }

  out.scrollers = await page.evaluate(SCROLLERS);
  console.log("SCROLL SURVEY:", JSON.stringify(out.scrollers, null, 1));

  // Where is the submit button and the allergen grid before any scrolling?
  out.before = await page.evaluate(() => {
    const d = document.querySelector('[data-slot="dialog-content"]');
    const find = (re) => [...d.querySelectorAll("button,label,select,input")].find((e) => re.test(e.textContent || e.getAttribute("name") || ""));
    const box = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.top >= 0 && r.bottom <= window.innerHeight }; };
    return {
      submit: box(d.querySelector('button[type="submit"]')),
      allergenGluten: box(find(/^Gluten$/)),
      storageLocation: box(d.querySelector('[name="storageLocationId"]')),
      shelfLife: box(d.querySelector('[name="shelfLifeDays"]')),
      vh: window.innerHeight,
    };
  });
  console.log("BEFORE SCROLL:", JSON.stringify(out.before));
  await shot(page, "ingredient-1440-initial", "scrollcheck");

  // try wheel over the dialog
  await page.mouse.move(720, 500);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(900);
  out.afterWheel = await page.evaluate(() => {
    const d = document.querySelector('[data-slot="dialog-content"]');
    const r = d.getBoundingClientRect();
    const s = d.querySelector('button[type="submit"]');
    const sr = s ? s.getBoundingClientRect() : null;
    const gluten = [...d.querySelectorAll("button")].find((e) => /^Gluten$/.test(e.textContent || ""));
    const gr = gluten ? gluten.getBoundingClientRect() : null;
    return {
      dialogTop: Math.round(r.top), winY: window.scrollY, dialogScrollTop: d.scrollTop,
      submitTop: sr ? Math.round(sr.top) : null,
      glutenTop: gr ? Math.round(gr.top) : null,
      glutenInView: gr ? gr.top >= 0 && gr.bottom <= window.innerHeight : null,
    };
  });
  console.log("AFTER WHEEL:", JSON.stringify(out.afterWheel));
  await shot(page, "ingredient-1440-after-wheel", "scrollcheck");

  // try keyboard: Tab until the allergen button gets focus, see if it scrolls into view
  let reached = false;
  for (let i = 0; i < 60 && !reached; i += 1) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => {
      const a2 = document.activeElement;
      return !!(a2 && /^Gluten$/.test((a2.textContent || "").trim()));
    });
  }
  out.tabReachedGluten = reached;
  out.afterTab = await page.evaluate(() => {
    const d = document.querySelector('[data-slot="dialog-content"]');
    const g = [...d.querySelectorAll("button")].find((e) => /^Gluten$/.test(e.textContent || ""));
    const gr = g ? g.getBoundingClientRect() : null;
    return {
      focused: (document.activeElement?.textContent || "").trim().slice(0, 24),
      glutenTop: gr ? Math.round(gr.top) : null,
      glutenInView: gr ? gr.top >= 0 && gr.bottom <= window.innerHeight : null,
      dialogTop: Math.round(d.getBoundingClientRect().top),
      winY: window.scrollY, dialogScrollTop: d.scrollTop,
    };
  });
  console.log("TAB reachedGluten=", reached, JSON.stringify(out.afterTab));
  await shot(page, "ingredient-1440-after-tab", "scrollcheck");

  // playwright's own scrollIntoViewIfNeeded — the most generous possible attempt
  const g = page.getByRole("button", { name: /^Gluten$/ }).first();
  out.glutenExists = (await g.count()) > 0;
  if (out.glutenExists) {
    await g.scrollIntoViewIfNeeded().catch((e) => { out.scrollIntoViewError = String(e).slice(0, 200); });
    await page.waitForTimeout(800);
    out.afterScrollIntoView = await page.evaluate(() => {
      const d = document.querySelector('[data-slot="dialog-content"]');
      const g2 = [...d.querySelectorAll("button")].find((e) => /^Gluten$/.test(e.textContent || ""));
      const gr = g2 ? g2.getBoundingClientRect() : null;
      return { glutenTop: gr ? Math.round(gr.top) : null, inView: gr ? gr.top >= 0 && gr.bottom <= window.innerHeight : null, winY: window.scrollY, dialogScrollTop: d.scrollTop };
    });
    console.log("AFTER scrollIntoViewIfNeeded:", JSON.stringify(out.afterScrollIntoView), out.scrollIntoViewError || "");
  }
  await shot(page, "ingredient-1440-after-scrollintoview", "scrollcheck");

  save("scrollcheck.json", out);
  await b.close();
};
run();
