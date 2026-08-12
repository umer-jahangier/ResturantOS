/*
 * F13 re-open — the wrong tenant. The fix reads the READER's own JWT to choose a sentence, so
 * the question is whether a Control Bistro cashier can be shown anything at all about a Floating
 * Terrace check. Cheap to ask, expensive to be wrong about.
 */
import { newBrowser, newPage, apiGet, tokenOf, log, BASE, loadState } from "./lib.mjs";

const CONTROL = { slug: "control-bistro-isolation-test-tenant", email: "cashier@control.local", password: "Control#Cashier1" };

async function signIn(page, who) {
  for (let a = 0; a < 3; a++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(2500);
    const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await slug.count()) await slug.first().fill(who.slug);
    await page.locator('input[name="email"], input#email').first().fill(who.email);
    await page.locator('input[name="password"], input#password').first().fill(who.password);
    await page.locator('button[type="submit"]').first().click();
    for (let i = 0; i < 25; i++) { await page.waitForTimeout(1000); if (!page.url().includes("/login")) break; }
    if (!page.url().includes("/login")) { log(`  ✓ ${who.email}`); return; }
  }
  throw new Error("login failed " + who.email);
}

const st = loadState();
const browser = await newBrowser();
const page = await newPage(browser);
await signIn(page, CONTROL);
const claims = JSON.parse(Buffer.from((await tokenOf(page)).split(".")[1], "base64").toString("utf8"));
log("  control cashier tenant:", claims.tenantId ?? claims.tenant_id, "refund:", claims.permissions.includes("pos.order.refund"));

for (const [what, path] of [
  ["Floating Terrace order detail", `/api/v1/pos/orders/${st.bOrderId}`],
  ["its payment history", `/api/v1/pos/orders/${st.bOrderId}/payments`],
]) {
  const r = await apiGet(page, path);
  const rows = Array.isArray(r.body?.data) ? r.body.data.length : (r.body?.data ? 1 : 0);
  log(`  ${what}: HTTP ${r.status} rows=${rows} body=${JSON.stringify(r.body).slice(0, 160)}`);
}

// And on screen: the drawer for a check that is not theirs.
await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(7000);
const seen = await page.evaluate(() => ({
  notice: document.querySelector("[data-testid=void-blocked-paid-notice]")?.textContent?.trim() ?? null,
  refund: !!document.querySelector('[aria-label="Refund order"]'),
  body: document.body.innerText.replace(/\s+/g, " ").slice(0, 200),
}));
log("  control cashier's own POS:", JSON.stringify(seen));
await browser.close();
