/*
 * S1 step 1 — reconnaissance, as OWNER.
 *
 * Reaches /app/menu/routing by CLICKING the sidebar entry (not by typing the URL), then dumps the
 * live state the rest of this item depends on: which stations the branch has, which categories and
 * items exist, and where each item currently fires.
 */
import { PEOPLE, newBrowser, newPage, login, go, shot, apiGet, saveState, log } from "./lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);

try {
  await login(page, PEOPLE.owner);
  await go(page, "/app/dashboard", { waitMs: 3000 });

  // --- reach the screen by clicking the sidebar, the way an owner does -----------------
  const navProbe = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("nav a, aside a"));
    return {
      total: links.length,
      routing: links
        .filter((a) => (a.getAttribute("href") || "").includes("/app/menu/routing"))
        .map((a) => ({ text: (a.textContent || "").trim(), href: a.getAttribute("href") })),
      menuGroup: links
        .filter((a) => (a.getAttribute("href") || "").startsWith("/app/menu"))
        .map((a) => (a.textContent || "").trim()),
    };
  });
  log("  sidebar:", JSON.stringify(navProbe));

  let reachedByClick = false;
  if (navProbe.routing.length === 0) {
    // The group may be collapsed. Expand any "Menu" group trigger, then look again.
    const triggers = page.locator('nav button, aside button');
    const n = await triggers.count();
    for (let i = 0; i < n; i++) {
      const t = (await triggers.nth(i).innerText().catch(() => "")).trim();
      if (/^menu$/i.test(t) || /menu/i.test(t)) {
        await triggers.nth(i).click().catch(() => {});
        await page.waitForTimeout(600);
      }
    }
  }
  const link = page.locator('a[href="/app/menu/routing"]').first();
  if (await link.count()) {
    await shot(page, "01a-sidebar-before-click");
    await link.click();
    await page.waitForTimeout(3500);
    reachedByClick = page.url().includes("/app/menu/routing");
  }
  log(`  reached by sidebar click: ${reachedByClick} — url ${page.url()}`);

  if (!reachedByClick) {
    await go(page, "/app/menu/routing", { waitMs: 3500 });
  }

  const trouble = await page.evaluate(() => {
    const t = document.body.innerText || "";
    return {
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) =>
        (n.textContent || "").trim(),
      ),
      notFound: /This page doesn.t exist/i.test(t),
      accessDenied: /Access denied|You do not have permission/i.test(t),
      summary:
        document.querySelector('[data-testid="routing-summary"]')?.textContent?.trim() ?? null,
    };
  });
  log("  page:", JSON.stringify(trouble));
  await shot(page, "01b-routing-page");

  const board = await page.evaluate(() => {
    const cats = Array.from(document.querySelectorAll('[data-testid="routing-category"]')).map(
      (c) => ({
        name: c.getAttribute("data-category-name"),
        categorySelect:
          c.querySelector('[data-testid="category-station-select"]')?.selectedOptions?.[0]
            ?.textContent ?? null,
        options: Array.from(
          c.querySelector('[data-testid="category-station-select"]')?.options ?? [],
        ).map((o) => o.textContent),
        items: Array.from(c.querySelectorAll('[data-testid="routing-item"]')).map((i) => ({
          name: i.getAttribute("data-item-name"),
          effective: i.getAttribute("data-effective-station"),
          source: i.getAttribute("data-route-source"),
          destinationText:
            i.querySelector('[data-testid="routing-item-destination"]')?.textContent?.trim() ??
            null,
        })),
      }),
    );
    return { categoryCount: cats.length, cats };
  });
  log("  board:", JSON.stringify(board, null, 1).slice(0, 4000));

  const token = null;
  const stations = await apiGet(page, "/api/v1/pos/stations", token);
  log(
    "  POS stations:",
    stations.status,
    JSON.stringify(
      (stations.body?.data ?? stations.body ?? []).map?.((s) => ({
        code: s.code,
        name: s.name,
        type: s.stationType ?? s.type,
        active: s.active,
      })) ?? stations.body,
    ),
  );

  const kds = await apiGet(page, "/api/v1/kitchen/kds/stations?branchId=" + (await page.evaluate(() => localStorage.getItem("branchId") || "")), token);
  log("  KDS stations (owner, no branch param may 400):", kds.status);

  saveState({ recon: { navProbe, trouble, board, posStations: stations.body } });
} catch (e) {
  console.error("FAILED:", e.message);
  await shot(page, "01z-failure");
  process.exitCode = 1;
} finally {
  await browser.close();
}
