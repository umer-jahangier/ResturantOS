/*
 * S5 — REPRODUCTION. Branch management routes + branch switcher persistence.
 *
 * Run: node e2e/floor/s5-repro.mjs
 */
import { newBrowser, newPage, login, PEOPLE, go, shot, apiGet, tokenOf } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S5");
mkdirSync(OUT, { recursive: true });

function decode(tok) {
  if (!tok) return null;
  const p = tok.split(".")[1];
  return JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
}

const ROUTES = [
  "/app/branches",
  "/app/settings/branches",
  "/app/branch",
  "/app/locations",
  "/app/admin/branches",
];

const out = { routes: {}, sidebar: [], switcher: {}, api: {} };

const browser = await newBrowser();
const page = await newPage(browser);
await login(page, PEOPLE.owner);

// ── sidebar entries ───────────────────────────────────────────────────────────
await go(page, "/app/dashboard");
out.sidebar = await page.evaluate(() =>
  Array.from(document.querySelectorAll("nav a")).map((a) => ({
    text: (a.textContent || "").trim(),
    href: a.getAttribute("href"),
  })),
);
console.log("sidebar hrefs mentioning branch:",
  out.sidebar.filter((s) => /branch/i.test(s.href || "") || /branch/i.test(s.text)));

// ── candidate routes ──────────────────────────────────────────────────────────
for (const r of ROUTES) {
  const t = await go(page, r, { allowTrouble: true });
  const body = await page.evaluate(() => (document.body.innerText || "").slice(0, 240));
  out.routes[r] = { bad: t.bad, alerts: t.alerts, body };
  console.log(`  ${r} → ${JSON.stringify(t.bad)} :: ${body.replace(/\n/g, " | ").slice(0, 110)}`);
}
await go(page, "/app/branches", { allowTrouble: true });
await shot(page, "../floor/S5/repro-01-app-branches-404");

// ── API surface ───────────────────────────────────────────────────────────────
const tok0 = await tokenOf(page);
out.api.token0 = decode(tok0);
console.log("token branch claim at login:", out.api.token0?.branch_id ?? out.api.token0?.branchId);
out.api.list = await apiGet(page, "/api/v1/branches", tok0);
out.api.mine = await apiGet(page, "/api/v1/branches/mine", tok0);
console.log("GET /api/v1/branches →", out.api.list.status, JSON.stringify(out.api.list.body).slice(0, 500));
console.log("GET /api/v1/branches/mine →", out.api.mine.status, JSON.stringify(out.api.mine.body).slice(0, 400));
console.log("owner permissions include branch.manage?",
  (out.api.token0?.permissions || []).includes("branch.manage"),
  "| rbac.manage?", (out.api.token0?.permissions || []).includes("rbac.manage"));

// ── switcher: switch, then reload ─────────────────────────────────────────────
await go(page, "/app/dashboard");
const trigger = page.locator('button[aria-label="Switch branch"]');
out.switcher.present = await trigger.count();
if (out.switcher.present) {
  out.switcher.before = (await trigger.first().textContent())?.trim();
  console.log("switcher label before:", out.switcher.before);
  await trigger.first().click();
  await page.waitForTimeout(600);
  const items = page.locator('[role="menuitem"]');
  const labels = await items.allTextContents();
  out.switcher.options = labels.map((l) => l.trim());
  console.log("switcher options:", out.switcher.options);
  // pick the one that is not current
  const target = out.switcher.options.findIndex((l) => l && !out.switcher.before?.includes(l));
  await items.nth(target >= 0 ? target : 1).click();
  await page.waitForTimeout(3500);
  out.switcher.afterSwitch = (await trigger.first().textContent())?.trim();
  const tok1 = await tokenOf(page);
  out.switcher.tokenAfterSwitch = decode(tok1)?.branch_id ?? decode(tok1)?.branchId;
  console.log("label after switch:", out.switcher.afterSwitch,
    "| refresh-derived token branch:", out.switcher.tokenAfterSwitch);
  await shot(page, "../floor/S5/repro-02-after-switch");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  out.switcher.afterReload = (await trigger.first().textContent())?.trim();
  const tok2 = await tokenOf(page);
  out.switcher.tokenAfterReload = decode(tok2)?.branch_id ?? decode(tok2)?.branchId;
  console.log("label after reload:", out.switcher.afterReload,
    "| token branch after reload:", out.switcher.tokenAfterReload);
  await shot(page, "../floor/S5/repro-03-after-reload");
}

writeFileSync(resolve(OUT, "repro.json"), JSON.stringify(out, null, 2));
await browser.close();
console.log("\nwrote", resolve(OUT, "repro.json"));
