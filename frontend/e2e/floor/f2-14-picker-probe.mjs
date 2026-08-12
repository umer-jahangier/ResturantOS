/* F2 — what exactly is on screen after a table is picked in the terminal? */
import { PEOPLE, newBrowser, newPage, login, go, shot, log } from "./f2-lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);
const dump = async (when) => {
  const d = await page.evaluate(() => ({
    dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map((n) => ({
      testid: n.getAttribute("data-testid"),
      state: n.getAttribute("data-state"),
      label: (n.getAttribute("aria-label") || n.textContent || "").trim().slice(0, 90),
    })),
    overlays: Array.from(document.querySelectorAll('[data-slot="dialog-overlay"]')).map((n) => ({
      state: n.getAttribute("data-state"),
      zone: n.getAttribute("data-zone"),
    })),
    listboxes: Array.from(document.querySelectorAll('[role="listbox"]')).length,
    trigger: (
      document.querySelector("[data-testid=table-select-trigger]")?.textContent || ""
    ).trim(),
  }));
  log(`  [${when}]`, JSON.stringify(d));
};

try {
  await login(page, PEOPLE.manager);
  await go(page, "/app/pos", { waitMs: 9000, allowTrouble: true });
  await page.locator("[data-testid=order-type-dine_in]").click();
  await page.waitForTimeout(1200);
  await dump("before opening picker");
  await page.locator("[data-testid=table-select-trigger]").click();
  await page.waitForTimeout(2000);
  await dump("picker open");
  const opts = page.locator('[data-testid^="table-option-"]:not([aria-disabled="true"])');
  log("  free options:", await opts.count());
  if (await opts.count()) {
    const name = (await opts.first().getAttribute("data-testid")).replace("table-option-", "");
    log("  clicking", name);
    await opts.first().click();
    for (const ms of [500, 1500, 3000, 6000]) {
      await page.waitForTimeout(ms === 500 ? 500 : ms - 500);
      await dump(`after pick +${ms}ms`);
    }
  }
  await shot(page, "probe-after-pick");
  log("  --- now clicking a menu tile ---");
  const tiles = page.locator('[data-testid="menu-grid"] button[aria-pressed]');
  await tiles.first().waitFor({ timeout: 25000 });
  await tiles.nth(0).click();
  await page.waitForTimeout(2500);
  await dump("after first menu tile click");
  const anyDialog = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][data-state="open"]');
    return d
      ? {
          testid: d.getAttribute("data-testid"),
          text: d.innerText.slice(0, 400),
          buttons: Array.from(d.querySelectorAll("button")).map((b) => b.textContent.trim()),
        }
      : null;
  });
  log("  open dialog:", JSON.stringify(anyDialog, null, 2));
  await shot(page, "probe-after-tile");
} catch (e) {
  log("  !!", e.message);
  await shot(page, "probe-failure");
} finally {
  await page.context().close();
  await browser.close();
}
