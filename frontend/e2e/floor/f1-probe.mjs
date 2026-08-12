/* F1 — probe the cashier's current till state before touching anything. */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, tokenOf, log } from "../shift/lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);
await login(page, PEOPLE.cashier);
await go(page, "/app/pos", { waitMs: 7000 });

const tok = await tokenOf(page);
const claims = JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString("utf8"));
log("  branch:", claims.branch_id ?? claims.branchId, "user:", claims.sub);

const strip = await page.evaluate(() => {
  const b = document.querySelector(
    "[data-testid=close-till-button], [data-testid=open-till-button], [data-testid=till-status-unavailable]",
  );
  return b ? b.closest("div").innerText.replace(/\s+/g, " ").trim() : document.body.innerText.slice(0, 300);
});
log("  strip:", strip);

const tills = await apiGet(page, `/api/v1/pos/tills?cashierId=${claims.sub}&status=OPEN`, tok);
log("  tills status:", tills.status);
log("  tills:", JSON.stringify(tills.body).slice(0, 1200));
const arr = tills.body?.data ?? tills.body ?? [];
const t = Array.isArray(arr) ? arr[0] : null;
if (t) {
  const recon = await apiGet(page, `/api/v1/pos/tills/${t.id}/reconciliation`, tok);
  log("  recon status:", recon.status);
  const rb = recon.body?.data ?? recon.body;
  log("  recon:", JSON.stringify(rb, null, 1).slice(0, 2500));
}
await page.screenshot({ path: "../.planning/audits/floor/F1/00-probe-pos.png" });
await browser.close();
