/*
 * S5 RE-OPEN — drive C: the wrong personas, and the promise the confirm dialog makes.
 *
 *  1. TENANT_ADMIN (admin@terrace.local) — holds branch.manage, not rbac.manage. The screen and
 *     the create path are supposed to work for the role they were built for.
 *  2. CASHIER and MANAGER — the screen must refuse, and so must the endpoints.
 *  3. The deactivate confirm dialog says, verbatim: "nobody can take an order or start a till
 *     there." Deactivate the branch you are standing on, then try to start a till there.
 *
 * Run from frontend/: node e2e/floor/s5-reopen-c.mjs
 */
import { newBrowser, newPage, login, PEOPLE, pageTrouble, apiGet, apiSend, BASE } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S5-reopen");
mkdirSync(OUT, { recursive: true });
const STAMP = String(Date.now()).slice(-5);
const J = { stamp: STAMP, steps: [] };
function note(s, d) {
  J.steps.push({ step: s, detail: d });
  console.log(`  · ${s}: ${typeof d === "string" ? d : JSON.stringify(d)}`);
}
const ADMIN = {
  slug: "floating-terrace",
  email: "admin@terrace.local",
  password: "Terrace#Admin1",
  totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS",
};

const browser = await newBrowser();

async function persona(who, label) {
  const page = await newPage(browser);
  const bearers = [];
  page.on("request", (r) => {
    const a = r.headers()["authorization"];
    if (a && r.url().includes("localhost:8080")) bearers.push(a.slice(7));
  });
  for (let i = 1; ; i++) {
    try {
      await login(page, who);
      break;
    } catch (e) {
      if (i >= 4) throw e;
      console.log(`  ! ${label} login attempt ${i} failed`);
      await page.waitForTimeout(21000);
    }
  }
  return { page, bearers };
}
const shotOf = async (page, n) => {
  await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
  console.log(`    shot: ${n}.png`);
};
const rowsOf = (page) =>
  page.$$eval('[data-testid="branch-row"]', (ls) =>
    ls.map((r) => r.querySelector("span.truncate")?.textContent?.trim() ?? ""),
  );
async function switcherOf(page) {
  const t = page.locator('button[aria-label="Switch branch"]');
  if ((await t.count()) === 0) return { present: false, label: null, options: [] };
  const label = (await t.first().innerText()).trim();
  await t.first().click();
  await page.waitForTimeout(600);
  const options = await page.$$eval('[role="menuitem"]', (i) => i.map((n) => (n.textContent || "").trim()));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  return { present: true, label, options };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. TENANT_ADMIN — the role this screen was built for
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== TENANT_ADMIN ===");
{
  const { page } = await persona(ADMIN, "tenant admin");
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  J.adminSidebar = await page.locator('nav a[href="/app/branches"]').count();
  note("tenant admin sidebar link count", J.adminSidebar);

  await page.goto(`${BASE}/app/branches`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5500);
  const t = await pageTrouble(page);
  J.adminTrouble = t.bad;
  note("tenant admin page trouble", t.bad);
  J.adminRows = await rowsOf(page);
  note("tenant admin sees rows", J.adminRows);
  await shotOf(page, "C01-tenant-admin-branches");

  const writes = [];
  page.on("response", async (res) => {
    if (res.url().includes("/api/v1/branches") && res.request().method() !== "GET") {
      writes.push({
        m: res.request().method(),
        s: res.status(),
        body: (await res.text().catch(() => "")).slice(0, 260),
      });
    }
  });
  const NAME = `Admin Made ${STAMP}`;
  const addBtn = page.getByTestId("add-branch");
  J.adminHasAddButton = (await addBtn.count()) > 0;
  note("tenant admin sees Add branch", J.adminHasAddButton);
  if (J.adminHasAddButton) {
    await addBtn.click();
    await page.waitForTimeout(900);
    await page.getByTestId("branch-name-input").fill(NAME);
    await page.getByTestId("branch-address-input").fill("3 Jinnah Avenue, Islamabad");
    await page.getByTestId("branch-form-submit").click();
    await page.waitForTimeout(5000);
    J.adminWrites = writes;
    note("tenant admin create result", writes);
    J.adminAlerts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="alert"],[data-sonner-toast]'))
        .map((n) => (n.textContent || "").trim())
        .filter(Boolean),
    );
    note("tenant admin alerts after create", J.adminAlerts);
    await shotOf(page, "C02-tenant-admin-after-create");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    J.adminRowsAfter = await rowsOf(page);
    note("tenant admin rows after reload", J.adminRowsAfter);
    J.adminSwitcher = await switcherOf(page);
    note("tenant admin switcher", J.adminSwitcher);
    J.adminCreatedEntersSwitcher = J.adminSwitcher.options.some((o) => o.includes(NAME));
    note("the branch the tenant admin created is in their own switcher", J.adminCreatedEntersSwitcher);
  }
  await page.context().close();
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. The wrong personas
// ─────────────────────────────────────────────────────────────────────────────
for (const [label, who] of [
  ["cashier", PEOPLE.cashier],
  ["manager", PEOPLE.manager],
]) {
  console.log(`\n=== ${label.toUpperCase()} ===`);
  const { page } = await persona(who, label);
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const sidebar = await page.locator('nav a[href="/app/branches"]').count();
  await page.goto(`${BASE}/app/branches`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5500);
  const body = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300));
  const canSeeRows = await rowsOf(page);
  const canAdd = await page.getByTestId("add-branch").count();
  const post = await apiSend(page, "POST", "/api/v1/branches", {
    name: `${label} escalation ${STAMP}`,
    address: "nowhere",
  });
  const put = await apiSend(page, "PUT", "/api/v1/branches/34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03", {
    name: `${label} renamed HQ ${STAMP}`,
  });
  const del = await apiSend(page, "DELETE", "/api/v1/branches/34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03", undefined);
  J[label] = { sidebar, body, canSeeRows, canAdd, post: post.status, put: put.status, del: del.status };
  note(`${label} sidebar link count`, sidebar);
  note(`${label} screen body`, body);
  note(`${label} rows / add button`, { rows: canSeeRows.length, add: canAdd });
  note(`${label} POST/PUT/DELETE branches`, { post: post.status, put: put.status, del: del.status });
  await shotOf(page, `C03-${label}-branches`);
  await page.context().close();
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. "nobody can take an order or start a till there"
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n=== THE PROMISE THE DIALOG MAKES ===");
{
  const { page } = await persona(PEOPLE.owner, "owner");
  const NAME = `Promise Probe ${STAMP}`;
  await page.goto(`${BASE}/app/branches`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await page.getByTestId("add-branch").click();
  await page.waitForTimeout(900);
  await page.getByTestId("branch-name-input").fill(NAME);
  await page.getByTestId("branch-form-submit").click();
  await page.waitForTimeout(5000);

  // switch onto it
  await page.locator('button[aria-label="Switch branch"]').first().click();
  await page.waitForTimeout(700);
  await page.locator(`[role="menuitem"]:has-text("${NAME}")`).first().click();
  await page.waitForTimeout(6500);

  // read back the id of the branch we are standing on
  const mine = await apiGet(page, "/api/v1/branches/mine");
  const target = (mine.body?.data ?? []).find((b) => b.name === NAME);
  J.promiseBranchId = target?.id ?? null;
  note("standing on", target);

  // capture the dialog's exact words, then deactivate
  await page.goto(`${BASE}/app/branches`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await page.locator(`button[aria-label="Actions for ${NAME}"]`).first().click();
  await page.waitForTimeout(500);
  await page.getByRole("menuitem", { name: "Deactivate" }).click();
  await page.waitForTimeout(900);
  J.dialogText = await page.evaluate(() => {
    const d = document.querySelector('[role="alertdialog"],[role="dialog"]');
    return d ? (d.innerText || "").replace(/\s+/g, " ").trim() : null;
  });
  note("the dialog's exact words", J.dialogText);
  await shotOf(page, "C04-the-promise");
  await page.getByRole("button", { name: /Deactivate branch/i }).click();
  await page.waitForTimeout(6000);

  // now: can this session still start a till and take an order THERE?
  await page.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  const tr = await pageTrouble(page);
  note("POS on the deactivated branch — trouble", tr.bad);
  await shotOf(page, "C05-pos-on-deactivated-branch");
  const openBtn = page.getByTestId("open-till-button");
  J.openTillButtonPresent = (await openBtn.count()) > 0;
  note("Open Till button present on the deactivated branch", J.openTillButtonPresent);
  if (J.openTillButtonPresent) {
    await openBtn.first().click();
    await page.waitForTimeout(1200);
    const amount = page.locator('[data-testid="open-till-panel"] input[type="number"], [data-testid="open-till-panel"] input');
    if (await amount.count()) await amount.first().fill("1500");
    await shotOf(page, "C06-open-till-panel-on-deactivated-branch");
    await page.getByTestId("open-till-confirm-button").click();
    await page.waitForTimeout(6000);
    J.openTillError = await page
      .locator('[data-testid="open-till-error"]')
      .innerText()
      .catch(() => null);
    J.posAfterOpenTill = await page.evaluate(() => {
      const m = document.querySelector("main") ?? document.body;
      return (m.innerText || "").replace(/\s+/g, " ").slice(0, 400);
    });
    note("open-till error box", J.openTillError);
    note("POS after clicking Open Till", J.posAfterOpenTill);
    await shotOf(page, "C07-after-open-till-attempt");
  }
  // and the raw endpoint, so the answer is not a UI artefact
  J.tillApi = await apiSend(page, "POST", "/api/v1/pos/till-sessions", {
    openingFloatPaisa: 150000,
    terminalId: null,
  });
  note("POST /api/v1/pos/till-sessions on a deactivated branch", J.tillApi);
  await page.context().close();
}

writeFileSync(`${OUT}/s5-reopen-c.json`, JSON.stringify(J, null, 2));
console.log(`\nwrote ${OUT}/s5-reopen-c.json`);
await browser.close();
