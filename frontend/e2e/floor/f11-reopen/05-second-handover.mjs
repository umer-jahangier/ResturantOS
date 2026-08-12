/*
 * F11 RE-OPEN, part 4 — an INDEPENDENT second hand-over, from scratch.
 *
 * A second cashier, hired now, handed an odd-paisa float (Rs 7,250.50) so a rounding bug
 * near money would show. Proves the toast (polled, not screenshotted after it fades), and
 * re-proves the whole path once more on a drawer nothing else has touched.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  BASE,
  PEOPLE,
  newBrowser,
  newPage,
  login,
  go,
  shot,
  apiGet,
  tokenOf,
  OUT,
  ok,
  log,
} from "./lib.mjs";

const prev = JSON.parse(readFileSync(`${OUT}/journal.json`, "utf8"));
const STAMP = Date.now().toString().slice(-6);
const HIRE = {
  slug: "floating-terrace",
  email: `f11r.second.${STAMP}@terrace.local`,
  fullName: `F11R Second ${STAMP}`,
  newPassword: "Shift#Cashier1",
};
const FLOAT_TEXT = "7250.50";
const FLOAT_PAISA = 725050;
const FLOAT_SHOWN = "Rs 7,250.50";

const out = { secondHire: HIRE };
const checks = [];
const note = (k, v) => {
  out[k] = v;
  log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
};
const check = (...a) => {
  const r = ok(...a);
  checks.push(r);
  return r;
};

async function signIn(page, email, password) {
  for (let i = 0; i < 3; i++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await s.count()) await s.first().fill(HIRE.slug);
    await page.locator('input[name="email"], input#email').first().fill(email);
    await page.locator('input[name="password"], input#password').first().fill(password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(5500);
    if (!page.url().includes("/login") || (await page.locator("input[type=password]").count()) > 1)
      return;
  }
  throw new Error(`login failed for ${email}`);
}
async function loginHard(page, who, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      await login(page, who);
      return;
    } catch (e) {
      if (i === tries) throw e;
      await page.waitForTimeout(6000);
    }
  }
}
const stripOf = (page) =>
  page.evaluate(() => {
    const c = document.querySelector("[data-testid=close-till-button]");
    if (c) return c.parentElement.innerText.replace(/\s+/g, " ").trim();
    const o = document.querySelector("[data-testid=open-till-button]");
    if (o) return o.parentElement.innerText.replace(/\s+/g, " ").trim();
    return "(no till strip)";
  });
async function catchToast(page, ms = 12000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const t = await page.evaluate(() => {
      const n = document.querySelector("[data-sonner-toast]");
      return n ? n.innerText.replace(/\s+/g, " ").trim() : "";
    });
    if (t) return t;
    await page.waitForTimeout(200);
  }
  return "";
}

const browser = await newBrowser();

// ── hire ──────────────────────────────────────────────────────────────────────
log("\n=== hire a second cashier ===");
const owner = await newPage(browser);
await loginHard(owner, PEOPLE.owner);
await go(owner, "/app/users", { waitMs: 5000 });
await owner.getByRole("button", { name: /add (a )?user|new user/i }).first().click();
await owner.waitForTimeout(1200);
await owner.locator("input[type=email]").first().fill(HIRE.email);
const nameInput = owner.locator('input[placeholder="Optional"]');
if (await nameInput.count()) await nameInput.first().fill(HIRE.fullName);
const branchSel = owner.locator("#create-user-branch");
const branchOpts = await branchSel.locator("option").allTextContents();
const mainIdx = branchOpts.findIndex((x) => /HQ|Floating Terrace$/i.test(x.trim()));
await branchSel.selectOption({ index: mainIdx > 0 ? mainIdx : 1 });
await owner.waitForTimeout(400);
const roleSel = owner.locator("[data-testid=role-select]");
const roleOpts = await roleSel.locator("option").allTextContents();
await roleSel.selectOption({ label: roleOpts.find((x) => /cashier/i.test(x)) });
await owner.waitForTimeout(400);
await owner.getByRole("button", { name: /^Create user$/i }).click();
await owner.waitForTimeout(4500);
const otp = await owner.evaluate(
  () => document.querySelector("[data-testid=one-time-password-value]")?.textContent?.trim() ?? null,
);
if (!otp) throw new Error("no one-time password");
await owner.getByRole("button", { name: /^Done$/i }).click();
log(`  ✓ hired ${HIRE.email}`);

const hire = await newPage(browser);
await signIn(hire, HIRE.email, otp);
const pw = hire.locator("input[type=password]");
const n = await pw.count();
const byName = async (re, val) => {
  for (let i = 0; i < n; i++) {
    const nm = (await pw.nth(i).getAttribute("name")) ?? "";
    const id = (await pw.nth(i).getAttribute("id")) ?? "";
    if (re.test(nm) || re.test(id)) return pw.nth(i).fill(val), true;
  }
  return false;
};
if (n > 0) {
  await byName(/current|old/i, otp);
  await byName(/^newPassword$|new-password|^new/i, HIRE.newPassword);
  await byName(/confirm/i, HIRE.newPassword);
  await hire.locator('button[type="submit"]').first().click();
  await hire.waitForTimeout(5000);
}
if (hire.url().includes("/login")) await signIn(hire, HIRE.email, HIRE.newPassword);
const hTok = await tokenOf(hire);
const hClaims = JSON.parse(Buffer.from(hTok.split(".")[1], "base64").toString());
const hireId = hClaims.sub;
const branchId = hClaims.branchId ?? hClaims.branch_id;
note("secondHireId", hireId);

await go(hire, "/app/pos", { waitMs: 7000 });
const before = await stripOf(hire);
note("stripBefore", before);
await shot(hire, "60-second-cashier-before");
check(/No active till/i.test(before), "the second cashier starts with no drawer", before);

// ── hand over ────────────────────────────────────────────────────────────────
log("\n=== the manager counts Rs 7,250.50 into their drawer ===");
const mgr = await newPage(browser);
await loginHard(mgr, PEOPLE.manager);
await go(mgr, "/app/pos/tills", { waitMs: 6000 });
await mgr.locator("[data-testid=open-drawer-for-cashier-button]").first().click();
await mgr.waitForTimeout(2500);
await mgr.locator("[role=dialog] select, dialog select").first().selectOption(hireId);
await mgr.waitForTimeout(600);
await mgr.locator("[role=dialog] input, dialog input").first().fill(FLOAT_TEXT);
await mgr.waitForTimeout(1000);
const sentence = await mgr.evaluate(() => {
  const d = document.querySelector("[role=dialog], dialog");
  const m = d ? d.innerText.match(/Counting[^\n]*/) : null;
  return m ? m[0].trim() : null;
});
note("sentence", sentence);
await shot(mgr, "61-panel-filled");
check(
  !!sentence && sentence.includes(FLOAT_SHOWN) && sentence.includes(HIRE.fullName),
  "an odd-paisa float is echoed back exactly, naming the cashier",
  sentence,
);
const confirmBtn = mgr.locator("[data-testid=open-drawer-confirm-button]");
check(await confirmBtn.first().isEnabled(), "the confirm control is enabled for an eligible target");
await confirmBtn.first().click();
const toast = await catchToast(mgr);
note("toast", toast);
await shot(mgr, "62-toast");
check(!!toast, "the manager gets a confirmation at all", toast);
check(toast.includes(HIRE.fullName), "…which names the CASHIER the drawer was opened for", toast);
check(toast.includes(FLOAT_SHOWN), "…and the float, to the paisa", toast);

// ── the cashier's terminal ───────────────────────────────────────────────────
log("\n=== the second cashier reloads ===");
await go(hire, "/app/pos", { waitMs: 8000 });
const after = await stripOf(hire);
note("stripAfter", after);
await shot(hire, "63-second-cashier-after");
check(/Till\s*OPEN/i.test(after), "their terminal shows an OPEN till", after);
check(after.includes(`Float: ${FLOAT_SHOWN}`), `…with ${FLOAT_SHOWN} — no float rounding`, after);
check(after.includes(`Cash: ${FLOAT_SHOWN}`), "…and cash equal to the float on an empty drawer", after);

const rows = await apiGet(hire, `/api/v1/pos/tills?cashierId=${hireId}&status=OPEN`, await tokenOf(hire));
const r0 = (rows.body?.data ?? [])[0] ?? {};
note("row", r0);
check(r0.cashierId === hireId, "the persisted drawer is the CASHIER's", r0.cashierId);
check(r0.openingFloatPaisa === FLOAT_PAISA, `the persisted float is ${FLOAT_PAISA} paisa exactly`, String(r0.openingFloatPaisa));

writeFileSync(`${OUT}/journal-2.json`, JSON.stringify({ ...out, checks4: checks }, null, 2));
log("\n--- part 4 checks ---");
checks.forEach((c) => log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.label}`));
log(`\n${checks.filter((c) => !c.pass).length} failures of ${checks.length}`);
await browser.close();
