/*
 * SHIFT STEP 2d — table H1 orders one more dish after the mains were fired.
 * (Retry of 2e with a tab click that actually lands.)
 */
import { newBrowser, newPage, go, shot, saveState, loadState, finding, log, BASE } from "./lib.mjs";

const st = loadState();
const NEW = st.newCashier;
const browser = await newBrowser();

const cash = await newPage(browser);
await cash.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await cash.waitForTimeout(1400);
const slug = cash.locator('input[name="tenantSlug"], input#tenantSlug');
if (await slug.count()) await slug.first().fill(NEW.slug);
await cash.locator('input[name="email"], input#email').first().fill(NEW.email);
await cash.locator('input[name="password"], input#password').first().fill(NEW.newPassword);
await cash.locator('button[type="submit"]').first().click();
await cash.waitForTimeout(5000);
log("  ✓", NEW.email);

await go(cash, "/app/pos", { waitMs: 8000 });
const tabInfo = await cash.evaluate(() =>
  Array.from(document.querySelectorAll("[role=tab]")).map((b) => ({
    t: b.textContent.trim(),
    sel: b.getAttribute("aria-selected"),
    id: b.id,
  })),
);
log("  tabs:", JSON.stringify(tabInfo));
await cash.getByText("Order Management", { exact: true }).click();
await cash.waitForTimeout(5000);
await shot(cash, "02r-order-management-open");

const listProbe = await cash.evaluate((no) => {
  const t = document.body.innerText;
  return {
    onOrderMgmt: /Order Management/.test(t),
    hasMine: t.includes(no),
    chips: Array.from(document.querySelectorAll('[data-testid^="status-filter-"]')).map((n) => n.textContent.trim()),
    scopeNote: document.querySelector("[data-testid=order-scope-note]")?.textContent?.trim() ?? null,
    rows: document.querySelectorAll('[data-testid^="open-order-"]').length,
    firstRows: t.split("\n").filter((l) => /ORD-\d{8}/.test(l)).slice(0, 6),
  };
}, st.order1No);
log("  list:", JSON.stringify(listProbe, null, 1));
saveState({ orderMgmtFirstLook: listProbe });

// search for my check
const search = cash.locator("[data-testid=order-management-search]");
if (await search.count()) {
  await search.first().fill(st.order1No);
  await cash.waitForTimeout(4000);
}
await shot(cash, "02s-search-order1");
const found = await cash.evaluate((no) => {
  const t = document.body.innerText;
  const i = t.indexOf(no);
  return {
    hit: i >= 0,
    ctx: i >= 0 ? t.slice(Math.max(0, i - 120), i + 260).replace(/\s+/g, " ") : null,
    openBtns: Array.from(document.querySelectorAll('[data-testid^="open-order-"]')).map((n) => n.getAttribute("data-testid")),
  };
}, st.order1No);
log("  found:", JSON.stringify(found, null, 1));

if (found.openBtns.length) {
  await cash.locator(`[data-testid="${found.openBtns[0]}"]`).click();
  await cash.waitForTimeout(4000);
  await shot(cash, "02t-drawer-open");
  const d0 = await cash.evaluate(() => {
    const d = document.querySelector("[data-testid=order-table-detail-drawer]");
    return d ? d.innerText.replace(/\s+/g, " ").trim() : null;
  });
  log("  drawer:", d0?.slice(0, 700));

  const qa = cash.getByLabel("Search menu");
  log("  quick-add box:", await qa.count());
  if (await qa.count()) {
    await qa.first().fill("Naan");
    await cash.waitForTimeout(3000);
    await shot(cash, "02u-quick-add");
    const res = await cash.evaluate(() => {
      const ul = document.querySelector("[data-testid=quick-add-results]");
      return ul ? ul.innerText.replace(/\s+/g, " ").trim() : null;
    });
    log("  quick-add results:", res);
    const addBtn = cash.locator("[data-testid=quick-add-results] button", { hasText: "Add" });
    if (await addBtn.count()) {
      await addBtn.first().click();
      await cash.waitForTimeout(3500);
    }
  }
  await shot(cash, "02v-after-late-add");
  const d1 = await cash.evaluate(() => {
    const d = document.querySelector("[data-testid=order-table-detail-drawer]");
    return {
      drawer: d ? d.innerText.replace(/\s+/g, " ").trim() : null,
      sendNew: document.querySelector("[data-testid=send-new-items-button]")?.textContent?.trim() ?? null,
      toasts: Array.from(document.querySelectorAll("[data-sonner-toast]")).map((n) => n.innerText.trim()),
    };
  });
  log("  after add:", JSON.stringify({ sendNew: d1.sendNew, toasts: d1.toasts }));
  log("  drawer now:", d1.drawer?.slice(0, 800));
  saveState({ lateAdd: d1 });

  if (d1.sendNew) {
    await cash.locator("[data-testid=send-new-items-button]").click();
    await cash.waitForTimeout(6000);
    await shot(cash, "02w-late-item-fired");
    const d2 = await cash.evaluate(() => {
      const d = document.querySelector("[data-testid=order-table-detail-drawer]");
      return {
        drawer: d ? d.innerText.replace(/\s+/g, " ").trim() : null,
        sendNew: document.querySelector("[data-testid=send-new-items-button]")?.textContent?.trim() ?? null,
        alerts: Array.from(document.querySelectorAll("[role=alert]")).map((n) => n.innerText.trim()),
      };
    });
    log("  after Send New Items — sendNew:", d2.sendNew, "alerts:", JSON.stringify(d2.alerts));
    log("  drawer:", d2.drawer?.slice(0, 800));
    saveState({ lateAddFired: d2 });
  } else {
    finding({ id: "SHIFT-LATEADD", sev: "S1", what: "no Send New Items control after a late add", evidence: d1 });
  }
}

await browser.close();
log("\nstep 2d done");
