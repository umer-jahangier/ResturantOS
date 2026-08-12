/*
 * F13 STEP 6 — the notice in dark theme, as the cashier, on the same paid check.
 * The class list is not evidence (tailwind-merge silently drops utilities) — this reads the
 * COMPUTED colour and the contrast against the surface behind it.
 */
import {
  PEOPLE, newBrowser, newPage, login, shot, saveState, loadState, log,
  openInOrderManagement,
} from "./lib.mjs";

const st = loadState();
const orderNo = process.argv[2] ?? st.orderNo;
log("  order:", orderNo);

const browser = await newBrowser();
const p = await newPage(browser);
await login(p, PEOPLE.cashier);

const probe = async (label) => {
  await openInOrderManagement(p, orderNo);
  await shot(p, label);
  return p.evaluate(() => {
    const n = document.querySelector("[data-testid=void-blocked-paid-notice]");
    if (!n) return null;
    const cs = getComputedStyle(n);
    // Walk up for the first non-transparent background — the surface the text sits on.
    let el = n, bg = "rgba(0, 0, 0, 0)";
    while (el && el !== document.documentElement) {
      const c = getComputedStyle(el).backgroundColor;
      if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) { bg = c; break; }
      el = el.parentElement;
    }
    /*
     * The tokens resolve to oklch(), which a regex over "rgb(...)" reads as nothing and then
     * reports as a 1:1 contrast failure — a measurement artefact that looks exactly like a
     * finding. Paint each colour on a canvas and read the sRGB bytes back instead.
     */
    const toRgb = (c) => {
      const cv = document.createElement("canvas");
      cv.width = cv.height = 1;
      const ctx = cv.getContext("2d");
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const lum = (c) => {
      const [r, g, b] = toRgb(c).map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const l1 = lum(cs.color), l2 = lum(bg);
    const ratio = l1 !== null && l2 !== null
      ? +(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2)) : null;
    return {
      theme: document.documentElement.className,
      text: n.textContent.trim(),
      color: cs.color, fontSize: cs.fontSize, bg, contrast: ratio,
    };
  });
};

const light = await probe("06a-cashier-light");
log("  LIGHT:", JSON.stringify(light));

await p.evaluate(() => {
  localStorage.setItem("theme", "dark");
  document.documentElement.classList.remove("light");
  document.documentElement.classList.add("dark");
});
await p.reload({ waitUntil: "domcontentloaded" });
await p.waitForTimeout(4000);
const dark = await probe("06b-cashier-dark");
log("  DARK :", JSON.stringify(dark));

saveState({ themeLight: light, themeDark: dark });
const ok = (t) => t && t.contrast !== null && t.contrast >= 4.5;
log(`  light contrast ${light?.contrast} → ${ok(light) ? "PASS" : "BELOW 4.5:1"}`);
log(`  dark  contrast ${dark?.contrast} → ${ok(dark) ? "PASS" : "BELOW 4.5:1"}`);
await browser.close();
