/* S1 re-open, step 3: the WRONG personas, the OTHER branch, and the OTHER tenant. */
import {
  newBrowser, newPage, login, PEOPLE, go, shot, log, loadState, writeJson, apiGet, apiSend,
} from "./lib.mjs";

const st = loadState();
const FT_BRANCH = st.branchId;
const results = { personas: [], branch: null, tenant: null };

// A category and an item of Floating Terrace, captured in step 2.
const FT_CATEGORY = "c3d9fa09-d583-4bb3-a552-4c36fe329b56"; // Mains
const FT_ITEM = "23acb4e9-cb07-434d-87f4-de82b3a65ae5"; // Mutton Biryani
const FT_STATION_GRILL = "775962d1-5f0a-451c-acda-a69599351c80";

const browser = await newBrowser();

async function persona(who, label) {
  const page = await newPage(browser);
  try {
    await login(page, who);
    await go(page, "/app/dashboard", { waitMs: 3000 });
    const navCount = await page.locator('a[href="/app/menu/routing"]').count();

    const t = await go(page, "/app/menu/routing", { waitMs: 4000, allowTrouble: true });
    const dom = await page.evaluate(() => ({
      h1: document.querySelector("h1")?.textContent?.trim() ?? null,
      bodyHead: (document.body.innerText || "").slice(0, 260).replace(/\s+/g, " "),
      cats: document.querySelectorAll('[data-testid="routing-category"]').length,
      rows: document.querySelectorAll('[data-testid="routing-item"]').length,
      catSelectsEnabled: Array.from(
        document.querySelectorAll('[data-testid="category-station-select"]'),
      ).filter((n) => !n.disabled).length,
      itemSelectsEnabled: Array.from(
        document.querySelectorAll('[data-testid="item-station-select"]'),
      ).filter((n) => !n.disabled).length,
      alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
    }));
    await shot(page, `03-${label}`);

    // Now bypass the UI entirely: can this persona WRITE routing over the wire?
    const putCat = await apiSend(
      page, "PUT", `/api/v1/pos/menu/categories/${FT_CATEGORY}/station?branchId=${FT_BRANCH}`,
      { stationId: FT_STATION_GRILL },
    );
    const putItem = await apiSend(
      page, "PUT", `/api/v1/pos/menu/items/${FT_ITEM}/station?branchId=${FT_BRANCH}`,
      { stationId: FT_STATION_GRILL },
    );
    const getRouting = await apiGet(page, `/api/v1/pos/menu/routing?branchId=${FT_BRANCH}`);

    const row = {
      label, email: who.email, navCount, dom, trouble: t.bad,
      putCategoryStatus: putCat.status,
      putCategoryBody: JSON.stringify(putCat.body).slice(0, 200),
      putItemStatus: putItem.status,
      getRoutingStatus: getRouting.status,
    };
    results.personas.push(row);
    log(`  [${label}] nav=${navCount} h1=${JSON.stringify(dom.h1)} cats=${dom.cats} rows=${dom.rows} enabledSelects=${dom.catSelectsEnabled}/${dom.itemSelectsEnabled}`);
    log(`      body: ${dom.bodyHead.slice(0, 150)}`);
    log(`      wire: PUT cat=${putCat.status} PUT item=${putItem.status} GET routing=${getRouting.status}`);
  } catch (e) {
    log(`  [${label}] FAILED: ${e.message}`);
    results.personas.push({ label, email: who.email, error: e.message });
  } finally {
    await page.close();
  }
}

try {
  await persona(PEOPLE.manager, "manager");
  await persona(PEOPLE.cashier, "cashier");
  await persona(PEOPLE.waiter, "waiter");
  await persona(PEOPLE.kitchen, "kitchen");

  // ---- THE OTHER BRANCH ----
  {
    const page = await newPage(browser);
    try {
      await login(page, PEOPLE.owner);
      await go(page, "/app/menu/routing", { waitMs: 4000 });
      const beforeBranch = await page.evaluate(() =>
        document.querySelector('[aria-label="Switch branch"]')?.textContent?.trim() ?? null,
      );
      log(`  branch switcher reads: ${JSON.stringify(beforeBranch)}`);

      const trigger = page.locator('[aria-label="Switch branch"]').first();
      if (await trigger.count()) {
        await trigger.click();
        await page.waitForTimeout(900);
        const items = await page.locator('[role="menuitem"]').allInnerTexts();
        log(`  branch menu: ${JSON.stringify(items)}`);
        const rooftop = page.locator('[role="menuitem"]', { hasText: /Rooftop/i }).first();
        if (await rooftop.count()) {
          await rooftop.click();
          await page.waitForTimeout(7000);
          const after = await page.evaluate(() => ({
            url: location.href,
            branch: document.querySelector('[aria-label="Switch branch"]')?.textContent?.trim() ?? null,
            h1: document.querySelector("h1")?.textContent?.trim() ?? null,
            body: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 400),
            cats: document.querySelectorAll('[data-testid="routing-category"]').length,
            rows: document.querySelectorAll('[data-testid="routing-item"]').length,
            alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()),
            catSelects: Array.from(
              document.querySelectorAll('[data-testid="category-station-select"]'),
            ).map((n) => ({ name: n.closest("[data-category-name]")?.getAttribute("data-category-name"), text: n.selectedOptions?.[0]?.text })),
          }));
          await shot(page, "03-rooftop-routing");
          log(`  ROOFTOP: branch=${JSON.stringify(after.branch)} h1=${JSON.stringify(after.h1)} cats=${after.cats} rows=${after.rows}`);
          log(`      body: ${after.body.slice(0, 300)}`);
          log(`      alerts: ${JSON.stringify(after.alerts)}`);
          log(`      cat selects: ${JSON.stringify(after.catSelects.slice(0, 8))}`);
          const rooftopId = st.branches?.find((b) => /Rooftop/i.test(b.name))?.id;
          const wire = await apiGet(page, `/api/v1/pos/menu/routing?branchId=${rooftopId}`);
          const wireOld = await apiGet(page, `/api/v1/pos/menu/routing?branchId=${FT_BRANCH}`);
          log(`      wire rooftop=${wire.status}  wire OLD branch (should now be refused)=${wireOld.status}`);
          results.branch = { after, wireRooftop: wire.status, wireOldBranch: wireOld.status, rooftopId };
        } else {
          log("  no Rooftop entry in the branch menu");
          results.branch = { error: "no rooftop menuitem", items };
        }
      } else {
        log("  NO branch switcher rendered for the owner");
        results.branch = { error: "no switcher" };
      }
    } catch (e) {
      log(`  branch probe failed: ${e.message}`);
      results.branch = { error: e.message };
    } finally {
      await page.close();
    }
  }

  // ---- THE OTHER TENANT ----
  {
    const page = await newPage(browser);
    try {
      await login(page, PEOPLE.controlManager);
      const me = await apiGet(page, "/api/v1/auth/me");
      const cross1 = await apiSend(
        page, "PUT", `/api/v1/pos/menu/categories/${FT_CATEGORY}/station?branchId=${FT_BRANCH}`,
        { stationId: FT_STATION_GRILL },
      );
      const cross2 = await apiSend(
        page, "PUT", `/api/v1/pos/menu/items/${FT_ITEM}/station?branchId=${FT_BRANCH}`,
        { stationId: FT_STATION_GRILL },
      );
      const cross3 = await apiGet(page, `/api/v1/pos/menu/routing?branchId=${FT_BRANCH}`);
      log(`  CONTROL tenant -> FT category PUT=${cross1.status} item PUT=${cross2.status} GET routing=${cross3.status}`);
      log(`      bodies: ${JSON.stringify(cross1.body).slice(0, 160)} | ${JSON.stringify(cross3.body).slice(0, 160)}`);
      results.tenant = {
        me: JSON.stringify(me.body).slice(0, 200),
        putCategory: cross1.status, putItem: cross2.status, getRouting: cross3.status,
        bodies: [JSON.stringify(cross1.body).slice(0, 200), JSON.stringify(cross3.body).slice(0, 200)],
      };
      await go(page, "/app/menu/routing", { waitMs: 4000, allowTrouble: true });
      const dom = await page.evaluate(() => ({
        h1: document.querySelector("h1")?.textContent?.trim() ?? null,
        cats: Array.from(document.querySelectorAll("[data-category-name]")).map((n) => n.getAttribute("data-category-name")),
        body: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300),
      }));
      await shot(page, "03-control-tenant-routing");
      log(`  CONTROL screen: h1=${JSON.stringify(dom.h1)} cats=${JSON.stringify(dom.cats)}`);
      log(`      body: ${dom.body.slice(0, 200)}`);
      results.tenant.dom = dom;
    } catch (e) {
      log(`  tenant probe failed: ${e.message}`);
      results.tenant = { error: e.message };
    } finally {
      await page.close();
    }
  }

  writeJson("03-personas.json", results);
} finally {
  await browser.close();
}
