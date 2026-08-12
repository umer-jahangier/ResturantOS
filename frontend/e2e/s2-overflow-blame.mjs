/*
 * S2 — WHO overflows at 390 on /app/users?
 *
 * The responsive harness asserted each role ROW fits inside its own card and passed, and the
 * screenshot still showed the page clipped at the right edge — the search field, the "Active only"
 * checkbox, the "Add user" button and the Revoke button all cut off. So the row was the wrong unit
 * to measure. This walks every element and reports the ones whose right edge is outside the
 * viewport, with their ancestor chain, so the blame lands on the element that is actually too wide
 * instead of on the last thing that changed.
 *
 * It measures the panel with the Revoke control present AND with the same page as a persona that
 * does not get the control, so "did S2 cause this" has an answer rather than an opinion.
 */
import { PEOPLE, newBrowser, newPage, apiGet, apiSend, tokenOf, totpNow } from "./shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/S2");
mkdirSync(OUT, { recursive: true });

const journal = {};
const log = (k, v) => {
  journal[k] = v;
  console.log(`  · ${k} = ${JSON.stringify(v)}`);
};

async function login(page, who) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await slug.count()) await slug.first().fill(who.slug);
    await page.locator('input[name="email"], input#email').first().fill(who.email);
    await page.locator('input[name="password"], input#password').first().fill(who.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(3000);
    const totp = page.locator('input[name="totpCode"], input#totpCode');
    if (await totp.count()) {
      await totp.first().fill(totpNow(who.totpSecret));
      await page.locator('button[type="submit"]').first().click();
    }
    try {
      await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 45_000 });
      await page.waitForTimeout(2500);
      return page;
    } catch {
      await page.waitForTimeout(31_000);
    }
  }
  throw new Error(`login failed for ${who.email}`);
}

const OFFENDERS = `() => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= vw + 1) continue;
    // Report the SHALLOWEST offenders: if a parent already overflows, the child is a symptom.
    if (el.parentElement) {
      const pr = el.parentElement.getBoundingClientRect();
      if (pr.right > vw + 1) continue;
    }
    let path = [];
    for (let n = el; n && n !== document.body && path.length < 5; n = n.parentElement) {
      path.push(n.tagName.toLowerCase() + (n.getAttribute("data-slot") ? "[" + n.getAttribute("data-slot") + "]" : ""));
    }
    out.push({
      tag: el.tagName.toLowerCase(),
      testid: el.getAttribute("data-testid") || null,
      slot: el.getAttribute("data-slot") || null,
      text: (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 50),
      right: Math.round(r.right),
      viewport: vw,
      overhang: Math.round(r.right - vw),
      path: path.join(" < "),
    });
  }
  return {
    viewport: vw,
    bodyScrollWidth: document.body.scrollWidth,
    docScrollWidth: document.documentElement.scrollWidth,
    offenders: out.slice(0, 12),
  };
}`;

const browser = await newBrowser();
try {
  const page = await newPage(browser);
  await login(page, PEOPLE.owner);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  // (a) The roster page with NOTHING selected — no detail panel, no Revoke control at all.
  log("A_rosterOnly_390", await page.evaluate(eval(`(${OFFENDERS})`)));
  await page.screenshot({ path: `${OUT}/p11-roster-only-390.png` });

  // (b) A page S2 never touched, as a control for "is /app/users special".
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  log("B_dashboard_390", await page.evaluate(eval(`(${OFFENDERS})`)));

  // (c) The panel WITH the control.
  await page.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const token = await tokenOf(page);
  const branches = (await apiGet(page, "/api/v1/branches", token)).body?.data ?? [];
  const rooftop = branches.find((b) => /rooftop/i.test(b.name ?? ""));
  const hq = branches.find((b) => !/rooftop/i.test(b.name ?? ""));
  const email = `s2.blame.${Date.now()}@terrace.local`;
  const created = await apiSend(
    page,
    "POST",
    "/api/v1/users",
    { email, fullName: "S2 Blame Subject", branchId: hq.id, roleCode: "CASHIER" },
    token,
  );
  const subjectId = created.body?.data?.id ?? created.body?.data?.userId;
  await apiSend(
    page,
    "POST",
    `/api/v1/users/${subjectId}/branch-roles`,
    { branchId: rooftop.id, roleCode: "MANAGER", approvalLimitPaisa: 500000 },
    token,
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const search = page
    .locator('input[type="search"], input[placeholder*="Search" i], input[aria-label*="Search" i]')
    .first();
  if (await search.count()) {
    await search.fill(email);
    await page.waitForTimeout(2500);
  }
  await page.getByText(email, { exact: false }).first().click();
  await page.waitForTimeout(2500);
  log("C_panelWithRevoke_390", await page.evaluate(eval(`(${OFFENDERS})`)));
  await page.screenshot({ path: `${OUT}/p12-panel-with-revoke-390.png` });

  await page.close();
} catch (e) {
  journal.error = String(e);
  console.error(e);
} finally {
  writeFileSync(`${OUT}/_overflow-blame.json`, JSON.stringify(journal, null, 2));
  await browser.close();
}
