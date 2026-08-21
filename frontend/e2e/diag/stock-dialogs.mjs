// ATTACK 4: the other agent probed /app/inventory/counts, /transfers, /movements and got 404s,
// then reported the capabilities absent. The stock page mounts FOUR dialogs — Opening balance,
// Record receipt, Transfer, Count. Open each, measure it, and try to COMPLETE one.
import { chromium, newCtx, login, probe, shot, assertSession, BASE } from "./lib.mjs";

const persona = process.argv[2] ?? "manager";

async function dialogState(page) {
  return page.evaluate(() => {
    const ds = [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')];
    const d = ds[ds.length - 1];
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return {
      size: `${Math.round(r.width)}x${Math.round(r.height)}`,
      title: (d.querySelector("h2,h3")?.innerText || "").trim(),
      text: d.innerText.slice(0, 420).replace(/\n+/g, " | "),
      fields: [...d.querySelectorAll("input,textarea,select,[role=combobox]")].map((i) => ({
        tag: i.tagName, type: i.type || null, name: i.name || null,
        ph: i.placeholder || null, label: (i.getAttribute("aria-label") || "").slice(0, 40) || null,
      })),
      labels: [...d.querySelectorAll("label")].map((l) => l.innerText.trim()).filter(Boolean),
      buttons: [...d.querySelectorAll("button")].map((b) => `${b.innerText.trim()}${b.disabled ? "[DIS]" : ""}`).filter((t) => t.trim() !== "[DIS]" && t),
    };
  });
}

async function main() {
  const browser = await chromium.launch();
  const { page } = await newCtx(browser, { width: 1440, height: 950 });
  const api = [];
  page.on("response", (r) => { if (/\/inventory\//.test(r.url())) api.push(`${r.request().method()} ${r.status()} ${r.url().split("/api/v1")[1]?.split("?")[0]}`); });
  if (!(await login(page, persona))) { console.log("LOGIN FAILED"); process.exit(1); }

  const r = await probe(page, "/app/inventory/stock");
  await assertSession(page, "stock");
  console.log(`\n=== /app/inventory/stock as ${persona} ===`);
  console.log("  h:", r.h1.join(" | "), "| denied:", r.denied, "| 404:", r.is404, "| alerts:", JSON.stringify(r.alerts));
  const pageBtns = await page.evaluate(() => [...document.querySelectorAll("button")]
    .map((b) => b.innerText.trim()).filter((t) => t && !/Collapse|Search|Floating|^F$/.test(t)));
  console.log("  page buttons:", JSON.stringify(pageBtns));
  console.log("  total line:", (r.text.match(/Total stock value:[^\n]*/) || ["(none)"])[0]);
  console.log("  waste anywhere on page:", /wast|spoil|spill|breakage/i.test(r.text));
  await shot(page, `stock-page-${persona}`);

  for (const label of ["Opening balance", "Record receipt", "Receipt", "Transfer", "Count"]) {
    const btn = page.locator(`button:has-text("${label}")`).first();
    if (!(await btn.count())) { console.log(`\n  -- "${label}": no such button`); continue; }
    await btn.click();
    await page.waitForTimeout(2000);
    const d = await dialogState(page);
    console.log(`\n  -- DIALOG "${label}" --`);
    if (!d) { console.log("     !! no dialog opened"); continue; }
    console.log("     size:", d.size, "| title:", d.title);
    console.log("     labels:", JSON.stringify(d.labels));
    console.log("     fields:", JSON.stringify(d.fields));
    console.log("     buttons:", JSON.stringify(d.buttons));
    console.log("     mentions expiry/batch/lot:", /expiry|batch|lot/i.test(d.text));
    console.log("     mentions reason:", /reason/i.test(d.text));
    await shot(page, `stock-dialog-${label.replace(/\s+/g, "-")}-${persona}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1200);
  }

  console.log("\n  inventory API traffic:", JSON.stringify([...new Set(api)]));
  await browser.close();
}
main();
