/*
 * RED TEAM #9 — final two checks.
 *  a) Full vendor GET body: is RTPERSIST truly absent, or was my log just truncated?
 *     Also re-create once more and count vendors before/after across a reload.
 *  b) The prior audit measured the DIALOG BOX at 390x844 (clipTop=0/clipBottom=0) and called it
 *     WORKS. The box is `overflow-y: visible`, so its CHILDREN can sit outside it unmeasured.
 *     Measure the CHILDREN at 390x844 and at 768.
 */
import { go, login, browser, save, shot, openDialog, BASE } from "./rt-lib.mjs";

const CHILDCLIP = () => {
  const d = document.querySelector('[data-slot="dialog-content"]');
  if (!d) return null;
  const dr = d.getBoundingClientRect();
  const vh = window.innerHeight;
  const kids = [...d.querySelectorAll("label,input,select,textarea,button,h2,p,div")].filter((e) => e.getBoundingClientRect().height > 0);
  const below = kids.filter((e) => e.getBoundingClientRect().top >= vh);
  const partially = kids.filter((e) => { const r = e.getBoundingClientRect(); return r.top < vh && r.bottom > vh; });
  const lowest = kids.reduce((m, e) => Math.max(m, e.getBoundingClientRect().bottom), 0);
  const named = (arr) => arr.slice(0, 8).map((e) => ({ tag: e.tagName.toLowerCase(), n: e.getAttribute("name") || (e.textContent || "").trim().slice(0, 26), top: Math.round(e.getBoundingClientRect().top) }));
  return {
    vh,
    dialogBox: { top: Math.round(dr.top), bottom: Math.round(dr.bottom), h: Math.round(dr.height) },
    dialogBoxClipTop: Math.max(0, Math.round(-dr.top)),
    dialogBoxClipBottom: Math.max(0, Math.round(dr.bottom - vh)),
    overflowY: getComputedStyle(d).overflowY,
    dialogScrollable: d.scrollHeight > d.clientHeight + 2,
    pageScrollable: document.documentElement.scrollHeight > vh,
    lowestChildBottom: Math.round(lowest),
    childrenFullyBelowViewport: below.length,
    childrenStraddling: partially.length,
    examplesBelow: named(below),
    // is the required "Stock unit" select reachable?
    stockUnitTop: (() => { const s = d.querySelector('[name="stockUnitCode"], [name="stockUnit"]'); return s ? Math.round(s.getBoundingClientRect().top) : null; })(),
  };
};

const run = async () => {
  const out = {};

  // ---------- (a) ----------
  {
    const { b, page } = await browser(1440, 900);
    let listBody = null;
    page.on("response", async (r) => {
      if (r.request().method() === "GET" && r.url().includes("/api/v1/purchasing/vendors")) {
        try { listBody = await r.text(); } catch {}
      }
    });
    const a = await login(page, "owner"); if (!a.ok) process.exit(1);
    await go(page, "/app/purchasing/vendors", "owner", { wait: 4500 });
    out.vendorListFull = listBody;
    out.vendorNamesFromApi = (() => {
      try { return JSON.parse(listBody).data.map((v) => ({ name: v.name, email: v.email })); } catch { return "unparsed"; }
    })();
    out.rtInApi = JSON.stringify(out.vendorNamesFromApi).includes("RTPERSIST") || JSON.stringify(out.vendorNamesFromApi).includes("RTBAD");
    console.log("VENDORS FROM API:", JSON.stringify(out.vendorNamesFromApi));
    console.log("RT vendors present in API list:", out.rtInApi);
    await b.close();
  }

  // ---------- (b) ----------
  for (const [w, h] of [[390, 844], [768, 1024], [1440, 900]]) {
    const { b, page } = await browser(w, h);
    const a = await login(page, "owner"); if (!a.ok) process.exit(1);
    await go(page, "/app/inventory/ingredients", "owner", { wait: 3500 });
    const o = await openDialog(page, "Add ingredient");
    if (!o.opened) { console.log(w, "dialog did not open"); await b.close(); continue; }
    const m = await page.evaluate(CHILDCLIP);
    out[`clip_${w}x${h}`] = m;
    await shot(page, `ingredient-children-${w}x${h}`, "clip");
    console.log(`${w}x${h}`, "boxClipBottom=" + m.dialogBoxClipBottom, "overflowY=" + m.overflowY,
      "dialogScrollable=" + m.dialogScrollable, "pageScrollable=" + m.pageScrollable,
      "lowestChildBottom=" + m.lowestChildBottom, "childrenBelowViewport=" + m.childrenFullyBelowViewport,
      "stockUnitTop=" + m.stockUnitTop);
    console.log("   examplesBelow:", JSON.stringify(m.examplesBelow));
    await b.close();
  }

  save("final.json", out);
};
run();
