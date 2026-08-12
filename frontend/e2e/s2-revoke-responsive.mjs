/*
 * S2 — responsive + theme evidence for the Roles-by-branch panel, with the overflow ASSERTED.
 *
 * The first proof run shot 390 and filed it; looking at the picture showed a row that overflowed
 * its card, the branch name squeezed to "F.." and the Revoke button clipped to "Revok". A
 * screenshot nobody measures is not evidence, so this one reads geometry: every role row's
 * scrollWidth must fit its clientWidth, the branch name must be non-empty, and the button's full
 * label must be inside its own box. Computed style, never the class list — `cn()`/tailwind-merge
 * has silently dropped utilities here before.
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
      console.log(`  ✓ signed in as ${who.email}`);
      return page;
    } catch {
      await page.waitForTimeout(31_000);
    }
  }
  throw new Error(`login failed for ${who.email}`);
}

async function selectUser(page, email) {
  const search = page
    .locator('input[type="search"], input[placeholder*="Search" i], input[aria-label*="Search" i]')
    .first();
  if (await search.count()) {
    await search.fill(email);
    await page.waitForTimeout(2500);
  }
  await page.getByText(email, { exact: false }).first().click();
  await page.waitForTimeout(2500);
}

const browser = await newBrowser();
try {
  const page = await newPage(browser);
  await login(page, PEOPLE.owner);
  await page.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const token = await tokenOf(page);
  const branches = (await apiGet(page, "/api/v1/branches", token)).body?.data ?? [];
  const rooftop = branches.find((b) => /rooftop/i.test(b.name ?? ""));
  const hq = branches.find((b) => !/rooftop/i.test(b.name ?? ""));

  const stamp = Date.now();
  const email = `s2.resp.${stamp}@terrace.local`;
  const created = await apiSend(
    page,
    "POST",
    "/api/v1/users",
    { email, fullName: "S2 Responsive Subject", branchId: hq.id, roleCode: "CASHIER" },
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
  log("fixture", { email, hq: hq.name, rooftop: rooftop.name });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await selectUser(page, email);

  const results = {};
  for (const [w, h] of [
    [390, 844],
    [768, 1024],
    [1440, 950],
  ]) {
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width: w, height: h });
      await page.emulateMedia({ colorScheme: theme });
      await page.evaluate((t) => {
        document.documentElement.classList.toggle("dark", t === "dark");
        document.documentElement.setAttribute("data-theme", t);
      }, theme);
      await page.waitForTimeout(1000);

      const geometry = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('[data-testid^="revoke-role-"]'));
        const rows = buttons.map((b) => b.closest("li")).filter(Boolean);
        const doc = document.documentElement;
        return {
          rows: rows.map((li) => {
            const nameSpan = li.firstElementChild;
            const btn = li.querySelector('[data-testid^="revoke-role-"]');
            const liBox = li.getBoundingClientRect();
            const btnBox = btn.getBoundingClientRect();
            const cs = getComputedStyle(btn);
            return {
              rowOverflows: li.scrollWidth > li.clientWidth + 1,
              branchName: (nameSpan?.textContent ?? "").trim(),
              branchNameClipped: nameSpan
                ? nameSpan.scrollWidth > nameSpan.clientWidth + 1
                : true,
              buttonWithinRow:
                btnBox.left >= liBox.left - 1 && btnBox.right <= liBox.right + 1,
              buttonLabelClipped: btn.scrollWidth > btn.clientWidth + 1,
              buttonColor: cs.color,
              buttonHeight: Math.round(btnBox.height),
            };
          }),
          // The page body must never scroll horizontally.
          documentOverflowsX: doc.scrollWidth > doc.clientWidth + 1,
        };
      });
      results[`${w}-${theme}`] = geometry;
      await page.screenshot({ path: `${OUT}/p10-panel-${w}-${theme}.png`, fullPage: false });
      console.log(`    shot: p10-panel-${w}-${theme}.png`);
    }
  }
  log("geometry", results);

  const bad = Object.entries(results).flatMap(([k, g]) => {
    const problems = [];
    if (g.documentOverflowsX) problems.push(`${k}: page scrolls horizontally`);
    g.rows.forEach((r, i) => {
      if (r.rowOverflows) problems.push(`${k} row${i}: overflows`);
      if (!r.branchName) problems.push(`${k} row${i}: branch name empty`);
      if (r.branchNameClipped) problems.push(`${k} row${i}: branch name clipped (${r.branchName})`);
      if (!r.buttonWithinRow) problems.push(`${k} row${i}: revoke button outside the row`);
      if (r.buttonLabelClipped) problems.push(`${k} row${i}: revoke label clipped`);
    });
    return problems;
  });
  log("VERDICT_problems", bad);
  log("VERDICT", bad.length === 0 ? "PASS at 390/768/1440 in both themes" : "FAIL");

  // The colour is a claim about the design token, so read it computed rather than from the class.
  const lightVsDark = {
    light: results["1440-light"].rows[0]?.buttonColor,
    dark: results["1440-dark"].rows[0]?.buttonColor,
  };
  log("destructiveColorResolvesPerTheme", {
    ...lightVsDark,
    differsBetweenThemes: lightVsDark.light !== lightVsDark.dark,
  });

  await page.close();
} catch (e) {
  journal.error = String(e);
  console.error(e);
} finally {
  writeFileSync(`${OUT}/_responsive.json`, JSON.stringify(journal, null, 2));
  await browser.close();
}
