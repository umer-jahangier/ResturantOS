/* Can a SuperAdmin create a brand-new restaurant tenant from the browser? */
import { launch, login, visit, OUT, BASE } from "./onboarding-lib.mjs";

const { browser, page } = await launch();
try {
  await login(page, "superadmin");

  await visit(page, "/platform/dashboard", "sa-01-platform-dashboard");
  const list = await visit(page, "/platform/tenants", "sa-02-platform-tenants", { chars: 1500 });

  // Look for a create-tenant affordance
  const buttons = await page.locator("button, a[role=button]").allInnerTexts();
  console.log("  BUTTONS:", JSON.stringify(buttons.slice(0, 40)));

  const create = page.getByRole("button", { name: /new tenant|add tenant|create tenant|provision/i });
  console.log("  create-affordance count:", await create.count());
  if (await create.count()) {
    await create.first().click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT}/sa-03-create-tenant-dialog.png`, fullPage: true });
    // Measure the dialog box (the ~24px-wide dialog trap)
    const dlg = page.locator('[role="dialog"]');
    if (await dlg.count()) {
      const box = await dlg.first().boundingBox();
      console.log("  DIALOG BOX:", JSON.stringify(box));
      const fields = await dlg.first().locator("input, select, textarea").evaluateAll((els) =>
        els.map((e) => ({ name: e.name || e.id, type: e.type, ph: e.placeholder })),
      );
      console.log("  DIALOG FIELDS:", JSON.stringify(fields));
      const labels = await dlg.first().locator("label").allInnerTexts();
      console.log("  DIALOG LABELS:", JSON.stringify(labels));
      console.log("  DIALOG TEXT:", (await dlg.first().innerText()).replace(/\s+/g, " ").slice(0, 900));
    } else {
      console.log("  NO [role=dialog] appeared");
      console.log("  page after click:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 800));
    }
  }

  // A tenant detail page — what can a SuperAdmin configure per tenant?
  const rowLinks = await page.locator('a[href*="/platform/tenants/"]').evaluateAll((els) =>
    els.map((e) => e.getAttribute("href")),
  );
  console.log("  TENANT DETAIL LINKS:", JSON.stringify(rowLinks.slice(0, 10)));
  if (rowLinks.length) {
    await visit(page, rowLinks[0], "sa-04-tenant-detail", { chars: 2000 });
    const detailButtons = await page.locator("button").allInnerTexts();
    console.log("  DETAIL BUTTONS:", JSON.stringify(detailButtons.slice(0, 40)));
  }

  // Routes an onboarding wizard would live at
  for (const r of ["/platform/onboarding", "/onboarding", "/app/onboarding", "/app/setup", "/setup", "/welcome"]) {
    const res = await visit(page, r, `sa-05-probe${r.replace(/\//g, "_")}`, { wait: 2000, chars: 160 });
    console.log(`  PROBE ${r} -> ${res.is404 ? "404" : "exists"}`);
  }
} catch (e) {
  console.error("FAILED:", e.message);
  await page.screenshot({ path: `${OUT}/sa-FAIL.png`, fullPage: true });
} finally {
  await browser.close();
}
