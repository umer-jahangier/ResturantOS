/*
 * S5 — INDEPENDENT RE-OPEN ATTEMPT.
 *
 * Drives the DONE-MEANS path myself, then the paths the original claim did not:
 *   A. OWNER  — full path, my own branch name, my own reload points.
 *   B. TENANT_ADMIN — the role the screen says it exists for (branch.manage, NOT rbac.manage).
 *   C. MANAGER — the wrong persona. Screen must refuse and POST must 403.
 *   D. Cross-tenant — Floating Terrace owner must not see or write Control Bistro branches.
 *
 * Every token reading is the Authorization header the APP sent on its own next gateway call.
 */
import { newBrowser, newPage, login, PEOPLE, go, pageTrouble, apiSend, apiGet, tokenOf, totpNow, BASE } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S5-reopen");
mkdirSync(OUT, { recursive: true });

const STAMP = String(Date.now()).slice(-5);
const log = [];
function note(step, detail) {
  log.push({ step, detail });
  console.log(`  · ${step}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}
function flush() {
  writeFileSync(`${OUT}/s5-reopen.json`, JSON.stringify(log, null, 2));
}
function decode(tok) {
  if (!tok) return null;
  try {
    return JSON.parse(Buffer.from(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  } catch { return null; }
}

const ADMIN = { slug: "floating-terrace", email: "admin@terrace.local", password: "Terrace#Admin1", totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS" };
const CONTROL_OWNER = { slug: "control-bistro-isolation-test-tenant", email: "owner@control.local", password: "Control#Owner1", totpSecret: "77YCNG564SWVW7YPUCJRGDSE6ZSCC3GQ" };

const browser = await newBrowser();

function wire(page) {
  const bearers = [];
  page.on("request", (req) => {
    const auth = req.headers()["authorization"];
    if (auth && req.url().includes("localhost:8080")) bearers.push(auth.slice(7));
  });
  page.__live = () => decode(bearers[bearers.length - 1])?.branch_id ?? null;
  return page;
}
async function signIn(page, who, label) {
  for (let attempt = 1; ; attempt++) {
    try { await login(page, who); return; }
    catch (e) {
      const shown = await page.evaluate(() => Array.from(document.querySelectorAll('[role="alert"]')).map(n => n.textContent?.trim()).join(" | "));
      console.log(`  ! ${label} login attempt ${attempt} failed (${shown || "no alert"})`);
      if (attempt >= 4) throw e;
      await page.waitForTimeout(21000);
    }
  }
}
const rowNames = (page) => page.$$eval('[data-testid="branch-row"]', rows => rows.map(r => r.querySelector("span.truncate")?.textContent?.trim() ?? ""));
async function shotAt(page, name) { await page.screenshot({ path: `${OUT}/${name}.png` }); }

async function switcherOptions(page) {
  const trigger = page.locator('button[aria-label="Switch branch"]').first();
  if (!(await trigger.count())) return { present: false, label: null, options: [] };
  const label = (await trigger.textContent())?.trim() ?? null;
  await trigger.click();
  await page.waitForTimeout(900);
  const options = await page.$$eval('[role="option"], [role="menuitem"], [role="menuitemradio"]', ns => ns.map(n => n.textContent?.trim() ?? ""));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  return { present: true, label, options };
}

// ══════════════════════════════ A. OWNER ══════════════════════════════
const owner = wire(await newPage(browser));
await signIn(owner, PEOPLE.owner, "owner");

await go(owner, "/app/dashboard");
const navLink = owner.locator('nav a[href="/app/branches"]');
note("A1 owner: sidebar links to /app/branches", await navLink.count());
if ((await navLink.count()) === 0) throw new Error("owner has no sidebar link");
await navLink.first().click();
await owner.waitForURL("**/app/branches", { timeout: 90000 });
await owner.waitForTimeout(4000);
note("A2 owner: page trouble on arrival", (await pageTrouble(owner)).bad);
note("A3 owner: rows on arrival", await rowNames(owner));
await shotAt(owner, "A-01-owner-branches");

const NEW_NAME = `Reopen Branch ${STAMP}`;
const RENAMED = `Reopen Branch ${STAMP} — Annexe`;

// Create
const posts = [];
owner.on("response", async r => {
  if (r.url().includes("/api/v1/branches") && r.request().method() === "POST") {
    posts.push({ status: r.status(), body: (await r.text().catch(() => "")).slice(0, 200) });
  }
});
await owner.getByTestId("add-branch").click();
await owner.waitForTimeout(900);
await owner.getByTestId("branch-name-input").fill(NEW_NAME);
await owner.getByTestId("branch-address-input").fill("12 Khayaban-e-Iqbal, Karachi");
await shotAt(owner, "A-02-create-filled");
await owner.getByTestId("branch-form-submit").click();
await owner.waitForTimeout(4000);
note("A4 owner: POST /branches", posts);
note("A5 owner: rows after create", await rowNames(owner));

// RELOAD — persistence
await owner.reload({ waitUntil: "domcontentloaded" });
await owner.waitForTimeout(4500);
note("A6 owner: rows after RELOAD", await rowNames(owner));
await shotAt(owner, "A-03-after-reload");

// Rename
const row = owner.locator('[data-testid="branch-row"]', { hasText: NEW_NAME }).first();
await row.locator('button[aria-haspopup="menu"], [data-testid="branch-actions"]').first().click();
await owner.waitForTimeout(700);
await owner.getByRole("menuitem", { name: /edit/i }).first().click();
await owner.waitForTimeout(900);
await owner.getByTestId("branch-name-input").fill(RENAMED);
await owner.getByTestId("branch-form-submit").click();
await owner.waitForTimeout(3500);
await owner.reload({ waitUntil: "domcontentloaded" });
await owner.waitForTimeout(4500);
note("A7 owner: rows after rename + RELOAD", await rowNames(owner));
await shotAt(owner, "A-04-renamed");

// Switch to it
let sw = await switcherOptions(owner);
note("A8 owner: switcher before switch", sw);
note("A9 owner: live token branch_id before switch", owner.__live());
const trig = owner.locator('button[aria-label="Switch branch"]').first();
await trig.click();
await owner.waitForTimeout(800);
await owner.locator('[role="option"], [role="menuitem"], [role="menuitemradio"]').filter({ hasText: RENAMED }).first().click();
await owner.waitForTimeout(5000);
note("A10 owner: switcher label after switch", (await trig.textContent())?.trim());
note("A11 owner: live token branch_id after switch", owner.__live());
await shotAt(owner, "A-05-switched");

// RELOAD — does the switch survive?
await owner.reload({ waitUntil: "domcontentloaded" });
await owner.waitForTimeout(5500);
note("A12 owner: switcher label after RELOAD", (await owner.locator('button[aria-label="Switch branch"]').first().textContent())?.trim());
note("A13 owner: live token branch_id after RELOAD", owner.__live());
await shotAt(owner, "A-06-after-reload-still-switched");

// A data screen on the new branch
const wireCalls = [];
owner.on("request", req => {
  const u = req.url();
  if (u.includes("/api/v1/pos/orders") || u.includes("/api/v1/reporting")) wireCalls.push(u.replace("http://localhost:8080", ""));
});
const t1 = await go(owner, "/app/orders");
note("A14 owner: order management trouble on new branch", t1.bad);
note("A15 owner: order calls on the wire", wireCalls.slice(-4));
note("A16 owner: what the orders screen says", (await owner.evaluate(() => document.body.innerText)).replace(/\n+/g, " | ").slice(0, 400));
await shotAt(owner, "A-07-orders-on-new-branch");

flush();

// ══════════════════════════════ B. TENANT_ADMIN ══════════════════════════════
const admin = wire(await newPage(browser));
await signIn(admin, ADMIN, "tenant admin");
const adminClaims = decode(await tokenOf(admin));
note("B0 admin: holds rbac.manage?", (adminClaims?.permissions ?? adminClaims?.perms ?? []).includes?.("rbac.manage") ?? "n/a");
await go(admin, "/app/dashboard");
note("B1 admin: sidebar links to /app/branches", await admin.locator('nav a[href="/app/branches"]').count());
const tAdmin = await go(admin, "/app/branches", { waitMs: 6000 });
note("B2 admin: branches page trouble", tAdmin.bad);
note("B3 admin: rows", await rowNames(admin));
await shotAt(admin, "B-01-admin-branches");

const ADMIN_NAME = `Admin Branch ${STAMP}`;
const adminPosts = [];
admin.on("response", async r => {
  if (r.url().includes("/api/v1/branches") && r.request().method() === "POST") {
    adminPosts.push({ status: r.status(), body: (await r.text().catch(() => "")).slice(0, 300) });
  }
});
const addBtn = admin.getByTestId("add-branch");
note("B4 admin: Add branch button visible", await addBtn.count());
if (await addBtn.count()) {
  await addBtn.click();
  await admin.waitForTimeout(900);
  await admin.getByTestId("branch-name-input").fill(ADMIN_NAME);
  await admin.getByTestId("branch-form-submit").click();
  await admin.waitForTimeout(4500);
  note("B5 admin: POST /branches", adminPosts);
  note("B6 admin: anything shouting on screen", await admin.evaluate(() => Array.from(document.querySelectorAll('[role="alert"],[data-sonner-toast]')).map(n => n.textContent?.trim()).filter(Boolean)));
  await shotAt(admin, "B-02-admin-after-create");
  await admin.reload({ waitUntil: "domcontentloaded" });
  await admin.waitForTimeout(4500);
  note("B7 admin: rows after create + RELOAD", await rowNames(admin));
  const swA = await switcherOptions(admin);
  note("B8 admin: switcher after create", swA);
}
flush();

// ══════════════════════════════ C. WRONG PERSONA ══════════════════════════════
const mgr = wire(await newPage(browser));
await signIn(mgr, PEOPLE.manager, "manager");
await go(mgr, "/app/dashboard");
note("C1 manager: sidebar links to /app/branches", await mgr.locator('nav a[href="/app/branches"]').count());
const tMgr = await go(mgr, "/app/branches", { waitMs: 6000, allowTrouble: true });
note("C2 manager: what /app/branches shows", tMgr.bad);
note("C3 manager: body head", (await mgr.evaluate(() => document.body.innerText)).replace(/\n+/g, " | ").slice(0, 220));
await shotAt(mgr, "C-01-manager-branches");
const mgrPost = await apiSend(mgr, "POST", "/api/v1/branches", { name: `Manager Should Not ${STAMP}`, isHq: false, timezone: "Asia/Karachi" });
note("C4 manager: POST /api/v1/branches", { status: mgrPost.status, code: mgrPost.body?.error?.code });
const cashier = wire(await newPage(browser));
await signIn(cashier, PEOPLE.cashier, "cashier");
const tCash = await go(cashier, "/app/branches", { waitMs: 6000, allowTrouble: true });
note("C5 cashier: what /app/branches shows", tCash.bad);
const cashPost = await apiSend(cashier, "POST", "/api/v1/branches", { name: `Cashier Should Not ${STAMP}`, isHq: false, timezone: "Asia/Karachi" });
note("C6 cashier: POST /api/v1/branches", { status: cashPost.status, code: cashPost.body?.error?.code });
flush();

// ══════════════════════════════ D. CROSS-TENANT ══════════════════════════════
const ctrl = wire(await newPage(browser));
await signIn(ctrl, CONTROL_OWNER, "control owner");
const ctrlList = await apiGet(ctrl, "/api/v1/branches");
const ctrlBranches = (ctrlList.body?.data ?? []).map(b => ({ id: b.id, name: b.name }));
note("D1 control tenant branches", ctrlBranches);
const ctrlNames = await go(ctrl, "/app/branches", { waitMs: 6000, allowTrouble: true });
note("D2 control owner: branches page trouble", ctrlNames.bad);
note("D3 control owner: rows on screen", await rowNames(ctrl));
await shotAt(ctrl, "D-01-control-branches");

const terraceList = await apiGet(owner, "/api/v1/branches");
const terraceNames = (terraceList.body?.data ?? []).map(b => b.name);
note("D4 terrace owner sees branches", terraceNames);
note("D5 any control branch leaked into terrace list", (terraceList.body?.data ?? []).filter(b => ctrlBranches.some(c => c.id === b.id)).map(b => b.name));
if (ctrlBranches.length) {
  const victim = ctrlBranches[0].id;
  const crossRead = await apiGet(owner, `/api/v1/branches/${victim}`);
  note("D6 terrace owner GET other tenant branch", { status: crossRead.status, name: crossRead.body?.data?.name });
  const crossWrite = await apiSend(owner, "PUT", `/api/v1/branches/${victim}`, { name: "PWNED BY TERRACE" });
  note("D7 terrace owner PUT other tenant branch", { status: crossWrite.status, code: crossWrite.body?.error?.code, name: crossWrite.body?.data?.name });
  const after = await apiGet(ctrl, `/api/v1/branches/${victim}`);
  note("D8 control owner re-reads its own branch name", { status: after.status, name: after.body?.data?.name });
}
flush();

// ══════════════════════════════ E. DEACTIVATE (owner) ══════════════════════════════
await go(owner, "/app/branches", { waitMs: 5000 });
// switch back to HQ first so we are not standing on the branch we retire
const trig2 = owner.locator('button[aria-label="Switch branch"]').first();
if (await trig2.count()) {
  await trig2.click(); await owner.waitForTimeout(800);
  const hq = owner.locator('[role="option"], [role="menuitem"], [role="menuitemradio"]').filter({ hasText: /Floating Terrace HQ/ }).first();
  if (await hq.count()) { await hq.click(); await owner.waitForTimeout(5000); }
}
await go(owner, "/app/branches", { waitMs: 5000 });
const row2 = owner.locator('[data-testid="branch-row"]', { hasText: RENAMED }).first();
await row2.locator('button[aria-haspopup="menu"], [data-testid="branch-actions"]').first().click();
await owner.waitForTimeout(700);
const deact = owner.getByRole("menuitem", { name: /deactivate|stop trading/i }).first();
note("E1 owner: deactivate action present", await deact.count());
await deact.click();
await owner.waitForTimeout(900);
await shotAt(owner, "E-01-deactivate-confirm");
await owner.getByRole("button", { name: /deactivate branch/i }).last().click();
await owner.waitForTimeout(4000);
note("E2 owner: rows after deactivate", await rowNames(owner));
await owner.reload({ waitUntil: "domcontentloaded" });
await owner.waitForTimeout(5000);
note("E3 owner: rows after deactivate + RELOAD", await rowNames(owner));
const swAfter = await switcherOptions(owner);
note("E4 owner: switcher after deactivate", swAfter);
await shotAt(owner, "E-02-after-deactivate");

// HQ must be undeactivatable
const hqRow = owner.locator('[data-testid="branch-row"]', { hasText: /Floating Terrace HQ/ }).first();
await hqRow.locator('button[aria-haspopup="menu"], [data-testid="branch-actions"]').first().click();
await owner.waitForTimeout(700);
const hqDeact = owner.getByRole("menuitem", { name: /deactivate|stop trading/i }).first();
note("E5 owner: HQ deactivate item state", { count: await hqDeact.count(), disabled: (await hqDeact.count()) ? await hqDeact.getAttribute("aria-disabled") : null });
await owner.keyboard.press("Escape");

flush();
console.log(`\nWrote ${OUT}/s5-reopen.json`);
await browser.close();
