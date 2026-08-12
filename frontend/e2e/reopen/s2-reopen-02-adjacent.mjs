/*
 * S2 RE-OPEN — the adjacent paths. This is where a "fixed for one case" fix breaks.
 *
 *  A. The subject signs in — do they still reach the branch whose role was taken? (clause 3)
 *  B. The role ceiling on the PUBLIC route the BUTTON actually drives — not the internal door
 *     the other agent measured. A TENANT_ADMIN must be refused revoking OWNER. (clause 4)
 *  C. The WRONG personas — manager, cashier, waiter. Button hidden AND server refusing.
 *  D. CROSS-TENANT — Control Bistro's owner reaching into Floating Terrace.
 *  E. The LAST role — the dialog promises "the account will no longer be able to sign in".
 *     Does it actually? A promise in copy that the system does not keep is a defect.
 *  F. Junk input — an unknown role code, a role the user does not hold, a foreign branch id.
 *  G. Does the audit trail now name the ACTOR (the W-15-02 claim)?
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/S2/reopen2");
mkdirSync(OUT, { recursive: true });
const J = {};
const log = (k, v) => {
  J[k] = v;
  console.log(`  · ${k} = ${JSON.stringify(v).slice(0, 500)}`);
};
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ""}`);
};
const save = () => {
  J._results = results;
  writeFileSync(`${OUT}/_adjacent.json`, JSON.stringify(J, null, 2));
};

const T = {
  owner: { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" },
  admin: { slug: "floating-terrace", email: "admin@terrace.local", password: "Terrace#Admin1", totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS" },
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  controlOwner: { slug: "control-bistro-isolation-test-tenant", email: "owner@control.local", password: "Control#Owner1", totpSecret: "77YCNG564SWVW7YPUCJRGDSE6ZSCC3GQ" },
};

function totpNow(secret) {
  const b32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) {
    const i = b32.indexOf(c);
    if (i < 0) continue;
    bits += i.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8);
  ctr.writeBigInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const h = createHmac("sha1", bytes).update(ctr).digest();
  const o = h[19] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1e6).padStart(6, "0");
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
    if (await totp.count()) {
      await totp.first().fill(totpNow(who.totpSecret));
      await page.locator('button[type="submit"]').first().click();
    }
    try {
      await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 45_000 });
      await page.waitForTimeout(2500);
      console.log(`  ✓ signed in as ${who.email}`);
      return true;
    } catch {
      await page.waitForTimeout(15_000);
    }
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
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body: b === undefined ? undefined : JSON.stringify(b),
      });
      let body = null;
      try { body = await r.json(); } catch { body = null; }
      return { status: r.status, body };
    },
    { m: method, p: path, b: payload, tok: t },
  );
}
const asList = (b) => (Array.isArray(b) ? b : (b?.data ?? b?.content ?? b?.items ?? []));
async function assignmentsOf(page, userId, token) {
  const r = await api(page, "GET", `/api/v1/users/${userId}`, undefined, token);
  const d = r.body?.data ?? r.body;
  return { status: r.status, list: d?.assignments ?? [] };
}
const revokeUrl = (uid, bid, role) =>
  `/api/v1/users/${uid}/branch-roles?branchId=${bid}&roleCode=${encodeURIComponent(role)}`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const st = JSON.parse(readFileSync(`${OUT}/_state.json`, "utf8"));
  log("subjectFromDrive", { email: st.subject, id: st.subjectId, hq: st.hq.name, second: st.second.name });

  // ══════════════════════════════════════════════════ owner sets up a fresh victim
  const owner = await newPage(browser);
  if (!(await login(owner, T.owner))) throw new Error("owner login failed");
  const ownerTok = await tokenOf(owner);

  const stamp = Date.now().toString(36);
  const vEmail = `s2adj.${stamp}@terrace.local`;
  const cr = await api(owner, "POST", "/api/v1/users",
    { email: vEmail, firstName: "S2Adj", lastName: "Victim", branchId: st.hq.id, roleCode: "CASHIER" }, ownerTok);
  const cb = cr.body?.data ?? cr.body;
  const victimId = cb?.id;
  log("victimCreated", { status: cr.status, id: victimId });
  // Give them a MANAGER role at the second branch too.
  const g = await api(owner, "POST", `/api/v1/users/${victimId}/branch-roles`,
    { branchId: st.second.id, roleCode: "MANAGER" }, ownerTok);
  log("victimGrantSecond", g.status);

  // ══════════════════════════════════════════════════ B. THE CEILING ON THE PUBLIC ROUTE
  // The other agent proved the ceiling on /internal/auth/**. The BUTTON drives /api/v1/**.
  // Make the victim an OWNER at HQ, then have the TENANT_ADMIN try to revoke it.
  const mkOwner = await api(owner, "POST", `/api/v1/users/${victimId}/branch-roles`,
    { branchId: st.hq.id, roleCode: "OWNER" }, ownerTok);
  log("victimPromotedToOWNER", { status: mkOwner.status });

  const admin = await newPage(browser);
  if (!(await login(admin, T.admin))) throw new Error("admin login failed");
  const adminTok = await tokenOf(admin);

  const adminPerms = await api(admin, "GET", "/api/v1/auth/me", undefined, adminTok);
  const permList = (adminPerms.body?.data ?? adminPerms.body)?.permissions ?? [];
  log("adminHasRbacManage", permList.includes("rbac.manage"));

  const adminAssign = await api(admin, "POST", `/api/v1/users/${victimId}/branch-roles`,
    { branchId: st.hq.id, roleCode: "OWNER" }, adminTok);
  log("ADMIN assign OWNER (public route)", { status: adminAssign.status, code: (adminAssign.body?.error ?? adminAssign.body)?.code });

  const adminRevoke = await api(admin, "DELETE", revokeUrl(victimId, st.hq.id, "OWNER"), undefined, adminTok);
  log("ADMIN revoke OWNER (public route)", { status: adminRevoke.status, body: JSON.stringify(adminRevoke.body).slice(0, 300) });

  const afterAdminTry = await assignmentsOf(owner, victimId, ownerTok);
  log("victimRolesAfterAdminRevokeAttempt", afterAdminTry.list.map((a) => a.roleCode));
  check(
    "the role ceiling REFUSES a tenant admin revoking OWNER on the PUBLIC route the button drives",
    adminRevoke.status === 403,
    { status: adminRevoke.status },
  );
  check(
    "and the OWNER assignment SURVIVES the refusal",
    afterAdminTry.list.some((a) => a.roleCode === "OWNER"),
    afterAdminTry.list.map((a) => a.roleCode),
  );
  check(
    "assign and revoke agree — a role you cannot grant is a role you cannot destroy",
    adminAssign.status === adminRevoke.status,
    { assign: adminAssign.status, revoke: adminRevoke.status },
  );

  // The refusal must be readable — the frontend replaces anything over 160 chars.
  const refusalMsg = (adminRevoke.body?.error ?? adminRevoke.body)?.message ?? "";
  log("refusalMessage", refusalMsg);
  log("refusalMessageLength", refusalMsg.length);
  check(
    "the refusal sentence fits the 160-char budget the dialog can render",
    refusalMsg.length > 0 && refusalMsg.length <= 160,
    { len: refusalMsg.length },
  );

  // Put the victim back to MANAGER at HQ so later steps are not about OWNER.
  await api(owner, "DELETE", revokeUrl(victimId, st.hq.id, "OWNER"), undefined, ownerTok);
  await api(owner, "POST", `/api/v1/users/${victimId}/branch-roles`,
    { branchId: st.hq.id, roleCode: "CASHIER" }, ownerTok);

  // ══════════════════════════════════════════════════ C. THE WRONG PERSONAS
  for (const [name, who] of [["manager", T.manager], ["cashier", T.cashier]]) {
    const p = await newPage(browser);
    const ok = await login(p, who);
    if (!ok) { check(`${name} could sign in`, false); continue; }
    const tok = await tokenOf(p);

    // Server first — the only thing that matters.
    const r = await api(p, "DELETE", revokeUrl(victimId, st.second.id, "MANAGER"), undefined, tok);
    log(`${name} revoke (server)`, { status: r.status, code: (r.body?.error ?? r.body)?.code });
    check(
      `a ${name} is REFUSED the revoke server-side`,
      r.status === 401 || r.status === 403,
      { status: r.status },
    );

    // And the screen must not offer it.
    await p.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
    await p.waitForTimeout(4000);
    const seen = await p.evaluate(() => ({
      text: (document.body.innerText || "").slice(0, 300),
      revokeButtons: Array.from(document.querySelectorAll("button"))
        .map((b) => b.getAttribute("aria-label") || (b.textContent || "").trim())
        .filter((s) => /revoke/i.test(s)),
    }));
    log(`${name} sees on /app/users`, seen);
    check(`a ${name} is offered no revoke control`, seen.revokeButtons.length === 0, seen.revokeButtons);
    await p.context().close();
  }

  const stillThere = await assignmentsOf(owner, victimId, ownerTok);
  log("victimRolesAfterWrongPersonas", stillThere.list.map((a) => a.roleCode));
  check(
    "no wrong-persona attempt removed anything",
    stillThere.list.length === 2,
    stillThere.list.map((a) => a.roleCode),
  );

  // ══════════════════════════════════════════════════ D. CROSS-TENANT
  const foreign = await newPage(browser);
  if (await login(foreign, T.controlOwner)) {
    const fTok = await tokenOf(foreign);
    const fRead = await api(foreign, "GET", `/api/v1/users/${victimId}`, undefined, fTok);
    log("Control Bistro READS Floating Terrace user", { status: fRead.status });
    const fRevoke = await api(foreign, "DELETE", revokeUrl(victimId, st.second.id, "MANAGER"), undefined, fTok);
    log("Control Bistro REVOKES Floating Terrace role", { status: fRevoke.status, body: JSON.stringify(fRevoke.body).slice(0, 200) });
    check(
      "another tenant's OWNER cannot revoke this tenant's role",
      fRevoke.status >= 400,
      { status: fRevoke.status },
    );
    const afterForeign = await assignmentsOf(owner, victimId, ownerTok);
    check(
      "and nothing was removed by the cross-tenant attempt",
      afterForeign.list.length === 2,
      afterForeign.list.map((a) => a.roleCode),
    );
    log("crossTenantReadLeak", fRead.status);
    check(
      "another tenant's OWNER cannot READ this tenant's user either",
      fRead.status >= 400,
      { status: fRead.status },
    );
    await foreign.context().close();
  } else {
    check("control-bistro owner could sign in", false);
  }

  // ══════════════════════════════════════════════════ F. JUNK INPUT
  const unknownRole = await api(owner, "DELETE", revokeUrl(victimId, st.second.id, "NOT_A_ROLE"), undefined, ownerTok);
  log("revoke unknown role code", { status: unknownRole.status, code: (unknownRole.body?.error ?? unknownRole.body)?.code });
  check(
    "an unknown role code is a 400, not a silent 204",
    unknownRole.status === 400,
    { status: unknownRole.status },
  );

  const notHeld = await api(owner, "DELETE", revokeUrl(victimId, st.second.id, "WAITER"), undefined, ownerTok);
  log("revoke a role the user does not hold", { status: notHeld.status });
  const afterNotHeld = await assignmentsOf(owner, victimId, ownerTok);
  check(
    "revoking a role the user never held removes nothing",
    afterNotHeld.list.length === 2,
    afterNotHeld.list.map((a) => a.roleCode),
  );

  const foreignBranch = await api(owner, "DELETE",
    revokeUrl(victimId, "00000000-0000-0000-0000-000000000001", "MANAGER"), undefined, ownerTok);
  log("revoke at a branch id that is not this tenant's", { status: foreignBranch.status });

  const noParams = await api(owner, "DELETE", `/api/v1/users/${victimId}/branch-roles`, undefined, ownerTok);
  log("revoke with NO query params (the pre-fix client)", { status: noParams.status, msg: (noParams.body?.error ?? noParams.body)?.message });
  check(
    "the parameterless call the old client sent is still a 400 — the fix was the client, not a loosened server",
    noParams.status === 400,
    { status: noParams.status },
  );

  // ══════════════════════════════════════════════════ E. THE LAST ROLE
  // The dialog promises: "this is their only role, the account will no longer be able to sign in".
  // Drive it and hold the product to its own sentence.
  await api(owner, "DELETE", revokeUrl(victimId, st.second.id, "MANAGER"), undefined, ownerTok);
  const oneLeft = await assignmentsOf(owner, victimId, ownerTok);
  log("victimRolesBeforeLastRevoke", oneLeft.list.map((a) => a.roleCode));

  await owner.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(4000);
  for (let i = 0; i < 6; i++) {
    const s = owner.locator('input[type="search"], input[placeholder*="Search" i]').first();
    if (await s.count()) { await s.fill(""); await owner.waitForTimeout(500); await s.fill(vEmail); await owner.waitForTimeout(3500); }
    const row = owner.locator(`text=${vEmail}`).first();
    if (await row.count()) { await row.click(); await owner.waitForTimeout(3000); break; }
    await owner.waitForTimeout(10_000);
    await owner.reload({ waitUntil: "domcontentloaded" });
    await owner.waitForTimeout(4000);
  }
  const lastBtn = owner.locator(`[data-testid="revoke-role-${st.hq.id}-CASHIER"]`);
  check("the last remaining role still offers a Revoke control", (await lastBtn.count()) > 0);
  if (await lastBtn.count()) {
    await lastBtn.first().click();
    await owner.waitForTimeout(1200);
    const dlg = await owner.evaluate(() => {
      const d = document.querySelector('[role="dialog"], [role="alertdialog"]');
      return d ? (d.innerText || "").replace(/\s+/g, " ") : null;
    });
    log("lastRoleDialogText", dlg);
    check(
      "the dialog WARNS that this is their only role and the account can no longer sign in",
      Boolean(dlg) && /only role/i.test(dlg) && /sign in/i.test(dlg),
      dlg?.slice(0, 260),
    );
    await owner.screenshot({ path: `${OUT}/a01-last-role-dialog.png` });
    await owner.locator('button:has-text("Revoke role")').first().click();
    await owner.waitForTimeout(3500);
  }
  const noneLeft = await assignmentsOf(owner, victimId, ownerTok);
  log("victimRolesAfterLastRevoke", noneLeft.list.map((a) => a.roleCode));
  check("the last role is actually gone", noneLeft.list.length === 0, noneLeft.list);

  // Now hold the copy to its promise: can the account still sign in?
  const stranded = await newPage(browser);
  const strandedLoggedIn = await login(
    stranded,
    { slug: "floating-terrace", email: vEmail, password: "x" },
    cb?.tempPassword,
  );
  const strandedUrl = stranded.url();
  const strandedText = await stranded.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 400));
  log("strandedAccountLoginLanded", strandedLoggedIn);
  log("strandedAccountUrl", strandedUrl);
  log("strandedAccountScreen", strandedText);
  await stranded.screenshot({ path: `${OUT}/a02-stranded-account.png` });
  check(
    "the dialog's promise holds: an account with no roles cannot get into the app",
    !strandedLoggedIn || /login|sign in|no access|denied|not been assigned|contact/i.test(strandedText),
    { landed: strandedLoggedIn, url: strandedUrl, screen: strandedText.slice(0, 200) },
  );

  save();
  await browser.close();
  console.log(`\n  ${results.filter((r) => r.pass).length}/${results.length} checks passed`);
  const failed = results.filter((r) => !r.pass);
  if (failed.length) console.log("  FAILURES:\n" + failed.map((f) => `   - ${f.name}`).join("\n"));
})();
