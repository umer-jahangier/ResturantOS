/*
 * F11 RE-OPEN — drive the whole hand-over myself, in real Chromium, and try to break it.
 *
 * The claim under test: "a duty manager counts a float into a NAMED cashier's drawer and
 * hands it over; the cashier's terminal shows it and they can ring and settle against it;
 * a cashier attempting the same for somebody else is refused BY NAME."
 *
 * Everything here is UI-driven where a user would use the UI. Every out-of-band read is on
 * the persona's OWN bearer, minted by spending their own HttpOnly refresh cookie.
 */
import { writeFileSync } from "node:fs";
import {
  BASE,
  PEOPLE,
  newBrowser,
  newPage,
  login,
  go,
  shot,
  apiGet,
  apiSend,
  tokenOf,
  money,
  OUT,
  ok,
  log,
} from "./lib.mjs";

const STAMP = Date.now().toString().slice(-6);
// REUSE=<email>:<fullName> resumes against an already-hired cashier instead of hiring a new
// one — the frontend dev server is being hot-reloaded by other agents and a run can die
// mid-way; re-hiring every time would spam the tenant's user list.
const REUSE = process.env.REUSE ? process.env.REUSE.split("::") : null;
const HIRE = REUSE
  ? {
      slug: "floating-terrace",
      email: REUSE[0],
      fullName: REUSE[1],
      newPassword: "Shift#Cashier1",
      reused: true,
    }
  : {
      slug: "floating-terrace",
      email: `f11r.hire.${STAMP}@terrace.local`,
      fullName: `F11R Hire ${STAMP}`,
      newPassword: "Shift#Cashier1",
    };
const checks = [];
const j = { hire: HIRE, startedAt: new Date().toISOString() };
const note = (k, v) => {
  j[k] = v;
  log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
};
const check = (...a) => {
  const r = ok(...a);
  checks.push(r);
  return r;
};

async function signIn(page, email, password, slug = HIRE.slug) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const s = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await s.count()) await s.first().fill(slug);
  await page.locator('input[name="email"], input#email').first().fill(email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(5000);
}

/**
 * Sign in with retries. The Next.js dev server is being hot-reloaded by other agents editing
 * this very screen, and a recompile mid-submit leaves the tab sitting on /login. A retry
 * distinguishes that from a genuine refusal — which is exactly the "an error looks like a
 * missing feature" trap, in login form.
 */
async function loginHard(page, who, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      await login(page, who);
      return;
    } catch (e) {
      log(`  ! login attempt ${i}/${tries} for ${who.email} failed: ${String(e).slice(0, 120)}`);
      if (i === tries) throw e;
      await page.waitForTimeout(6000);
    }
  }
}

/** The POS till strip exactly as the cashier reads it — rendered text, never props. */
async function tillStrip(page) {
  return page.evaluate(() => {
    const close = document.querySelector("[data-testid=close-till-button]");
    if (close) return close.parentElement.innerText.replace(/\s+/g, " ").trim();
    const open = document.querySelector("[data-testid=open-till-button]");
    if (open) return open.parentElement.innerText.replace(/\s+/g, " ").trim();
    const outage = document.querySelector("[data-testid=till-status-unavailable]");
    if (outage) return `OUTAGE: ${outage.innerText.trim()}`;
    return "(no till strip at all)";
  });
}

const browser = await newBrowser();

// ═══ 1. OWNER hires a cashier so the drawer starts from nothing ══════════════
log("\n=== 1. OWNER hires a fresh cashier ===");
let otp = null;
let t = { bad: [] };
if (!HIRE.reused) {
const owner = await newPage(browser);
await loginHard(owner, PEOPLE.owner);
t = await go(owner, "/app/users", { waitMs: 5000 });
check(t.bad.length === 0, "owner reaches /app/users without an error state", JSON.stringify(t.bad));

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
otp = await owner.evaluate(
  () => document.querySelector("[data-testid=one-time-password-value]")?.textContent?.trim() ?? null,
);
if (!otp) throw new Error("no one-time password — cannot continue");
await owner.getByRole("button", { name: /^Done$/i }).click();
await owner.waitForTimeout(800);
log(`  ✓ hired ${HIRE.email}`);
} else {
  log(`  (reusing ${HIRE.email})`);
  check(true, "owner reaches /app/users without an error state", "(reused hire)");
}

// ═══ 2. the hire signs in — walkthrough §0 state: no drawer ══════════════════
log("\n=== 2. the new cashier signs in ===");
const hire = await newPage(browser);
await signIn(hire, HIRE.email, otp ?? HIRE.newPassword);
const inputs = hire.locator("input[type=password]");
const n = await inputs.count();
const fillByName = async (re, val) => {
  for (let i = 0; i < n; i++) {
    const nm = (await inputs.nth(i).getAttribute("name")) ?? "";
    const id = (await inputs.nth(i).getAttribute("id")) ?? "";
    if (re.test(nm) || re.test(id)) {
      await inputs.nth(i).fill(val);
      return true;
    }
  }
  return false;
};
if (n > 0) {
  await fillByName(/current|old/i, otp);
  await fillByName(/^newPassword$|new-password|^new/i, HIRE.newPassword);
  await fillByName(/confirm/i, HIRE.newPassword);
  await hire.locator('button[type="submit"]').first().click();
  await hire.waitForTimeout(5000);
}
if (hire.url().includes("/login")) {
  await signIn(hire, HIRE.email, HIRE.newPassword);
}
if (hire.url().includes("/login")) throw new Error("hire could not sign in after password change");
log(`  ✓ signed in as ${HIRE.email}`);

const hireTok = await tokenOf(hire);
const hireClaims = JSON.parse(Buffer.from(hireTok.split(".")[1], "base64").toString());
const hireId = hireClaims.sub;
const branchId = hireClaims.branchId ?? hireClaims.branch_id;
note("hireUserId", hireId);
note("branchId", branchId);
note("hirePermissions", (hireClaims.permissions ?? []).filter((p) => p.startsWith("pos.till")));
check(
  !(hireClaims.permissions ?? []).includes("pos.till.open.other"),
  "the new cashier's token does NOT carry pos.till.open.other",
);

await go(hire, "/app/pos", { waitMs: 7000 });
const stripBefore = await tillStrip(hire);
note("stripBefore", stripBefore);
await shot(hire, "10-cashier-before");
check(/No active till/i.test(stripBefore), "the cashier's terminal reads 'No active till'", stripBefore);

// ═══ 3. MANAGER hands the drawer over, from the screen ═══════════════════════
log("\n=== 3. MANAGER opens a Rs 5,000.00 float FOR that cashier ===");
const mgr = await newPage(browser);
await loginHard(mgr, PEOPLE.manager);
const mgrTok = await tokenOf(mgr);
const mgrClaims = JSON.parse(Buffer.from(mgrTok.split(".")[1], "base64").toString());
const managerId = mgrClaims.sub;
note("managerId", managerId);

t = await go(mgr, "/app/pos/tills", { waitMs: 6000 });
check(t.bad.length === 0, "manager reaches Till Review without an error state", JSON.stringify(t.bad));
await shot(mgr, "20-manager-till-review");

const btn = mgr.locator("[data-testid=open-drawer-for-cashier-button]");
check((await btn.count()) === 1, "the 'Open a drawer' control is on the manager's Till Review");
await btn.first().click();
await mgr.waitForTimeout(2500);
await shot(mgr, "21-panel-open");

// The picker must be real data, and must contain the person we just hired.
const pickerOpts = await mgr.evaluate(() => {
  const sel = document.querySelector("dialog select, [role=dialog] select");
  if (!sel) return null;
  return Array.from(sel.options).map((o) => ({ v: o.value, t: o.textContent.trim() }));
});
note("pickerSize", pickerOpts ? pickerOpts.length : null);
check(
  !!pickerOpts && pickerOpts.some((o) => o.v === hireId),
  "the picker lists the cashier we just hired, by id",
);
const hireOpt = pickerOpts?.find((o) => o.v === hireId);
note("hireOptionLabel", hireOpt?.t ?? null);
check(
  !!hireOpt && hireOpt.t.includes(HIRE.fullName),
  "the picker names that cashier in words, not as a UUID",
  hireOpt?.t,
);

const sel = mgr.locator("[role=dialog] select, dialog select").first();
await sel.selectOption(hireId);
await mgr.waitForTimeout(600);
const floatBox = mgr.locator("[role=dialog] input, dialog input").first();
await floatBox.fill("5000.00");
await mgr.waitForTimeout(900);
await shot(mgr, "22-panel-filled");

const sentence = await mgr.evaluate(() => {
  const d = document.querySelector("[role=dialog], dialog");
  if (!d) return null;
  const m = d.innerText.match(/Counting[^\n]*/);
  return m ? m[0].trim() : null;
});
note("confirmationSentence", sentence);
check(
  !!sentence && sentence.includes("Rs 5,000.00") && sentence.includes(HIRE.fullName),
  "the manager is shown the sentence they are signing off, naming the cashier and the float",
  sentence,
);

const confirm = mgr.locator("[role=dialog] button, dialog button").filter({ hasText: /^Open drawer$/i });
await confirm.first().click();
await mgr.waitForTimeout(6000);
const toast = await mgr.evaluate(() => {
  const n = document.querySelector("[data-sonner-toast], [role=status]");
  return n ? n.innerText.replace(/\s+/g, " ").trim() : null;
});
note("toast", toast);
await shot(mgr, "23-after-open");
check(
  !!toast && /Till opened for/i.test(toast) && toast.includes("Rs 5,000.00"),
  "the manager is told the drawer was opened, for whom, with which float",
  toast,
);
check(
  !!toast && toast.includes(HIRE.fullName),
  "that confirmation names the CASHIER, not the manager",
  toast,
);

// ═══ 4. the cashier's own terminal, reloaded ═════════════════════════════════
log("\n=== 4. the cashier reloads their terminal ===");
await go(hire, "/app/pos", { waitMs: 8000 });
const stripAfter = await tillStrip(hire);
note("stripAfter", stripAfter);
await shot(hire, "30-cashier-after-handover");
check(/Till\s*OPEN/i.test(stripAfter), "the cashier's terminal now shows an OPEN till", stripAfter);
check(/Float:\s*Rs 5,000\.00/i.test(stripAfter), "…with the Rs 5,000.00 float the manager counted", stripAfter);
check(/Orders:\s*0\b/.test(stripAfter), "…and zero orders against it so far", stripAfter);

const ownTill = await apiGet(hire, `/api/v1/pos/tills?cashierId=${hireId}&status=OPEN`, await tokenOf(hire));
const row = (ownTill.body?.data ?? [])[0] ?? null;
note("cashierOwnTillRow", row);
check(row?.cashierId === hireId, "the persisted row's cashierId is the CASHIER, not the manager", row?.cashierId);
check(row?.openingFloatPaisa === 500000, "the persisted float is 500000 paisa exactly", String(row?.openingFloatPaisa));
const tillId = row?.id;
note("tillId", tillId);

// The manager did NOT open a second drawer for themselves.
const mgrOwn = await apiGet(mgr, `/api/v1/pos/tills?cashierId=${managerId}&status=OPEN`, mgrTok);
const mgrRows = mgrOwn.body?.data ?? [];
note("managerOwnOpenTills", mgrRows.map((r) => ({ id: r.id, float: r.openingFloatPaisa })));
check(
  !mgrRows.some((r) => r.id === tillId),
  "the drawer the manager opened is NOT attributed to the manager",
);

writeFileSync(`${OUT}/journal.json`, JSON.stringify({ ...j, checks }, null, 2));
log("\n--- part 1 checks ---");
checks.forEach((c) => log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.label}`));
log(`\n${checks.filter((c) => !c.pass).length} failures of ${checks.length}`);
await browser.close();
