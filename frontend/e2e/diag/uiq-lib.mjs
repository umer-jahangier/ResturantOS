/*
 * Shared login + measurement library for the UI/UX system-quality diagnosis.
 *
 * Two traps this file exists to avoid:
 *  1. Screenshotting an error state and filing it as "the empty product". Every capture
 *     retries while [role="alert"] / "Couldn't load" is on screen and REPORTS the retry.
 *  2. Screenshotting an Access-denied page as a missing feature. Every capture records
 *     whether the body matched a refusal, and the caller decides.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const BASE = "http://localhost:3000";
export const OUT = resolve(
  process.cwd(),
  "../.planning/audits/diagnosis/ui-system-quality",
);

export const PERSONAS = {
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  storekeeper: { slug: "floating-terrace", email: "storekeeper@terrace.local", password: "Terrace#Storekeeper1" },
  owner: {
    slug: "floating-terrace",
    email: "owner@terrace.local",
    password: "Terrace#Owner1",
    totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
  },
  superadmin: { slug: "", email: "superadmin@softxlogic.com", password: "Test@123!" },
};

const REFUSAL = /Access denied|You do not have permission|not authorized|Forbidden/i;
const FAILURE = /Couldn.t load|temporarily unavailable|Something went wrong|Try again in a moment/i;

function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const char of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totpNow(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[o] & 0x7f) << 24) | ((hmac[o + 1] & 0xff) << 16) | ((hmac[o + 2] & 0xff) << 8) | (hmac[o + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

export async function login(page, persona, tries = 3) {
  for (let i = 1; i <= tries; i += 1) {
    const r = await loginOnce(page, persona);
    if (r.ok) return r;
    // A TOTP code is single-use inside its 30s window; a re-login in the same window is
    // refused and looks exactly like a wrong password. Wait for the next window and retry.
    await page.waitForTimeout(31000);
  }
  return { ok: false, why: `login refused after ${tries} attempts` };
}

async function loginOnce(page, persona) {
  const p = typeof persona === "string" ? PERSONAS[persona] : persona;
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  // 16a unified login: email alone resolves the tenant. Revealing the slug field and filling
  // it makes the submit FAIL — which is how this harness first "proved" the app was down.
  await page.locator('input[name="email"], input#email').first().fill(p.email);
  await page.locator('input[name="password"], input#password').first().fill(p.password);
  await page.locator('button[type="submit"], [data-testid="login-submit"]').first().click();
  await page.waitForTimeout(3000);

  const totpField = page.locator('input[name="totpCode"], [data-testid="totp-code"]');
  if (await totpField.count()) {
    if (!p.totpSecret) return { ok: false, why: "TOTP demanded but no secret for this persona" };
    await totpField.first().fill(totpNow(p.totpSecret));
    await page.locator('button[type="submit"], [data-testid="login-submit"]').first().click();
    await page.waitForTimeout(4000);
  }
  const ok = !page.url().includes("/login");
  return { ok, why: ok ? null : `still on ${page.url()}` };
}

/**
 * Navigate and settle. Retries while the page is an error state, because a screenshot of a
 * 503 looks exactly like a screenshot of an empty product.
 */
export async function settle(page, route, persona, { attempts = 3, wait = 3000 } = {}) {
  let last = null;
  for (let i = 1; i <= attempts; i += 1) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(wait);

    // The session drops mid-sweep (short access token). A login page measured as a product
    // screen is how 20 routes get "audited" as identical minimal shells. Re-auth and retry.
    if (page.url().includes("/login")) {
      const re = await login(page, persona);
      if (!re.ok) return { attempt: i, evicted: true, clean: false, url: page.url(), why: re.why };
      continue;
    }

    const body = await page.locator("body").innerText().catch(() => "");
    const alerts = await page.locator('[role="alert"]').count();
    last = {
      attempt: i,
      alerts,
      refused: REFUSAL.test(body),
      failed: FAILURE.test(body),
      url: page.url(),
    };
    // `[role=alert]` alone is NOT failure — dashboards use live regions for legitimate content.
    // Only the error COPY means the screen is degraded.
    if (!last.failed) return { ...last, clean: !last.refused };
  }
  return { ...(last || { attempt: attempts }), clean: false };
}

export async function shot(page, name, sub = "") {
  const file = sub ? `${OUT}/${sub}/${name}.png` : `${OUT}/${name}.png`;
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

export function saveJson(name, data) {
  const file = `${OUT}/${name}`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

/** Everything measurable about the current page's design-system conformance. */
export const PROBE = () => {
  const px = (v) => Math.round(parseFloat(v) || 0);
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const tally = (arr) => {
    const m = {};
    for (const k of arr) m[k] = (m[k] || 0) + 1;
    return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
  };

  const buttons = [...document.querySelectorAll("button")].filter(vis);
  const btnGeom = buttons.map((b) => {
    const cs = getComputedStyle(b);
    return {
      h: px(cs.height),
      r: cs.borderRadius,
      fs: px(cs.fontSize),
      bg: cs.backgroundColor,
      fw: cs.fontWeight,
    };
  });

  const texts = [...document.querySelectorAll("p,span,div,td,th,label,h1,h2,h3,h4,a,button")]
    .filter((el) => vis(el) && el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  const fontSizes = texts.map((el) => px(getComputedStyle(el).fontSize));

  const tables = [...document.querySelectorAll("table")].filter(vis);
  const grids = document.querySelectorAll('[data-slot="data-grid"],[data-testid="data-grid"]').length;

  // Badge-ish: small pill elements
  const badges = [...document.querySelectorAll("span,div")].filter((el) => {
    if (!vis(el)) return false;
    const cs = getComputedStyle(el);
    const r = px(cs.borderRadius);
    const h = px(cs.height);
    return h > 0 && h <= 32 && r >= 8 && cs.backgroundColor !== "rgba(0, 0, 0, 0)" && el.textContent.trim().length > 0 && el.textContent.trim().length < 24;
  });

  const de = document.documentElement;
  return {
    title: document.title,
    h1: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim()).filter(Boolean),
    h1Count: document.querySelectorAll("h1").length,
    dark: de.classList.contains("dark"),
    // horizontal overflow: the page body must never scroll sideways
    scrollW: de.scrollWidth,
    clientW: de.clientWidth,
    overflowX: de.scrollWidth - de.clientWidth,
    widestOverflower: (() => {
      let worst = null;
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > de.clientWidth + 2) {
          const over = Math.round(r.right - de.clientWidth);
          if (!worst || over > worst.over) {
            worst = { over, tag: el.tagName.toLowerCase(), cls: (el.className || "").toString().slice(0, 90) };
          }
        }
      }
      return worst;
    })(),
    buttons: { n: buttons.length, heights: tally(btnGeom.map((b) => b.h)), radii: tally(btnGeom.map((b) => b.r)), fontSizes: tally(btnGeom.map((b) => b.fs)) },
    fontSizes: tally(fontSizes),
    distinctFontSizes: new Set(fontSizes).size,
    fontFamilies: tally(texts.map((el) => getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, ""))),
    tables: { n: tables.length, dataGrids: grids },
    tableRadii: tally(tables.map((t) => getComputedStyle(t).borderRadius)),
    badges: { n: badges.length, radii: tally(badges.map((b) => getComputedStyle(b).borderRadius)) },
    skeletons: document.querySelectorAll('[data-slot="skeleton"],.animate-pulse').length,
    spinners: document.querySelectorAll(".animate-spin").length,
    emptyStates: document.querySelectorAll('[data-slot="empty-state"],[data-testid="empty-state"]').length,
    alerts: document.querySelectorAll('[role="alert"]').length,
    inputs: (() => {
      const list = [...document.querySelectorAll("input,select,textarea")].filter(vis);
      const unlabelled = list.filter((el) => {
        if (el.type === "hidden") return false;
        if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")) return false;
        if (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) return false;
        return !el.closest("label");
      });
      return {
        n: list.length,
        rawSelects: list.filter((e) => e.tagName === "SELECT").length,
        unlabelled: unlabelled.length,
        unlabelledDetail: unlabelled.slice(0, 6).map((e) => `${e.tagName.toLowerCase()}[${e.type || ""}]${e.name ? "#" + e.name : ""}`),
        placeholderAsLabel: list.filter((el) => el.placeholder && !el.getAttribute("aria-label") && !(el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`))).length,
        heights: tally(list.map((el) => px(getComputedStyle(el).height))),
      };
    })(),
    // touch targets: WCAG 2.2 AA wants >=24px, Apple/Material want 44px for a POS terminal
    touchTargets: (() => {
      const ctrl = [...document.querySelectorAll("button,a[href],input,select,[role=button]")].filter(vis);
      const small = ctrl.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height < 44 || r.width < 44;
      });
      const tiny = ctrl.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.height < 24 || r.width < 24;
      });
      return { n: ctrl.length, under44: small.length, under24: tiny.length };
    })(),
  };
};
