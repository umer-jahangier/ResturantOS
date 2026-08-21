/*
 * S5 RE-OPEN — drive B: the adjacent paths.
 *
 *  1. A REAL data screen (/app/finance/takings, /app/pos/tills) read on HQ and on a branch
 *     created through the new screen — does the data actually move with the branch claim?
 *  2. Deactivating the branch you are STANDING ON.
 *  3. A cross-tenant write: rename Control Bistro's branch with a Floating Terrace owner token.
 *
 * Run from frontend/: node e2e/floor/s5-reopen-b.mjs
 */
import { newBrowser, newPage, login, PEOPLE, pageTrouble, apiGet, apiSend, BASE } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S5-reopen");
mkdirSync(OUT, { recursive: true });

const STAMP = String(Date.now()).slice(-5);
const NAME = `Adjacent Probe ${STAMP}`;
const OTHER_TENANT_BRANCH = "99aa0e36-6c4c-4019-98b4-2a87e21a7a2b"; // Control Bistro HQ
const HQ = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";

const J = { stamp: STAMP, name: NAME, steps: [] };
function note(s, d) {
  J.steps.push({ step: s, detail: d });
  console.log(`  · ${s}: ${typeof d === "string" ? d : JSON.stringify(d)}`);
}
const decode = (t) => {
  try {
    return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  } catch {
    return null;
  }
};

const browser = await newBrowser();
const page = await newPage(browser);
const bearers = [];
page.on("request", (r) => {
  const a = r.headers()["authorization"];
  if (a && r.url().includes("localhost:8080")) bearers.push(a.slice(7));
});
const liveClaim = () => {
  const c = decode(bearers[bearers.length - 1] ?? "");
  return c ? { branch_id: c.branch_id, tenant_id: c.tenant_id } : null;
};
const shot = async (n) => {
  await page.screenshot({ path: `${OUT}/${n}.png`, fullPage: false });
  console.log(`    shot: ${n}.png`);
};
const rows = () =>
  page.$$eval('[data-testid="branch-row"]', (ls) =>
    ls.map((r) => r.querySelector("span.truncate")?.textContent?.trim() ?? ""),
  );
async function switcher() {
  const trg = page.locator('button[aria-label="Switch branch"]');
  if ((await trg.count()) === 0) return { present: false, label: null, options: [] };
  const label = (await trg.first().innerText()).trim();
  await trg.first().click();
  await page.waitForTimeout(600);
  const options = await page.$$eval('[role="menuitem"]', (i) => i.map((n) => (n.textContent || "").trim()));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  return { present: true, label, options };
}
/** Read a screen and return what a human would see, plus whether it is failing. */
async function readScreen(route, label) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6500);
  let t = await pageTrouble(page);
  if (t.bad.length) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(7000);
    t = await pageTrouble(page);
  }
  const main = await page.evaluate(() => {
    const m = document.querySelector("main") ?? document.body;
    return (m.innerText || "").replace(/\s+/g, " ").trim().slice(0, 900);
  });
  await shot(label);
  return { trouble: t.bad, main };
}

for (let a = 1; ; a++) {
  try {
    await login(page, PEOPLE.owner);
    break;
  } catch (e) {
    if (a >= 4) throw e;
    console.log(`  ! login attempt ${a} failed`);
    await page.waitForTimeout(21000);
  }
}

// ── 0. baseline on HQ ────────────────────────────────────────────────────────
note("claim at start", liveClaim());
J.takingsHQ = await readScreen("/app/finance/takings", "B01-takings-HQ");
note("takings on HQ", J.takingsHQ);
J.tillsHQ = await readScreen("/app/pos/tills", "B02-tills-HQ");
note("till review on HQ", J.tillsHQ);

// ── 1. create a branch through the screen ────────────────────────────────────
await page.goto(`${BASE}/app/branches`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4500);
await page.getByTestId("add-branch").click();
await page.waitForTimeout(900);
await page.getByTestId("branch-name-input").fill(NAME);
await page.getByTestId("branch-address-input").fill("77 Constitution Avenue, Islamabad");
await page.getByTestId("branch-form-submit").click();
await page.waitForTimeout(4500);
note("rows after create", await rows());

// ── 2. switch to it and read the SAME data screens ───────────────────────────
const sw = await switcher();
note("switcher", sw);
if (!sw.options.some((o) => o.includes(NAME))) throw new Error("new branch not in switcher");
await page.locator('button[aria-label="Switch branch"]').first().click();
await page.waitForTimeout(600);
await page.locator(`[role="menuitem"]:has-text("${NAME}")`).first().click();
await page.waitForTimeout(6500);
note("claim after switch", liveClaim());
J.claimOnNew = liveClaim();

J.takingsNew = await readScreen("/app/finance/takings", "B03-takings-NEW");
note("takings on NEW branch", J.takingsNew);
J.tillsNew = await readScreen("/app/pos/tills", "B04-tills-NEW");
note("till review on NEW branch", J.tillsNew);
J.dataScreensDiffer =
  J.takingsHQ.main !== J.takingsNew.main || J.tillsHQ.main !== J.tillsNew.main;
note("data screens differ between HQ and the new branch", J.dataScreensDiffer);

// ── 3. deactivate the branch you are STANDING ON ─────────────────────────────
await page.goto(`${BASE}/app/branches`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4500);
await shot("B05-standing-on-it");
await page.locator(`button[aria-label="Actions for ${NAME}"]`).first().click();
await page.waitForTimeout(500);
const deactivateItem = page.getByRole("menuitem", { name: "Deactivate" });
J.deactivateDisabledWhileStandingOnIt = await deactivateItem
  .first()
  .getAttribute("aria-disabled")
  .catch(() => null);
note("Deactivate aria-disabled while standing on this branch", J.deactivateDisabledWhileStandingOnIt);
await deactivateItem.first().click();
await page.waitForTimeout(900);
const confirmBtn = page.getByRole("button", { name: /Deactivate branch/i });
if (await confirmBtn.count()) {
  await confirmBtn.first().click();
  await page.waitForTimeout(6000);
}
await shot("B06-after-self-deactivate");
const swSelf = await switcher();
note("switcher AFTER deactivating the branch I am on", swSelf);
J.switcherAfterSelfDeactivate = swSelf;
note("claim after self-deactivate", liveClaim());
J.claimAfterSelfDeactivate = liveClaim();

// what does the shell say the current branch is, now that it is gone from /mine?
J.topBarAfterSelfDeactivate = await page.evaluate(() => {
  const t = document.body.innerText || "";
  return t.split("\n").slice(0, 6).join(" | ");
});
note("shell header after self-deactivate", J.topBarAfterSelfDeactivate);

// Can this stranded session still read and WRITE branch-scoped data?
J.mineAfterSelfDeactivate = await apiGet(page, "/api/v1/branches/mine");
note("GET /branches/mine after self-deactivate", J.mineAfterSelfDeactivate.body);
J.takingsStranded = await readScreen("/app/finance/takings", "B07-takings-stranded");
note("takings while stranded on a deactivated branch", J.takingsStranded);
J.posStranded = await readScreen("/app/pos", "B08-pos-stranded");
note("POS while stranded on a deactivated branch", J.posStranded);

// ── 4. cross-tenant write ────────────────────────────────────────────────────
J.crossTenantGet = await apiGet(page, `/api/v1/branches/${OTHER_TENANT_BRANCH}`);
note("GET another tenant's branch", J.crossTenantGet);
J.crossTenantPut = await apiSend(page, "PUT", `/api/v1/branches/${OTHER_TENANT_BRANCH}`, {
  name: `PWNED BY FLOATING TERRACE ${STAMP}`,
});
note("PUT another tenant's branch", J.crossTenantPut);
J.crossTenantDelete = await apiSend(page, "DELETE", `/api/v1/branches/${OTHER_TENANT_BRANCH}`, undefined);
note("DELETE another tenant's branch", J.crossTenantDelete);

writeFileSync(`${OUT}/s5-reopen-b.json`, JSON.stringify(J, null, 2));
console.log(`\nwrote ${OUT}/s5-reopen-b.json`);
await browser.close();
