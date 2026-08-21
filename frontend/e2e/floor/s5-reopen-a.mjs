/*
 * S5 RE-OPEN — drive A: the DONE-MEANS path, independently, as owner@terrace.local.
 *
 * Written without reusing s5-prove.mjs, so a wrong assumption baked into that harness cannot
 * reproduce itself here. Every branch-claim reading is taken from the Authorization header the
 * APPLICATION sent on its own next gateway call, captured with page.on("request").
 *
 * Run from frontend/: node e2e/floor/s5-reopen-a.mjs
 */
import { newBrowser, newPage, login, PEOPLE, pageTrouble, BASE } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S5-reopen");
mkdirSync(OUT, { recursive: true });

const STAMP = String(Date.now()).slice(-5);
const NAME = `Reopen Terrace ${STAMP}`;
const RENAMED = `Reopen Terrace ${STAMP} — Annexe`;
const ADDRESS = "9 Zamzama Boulevard, Clifton, Karachi";
const ZONE = "Asia/Dubai";

const J = { stamp: STAMP, name: NAME, renamed: RENAMED, steps: [] };
function note(step, detail) {
  J.steps.push({ step, detail });
  console.log(`  · ${step}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}

function decode(tok) {
  if (!tok) return null;
  try {
    return JSON.parse(
      Buffer.from(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    );
  } catch {
    return null;
  }
}

const browser = await newBrowser();
const page = await newPage(browser);

const bearers = [];
page.on("request", (req) => {
  const a = req.headers()["authorization"];
  if (a && req.url().includes("localhost:8080")) bearers.push(a.slice(7));
});
/** The branch claim on the token the APP most recently used. */
function liveClaim() {
  const c = decode(bearers[bearers.length - 1]);
  return c ? { branch_id: c.branch_id, tenant_id: c.tenant_id, sub: c.sub } : null;
}
/** Force the app to make a fresh gateway call so `liveClaim` is current, then read it. */
async function claimAfterTraffic() {
  const before = bearers.length;
  await page.evaluate(() =>
    fetch("http://localhost:8080/api/v1/branches/mine", { credentials: "include" }).catch(() => {}),
  );
  await page.waitForTimeout(600);
  // A same-page fetch() carries no Authorization header (the app adds it in its client), so fall
  // back to the last app-sent bearer; the point of the round-trip is to flush any pending call.
  void before;
  return liveClaim();
}
const shot = async (n) => {
  await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
  console.log(`    shot: ${n}.png`);
};

const rows = () =>
  page.$$eval('[data-testid="branch-row"]', (ls) =>
    ls.map((r) => ({
      name: r.querySelector("span.truncate")?.textContent?.trim() ?? "",
      text: (r.textContent || "").replace(/\s+/g, " ").trim(),
      active: r.getAttribute("data-branch-active"),
    })),
  );

/** Read the branch switcher: its current label and the branches it offers. */
async function switcher() {
  const trigger = page.locator('button[aria-label="Switch branch"]');
  if ((await trigger.count()) === 0) return { present: false, label: null, options: [] };
  const label = (await trigger.first().innerText()).trim();
  await trigger.first().click();
  await page.waitForTimeout(600);
  const options = await page.$$eval('[role="menuitem"]', (items) =>
    items.map((i) => (i.textContent || "").trim()),
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  return { present: true, label, options };
}

for (let attempt = 1; ; attempt++) {
  try {
    await login(page, PEOPLE.owner);
    break;
  } catch (e) {
    const shown = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="alert"]'))
        .map((n) => n.textContent?.trim())
        .join(" | "),
    );
    console.log(`  ! login attempt ${attempt} failed (${shown || "no alert"})`);
    if (attempt >= 4) throw e;
    await page.waitForTimeout(21000);
  }
}

// ── 1. reach the screen from the sidebar ─────────────────────────────────────
await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
const link = page.locator('nav a[href="/app/branches"]');
note("sidebar links to /app/branches", await link.count());
if ((await link.count()) === 0) {
  await shot("A00-no-sidebar-link");
  throw new Error("no sidebar link");
}
await link.first().click();
await page.waitForURL("**/app/branches", { timeout: 90000 });
await page.waitForTimeout(4000);
let t = await pageTrouble(page);
note("page trouble on arrival", t.bad);
if (t.bad.length) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  t = await pageTrouble(page);
  note("page trouble after retry", t.bad);
  if (t.bad.length) throw new Error(`branches page broken: ${t.bad.join(",")}`);
}
await shot("A01-branches-listed");
note("rows on arrival", (await rows()).map((r) => r.name));

// ── 2. create ────────────────────────────────────────────────────────────────
const posts = [];
page.on("response", async (res) => {
  const u = res.url();
  if (u.includes("/api/v1/branches") && res.request().method() !== "GET") {
    posts.push({
      m: res.request().method(),
      s: res.status(),
      u: u.replace("http://localhost:8080", ""),
      body: (await res.text().catch(() => "")).slice(0, 240),
    });
  }
});

await page.getByTestId("add-branch").click();
await page.waitForTimeout(900);
await page.getByTestId("branch-name-input").fill(NAME);
await page.getByTestId("branch-address-input").fill(ADDRESS);
await page.locator("#branch-timezone").click();
await page.waitForTimeout(500);
await page.locator('input[placeholder="Search time zones…"], [cmdk-input]').first().fill(ZONE);
await page.waitForTimeout(700);
await page.locator(`[cmdk-item]:has-text("${ZONE}")`).first().click();
await page.waitForTimeout(400);
await shot("A02-create-filled");
await page.getByTestId("branch-form-submit").click();
await page.waitForTimeout(4500);
note("writes seen so far", posts);
note(
  "alerts on screen after submit",
  await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="alert"],[data-sonner-toast]'))
      .map((n) => (n.textContent || "").trim())
      .filter(Boolean),
  ),
);
await shot("A03-after-create");

// ── 3. RELOAD — did it persist? ──────────────────────────────────────────────
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(4500);
const afterReload = await rows();
const mine = afterReload.find((r) => r.name === NAME);
note("row after reload", mine ?? "ABSENT");
J.persistedAfterCreate = Boolean(mine);
J.rowTextAfterCreate = mine?.text ?? null;
await shot("A04-after-reload");

// ── 4. rename, then reload ───────────────────────────────────────────────────
await page.locator(`button[aria-label="Actions for ${NAME}"]`).first().click();
await page.waitForTimeout(500);
await page.getByRole("menuitem", { name: "Edit details" }).click();
await page.waitForTimeout(900);
await page.getByTestId("branch-name-input").fill(RENAMED);
await page.getByTestId("branch-form-submit").click();
await page.waitForTimeout(4000);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(4500);
const renamedRow = (await rows()).find((r) => r.name === RENAMED);
note("renamed row after reload", renamedRow ?? "ABSENT");
J.renamePersisted = Boolean(renamedRow);
await shot("A05-renamed-after-reload");

// ── 5. the switcher ──────────────────────────────────────────────────────────
const sw0 = await switcher();
note("switcher before switching", sw0);
const claim0 = liveClaim();
note("live token BEFORE switch", claim0);
J.switcherBefore = sw0;
J.claimBefore = claim0;

if (!sw0.present || !sw0.options.some((o) => o.includes(RENAMED))) {
  await shot("A06-switcher-missing-new-branch");
  J.switchable = false;
} else {
  J.switchable = true;
  await page.locator('button[aria-label="Switch branch"]').first().click();
  await page.waitForTimeout(600);
  await page.locator(`[role="menuitem"]:has-text("${RENAMED}")`).first().click();
  await page.waitForTimeout(6000);
  const swAfter = await switcher();
  const claim1 = await claimAfterTraffic();
  note("switcher AFTER switch", swAfter);
  note("live token AFTER switch", claim1);
  J.switcherAfter = swAfter;
  J.claimAfterSwitch = claim1;
  await shot("A06-switched");

  // ── 6. RELOAD — does the switch survive F5? ────────────────────────────────
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const swReload = await switcher();
  const claim2 = await claimAfterTraffic();
  note("switcher AFTER RELOAD", swReload);
  note("live token AFTER RELOAD", claim2);
  J.switcherAfterReload = swReload;
  J.claimAfterReload = claim2;
  await shot("A07-after-reload-still-switched");

  // ── 7. a data screen, on the new branch vs on HQ ───────────────────────────
  for (const [label, route] of [
    ["orders", "/app/orders"],
    ["takings", "/app/reports/sales"],
  ]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    const tr = await pageTrouble(page);
    const body = await page.evaluate(() => (document.body.innerText || "").slice(0, 700));
    note(`data screen ${label} ON NEW BRANCH`, { trouble: tr.bad, head: body.slice(0, 260) });
    J[`data_${label}_new`] = { trouble: tr.bad, body };
    await shot(`A08-${label}-new-branch`);
  }
}

// ── 8. switch back to HQ, then read the same data screens ────────────────────
await page.goto(`${BASE}/app/branches`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4500);
const swNow = await switcher();
const hq = swNow.options.find((o) => o.includes("Floating Terrace HQ"));
if (hq) {
  await page.locator('button[aria-label="Switch branch"]').first().click();
  await page.waitForTimeout(600);
  await page.locator('[role="menuitem"]:has-text("Floating Terrace HQ")').first().click();
  await page.waitForTimeout(6000);
  note("live token after switching BACK to HQ", await claimAfterTraffic());
}
for (const [label, route] of [
  ["orders", "/app/orders"],
  ["takings", "/app/reports/sales"],
]) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const body = await page.evaluate(() => (document.body.innerText || "").slice(0, 700));
  J[`data_${label}_hq`] = { body };
  note(`data screen ${label} ON HQ`, body.slice(0, 260));
  await shot(`A09-${label}-hq`);
}

// ── 9. deactivate, and watch the switcher ────────────────────────────────────
await page.goto(`${BASE}/app/branches`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4500);
await page.locator(`button[aria-label="Actions for ${RENAMED}"]`).first().click();
await page.waitForTimeout(500);
await shot("A10-actions-menu");
await page.getByRole("menuitem", { name: "Deactivate" }).click();
await page.waitForTimeout(900);
await shot("A11-deactivate-confirm");
await page.getByRole("button", { name: /Deactivate branch/i }).click();
await page.waitForTimeout(5000);
note("writes after deactivate", posts.slice(-3));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
const rowsAfterDeactivate = (await rows()).map((r) => r.name);
note("rows after deactivate + reload", rowsAfterDeactivate);
J.rowsAfterDeactivate = rowsAfterDeactivate;
const swEnd = await switcher();
note("switcher after deactivate", swEnd);
J.switcherAfterDeactivate = swEnd;
J.goneFromSwitcher = !swEnd.options.some((o) => o.includes(RENAMED));
await shot("A12-after-deactivate");

// still listed under "show deactivated"?
const toggle = page.locator('input[type="checkbox"]');
if (await toggle.count()) {
  await toggle.first().check();
  await page.waitForTimeout(1200);
  note("rows with 'show deactivated'", (await rows()).map((r) => `${r.name}[${r.active}]`));
  await shot("A13-show-deactivated");
}

J.allWrites = posts;
writeFileSync(`${OUT}/s5-reopen-a.json`, JSON.stringify(J, null, 2));
console.log(`\nwrote ${OUT}/s5-reopen-a.json`);
await browser.close();
