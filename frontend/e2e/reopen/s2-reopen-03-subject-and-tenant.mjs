/*
 * S2 RE-OPEN — part 3.
 *
 *  CLAUSE 3 of DONE MEANS, driven properly: the subject SIGNS IN for real (temp password →
 *  forced change → real session) and we check they no longer reach the branch whose role was
 *  taken, while still reaching the one they kept.
 *
 *  Plus: pinning down the cross-tenant 204 found in part 2. Is DELETE the only verb on this
 *  resource that answers success for another tenant's user, or do assign/read do it too?
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/S2/reopen2");
mkdirSync(OUT, { recursive: true });
const J = {};
const log = (k, v) => { J[k] = v; console.log(`  · ${k} = ${JSON.stringify(v).slice(0, 500)}`); };
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ""}`);
};

const T = {
  owner: { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" },
  controlOwner: { slug: "control-bistro-isolation-test-tenant", email: "owner@control.local", password: "Control#Owner1", totpSecret: "77YCNG564SWVW7YPUCJRGDSE6ZSCC3GQ" },
};

function totpNow(secret) {
  const b32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) {
    const i = b32.indexOf(c); if (i < 0) continue;
    bits += i.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8);
  ctr.writeBigInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const h = createHmac("sha1", bytes).update(ctr).digest();
  const o = h[19] & 0xf;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}
async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  return ctx.newPage();
}
async function login(page, who, password = who.password) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await slug.count()) await slug.first().fill(who.slug);
    await page.locator('input[name="email"], input#email').first().fill(who.email);
    await page.locator('input[name="password"], input#password').first().fill(password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(3500);
    const totp = page.locator('input[name="totpCode"], input#totpCode');
    if (await totp.count() && who.totpSecret) {
      await totp.first().fill(totpNow(who.totpSecret));
      await page.locator('button[type="submit"]').first().click();
    }
    try {
      await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 40_000 });
      await page.waitForTimeout(2500);
      console.log(`  ✓ signed in as ${who.email}`);
      return true;
    } catch { await page.waitForTimeout(12_000); }
  }
  return false;
}
async function tokenOf(page) {
  return page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" }, body: "{}",
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
}
async function api(page, method, path, payload, token) {
  const t = token ?? (await tokenOf(page));
  return page.evaluate(
    async ({ m, p, b, tok }) => {
      const r = await fetch(`http://localhost:8080${p}`, {
        method: m, credentials: "include",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(),
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: b === undefined ? undefined : JSON.stringify(b),
      });
      let body = null; try { body = await r.json(); } catch { body = null; }
      return { status: r.status, body };
    }, { m: method, p: path, b: payload, tok: t });
}
const asList = (b) => (Array.isArray(b) ? b : (b?.data ?? b?.content ?? b?.items ?? []));
const revokeUrl = (u, b, r) => `/api/v1/users/${u}/branch-roles?branchId=${b}&roleCode=${encodeURIComponent(r)}`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const owner = await newPage(browser);
  if (!(await login(owner, T.owner))) throw new Error("owner login failed");
  const oTok = await tokenOf(owner);

  const br = await api(owner, "GET", "/api/v1/branches/mine", undefined, oTok);
  const branches = asList(br.body);
  const hq = branches.find((b) => b.isHq);
  const second = branches.find((b) => !b.isHq);
  log("branches", { hq: hq.name, second: second.name });

  // ══════════════ a subject who works BOTH branches, then loses one
  const stamp = Date.now().toString(36);
  const email = `s2sub.${stamp}@terrace.local`;
  const cr = await api(owner, "POST", "/api/v1/users",
    { email, firstName: "S2Sub", lastName: "Ject", branchId: hq.id, roleCode: "CASHIER" }, oTok);
  const cb = cr.body?.data ?? cr.body;
  const id = cb?.id, temp = cb?.tempPassword;
  log("subject", { email, id, status: cr.status });
  const g = await api(owner, "POST", `/api/v1/users/${id}/branch-roles`,
    { branchId: second.id, roleCode: "MANAGER" }, oTok);
  log("grantSecond", g.status);

  // The subject sets their own password and signs in — BEFORE the revoke, so we can prove
  // the branch was reachable and it is the REVOKE that removed it, not a fresh account's
  // general emptiness.
  const sub = await newPage(browser);
  await sub.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await sub.waitForTimeout(1500);
  const slug = sub.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill("floating-terrace");
  await sub.locator('input[name="email"], input#email').first().fill(email);
  await sub.locator('input[name="password"], input#password').first().fill(temp);
  await sub.locator('button[type="submit"]').first().click();
  await sub.waitForTimeout(4000);
  const NEWPW = "S2Reopen#Pass9x";
  const bodyNow = await sub.evaluate(() => (document.body.innerText || "").slice(0, 200));
  log("subjectAfterFirstSignIn", bodyNow);
  const pwFields = sub.locator('input[type="password"]');
  const n = await pwFields.count();
  log("passwordFieldsOnForcedChange", n);
  if (n >= 3) {
    await pwFields.nth(0).fill(temp);
    await pwFields.nth(1).fill(NEWPW);
    await pwFields.nth(2).fill(NEWPW);
  } else if (n === 2) {
    await pwFields.nth(0).fill(NEWPW);
    await pwFields.nth(1).fill(NEWPW);
  }
  await sub.locator('button[type="submit"], button:has-text("Change password")').first().click();
  await sub.waitForTimeout(5000);
  await sub.screenshot({ path: `${OUT}/b01-subject-after-change.png` });

  const signedIn = await login(sub, { slug: "floating-terrace", email }, NEWPW);
  log("subjectSignedIn", signedIn);
  check("the subject can sign in while they hold roles at two branches", signedIn);

  const sTokBefore = await tokenOf(sub);
  const beforeMine = await api(sub, "GET", "/api/v1/branches/mine", undefined, sTokBefore);
  const beforeList = asList(beforeMine.body).map((b) => b.name);
  log("subjectBranchesBEFORErevoke", beforeList);
  check(
    "BEFORE the revoke the subject reaches BOTH branches",
    beforeList.includes(hq.name) && beforeList.includes(second.name),
    beforeList,
  );
  const beforeSwitch = await api(sub, "POST", "/api/v1/auth/switch-branch", { branchId: second.id }, sTokBefore);
  log("subjectSwitchToSecondBEFORE", beforeSwitch.status);
  check("BEFORE the revoke the subject can switch INTO the second branch", beforeSwitch.status < 400, { status: beforeSwitch.status });

  // ══════════════ the owner revokes THROUGH THE SCREEN
  await owner.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(4000);
  for (let i = 0; i < 6; i++) {
    const s = owner.locator('input[type="search"], input[placeholder*="Search" i]').first();
    if (await s.count()) { await s.fill(""); await owner.waitForTimeout(500); await s.fill(email); await owner.waitForTimeout(3500); }
    const row = owner.locator(`text=${email}`).first();
    if (await row.count()) { await row.click(); await owner.waitForTimeout(3000); break; }
    await owner.waitForTimeout(10_000);
    await owner.reload({ waitUntil: "domcontentloaded" }); await owner.waitForTimeout(4000);
  }
  const btn = owner.locator(`[data-testid="revoke-role-${second.id}-MANAGER"]`);
  check("the Revoke control is on the second-branch row", (await btn.count()) > 0);
  await btn.first().click();
  await owner.waitForTimeout(1200);
  await owner.locator('button:has-text("Revoke role")').first().click();
  await owner.waitForTimeout(4000);
  await owner.screenshot({ path: `${OUT}/b02-owner-after-revoke.png` });

  // ══════════════ CLAUSE 3: the subject, with a FRESH session
  const sub2 = await newPage(browser);
  const back = await login(sub2, { slug: "floating-terrace", email }, NEWPW);
  log("subjectSignedInAfterRevoke", back);
  const sTok = await tokenOf(sub2);

  const mine = await api(sub2, "GET", "/api/v1/branches/mine", undefined, sTok);
  const names = asList(mine.body).map((b) => b.name);
  log("subjectBranchesAFTERrevoke", names);
  check(
    "AFTER the revoke the subject no longer sees the branch they lost",
    !names.includes(second.name),
    names,
  );
  check(
    "and STILL sees the branch they kept — the revoke removed one row, not all of them",
    names.includes(hq.name),
    names,
  );

  const sw = await api(sub2, "POST", "/api/v1/auth/switch-branch", { branchId: second.id }, sTok);
  log("subjectSwitchToSecondAFTER", { status: sw.status, code: (sw.body?.error ?? sw.body)?.code });
  check(
    "the subject is REFUSED switching into the branch they lost",
    sw.status >= 400,
    { status: sw.status, code: (sw.body?.error ?? sw.body)?.code },
  );
  check(
    "…and that refusal is NOT vacuous: the same call SUCCEEDED before the revoke",
    beforeSwitch.status < 400 && sw.status >= 400,
    { before: beforeSwitch.status, after: sw.status },
  );

  // A refusal to SWITCH is not the same as a refusal to READ. Ask for the lost branch's
  // data directly, with the branch named in the request.
  const readLost = await api(sub2, "GET", `/api/v1/branches/${second.id}`, undefined, sTok);
  log("subjectREADSlostBranch", { status: readLost.status, code: (readLost.body?.error ?? readLost.body)?.code });
  check(
    "the subject cannot READ the lost branch's record either",
    readLost.status >= 400,
    { status: readLost.status },
  );

  await sub2.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await sub2.waitForTimeout(4000);
  const onScreen = await sub2.evaluate((nm) => ({
    mentionsLostBranch: (document.body.innerText || "").includes(nm),
    text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 300),
  }), second.name);
  log("subjectScreenAfterRevoke", onScreen);
  await sub2.screenshot({ path: `${OUT}/b03-subject-after-revoke.png` });
  check(
    "the lost branch appears nowhere on the subject's own screen",
    !onScreen.mentionsLostBranch,
    onScreen.text.slice(0, 160),
  );

  // ══════════════ the cross-tenant 204, pinned against its siblings
  const foreign = await newPage(browser);
  if (await login(foreign, T.controlOwner)) {
    const fTok = await tokenOf(foreign);
    const read = await api(foreign, "GET", `/api/v1/users/${id}`, undefined, fTok);
    const assign = await api(foreign, "POST", `/api/v1/users/${id}/branch-roles`,
      { branchId: hq.id, roleCode: "WAITER" }, fTok);
    const revoke = await api(foreign, "DELETE", revokeUrl(id, hq.id, "CASHIER"), undefined, fTok);
    log("crossTenant_READ", read.status);
    log("crossTenant_ASSIGN", { status: assign.status, code: (assign.body?.error ?? assign.body)?.code });
    log("crossTenant_REVOKE", { status: revoke.status, body: JSON.stringify(revoke.body).slice(0, 200) });
    check(
      "cross-tenant READ is a 404 (the documented contract)",
      read.status === 404, { status: read.status });
    check(
      "cross-tenant ASSIGN is refused",
      assign.status >= 400, { status: assign.status });
    check(
      "cross-tenant REVOKE is refused the same way its siblings are",
      revoke.status >= 400, { status: revoke.status });

    const still = await api(owner, "GET", `/api/v1/users/${id}`, undefined, oTok);
    const stillList = ((still.body?.data ?? still.body)?.assignments ?? []).map((a) => a.roleCode);
    log("subjectRolesAfterCrossTenantAttempt", stillList);
    check(
      "whatever it ANSWERED, the cross-tenant call changed nothing",
      stillList.length === 1 && stillList[0] === "CASHIER",
      stillList,
    );
  }

  J._results = results;
  writeFileSync(`${OUT}/_subject.json`, JSON.stringify(J, null, 2));
  await browser.close();
  console.log(`\n  ${results.filter((r) => r.pass).length}/${results.length} checks passed`);
  const bad = results.filter((r) => !r.pass);
  if (bad.length) console.log("  FAILURES:\n" + bad.map((f) => `   - ${f.name}`).join("\n"));
})();
