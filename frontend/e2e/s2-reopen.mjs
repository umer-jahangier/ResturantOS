/*
 * S2 RE-OPEN — an independent drive of "Revoke a role", plus the adjacent paths the
 * original proof did not touch.
 *
 * A: my own happy path (assign on a 2nd branch, revoke from the panel, reload, persist,
 *    sign in as the subject and confirm the branch is gone).
 * B: THE LAST ROLE. The confirmation dialog makes a factual claim — "It is their only
 *    role, so the account will no longer be able to sign in until another role is
 *    assigned." Revoke the last role and try to sign in. A destructive confirmation that
 *    lies is worse than no confirmation.
 * C: the PRIMARY role — revoke it and see what the panel and the server say afterwards.
 * D: wrong personas — manager, cashier — control hidden AND server refuses.
 * E: cross-tenant — Control Bistro's admin against a Floating Terrace user.
 * F: self-revoke — is the control offered on your OWN row? (observed, never clicked)
 *
 * Nothing injects a token. Every persona signs in for real.
 */
import { PEOPLE, newBrowser, newPage, apiGet, apiSend, tokenOf, totpNow } from "./shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/S2/reopen");
mkdirSync(OUT, { recursive: true });

const journal = {};
const log = (k, v) => {
  journal[k] = v;
  console.log(`  · ${k} = ${JSON.stringify(v)}`);
};
const save = () => writeFileSync(`${OUT}/_reopen.json`, JSON.stringify(journal, null, 2));

const ADMIN = {
  slug: "floating-terrace",
  email: "admin@terrace.local",
  password: "Terrace#Admin1",
  totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS",
};
const OTHER_TENANT_ADMIN = {
  slug: "control-bistro-isolation-test-tenant",
  email: "admin@control.local",
  password: "Control#Admin1",
  totpSecret: "SEWG2C54BPUGZOVH5TYN2ZYF5HLWYCUG",
};

async function login(page, who, password = who.password) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await slug.count()) await slug.first().fill(who.slug);
    await page.locator('input[name="email"], input#email').first().fill(who.email);
    await page.locator('input[name="password"], input#password').first().fill(password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(3500);
    const totp = page.locator('input[name="totpCode"], input#totpCode');
    if (await totp.count()) {
      if (!who.totpSecret) throw new Error(`${who.email} challenged for TOTP with no secret`);
      await totp.first().fill(totpNow(who.totpSecret));
      await page.locator('button[type="submit"]').first().click();
    }
    try {
      await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 45_000 });
      await page.waitForTimeout(2500);
      console.log(`  ✓ signed in as ${who.email}`);
      return page;
    } catch {
      console.log(`  … attempt ${attempt + 1} did not land (${page.url()})`);
      await page.waitForTimeout(31_000);
    }
  }
  throw new Error(`login failed for ${who.email} — still at ${page.url()}`);
}

/** Sign-in attempt that is EXPECTED to be able to fail. Reports what actually happened. */
async function trySignIn(page, who, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(who.slug);
  await page.locator('input[name="email"], input#email').first().fill(who.email);
  await page.locator('input[name="password"], input#password').first().fill(password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(9000);
  const totpVisible = await page.locator('input[name="totpCode"], input#totpCode').count();
  const state = await page.evaluate(() => ({
    url: location.href,
    alerts: Array.from(document.querySelectorAll('[role="alert"]'))
      .map((n) => (n.textContent || "").trim())
      .filter(Boolean),
    bodySnippet: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 400),
  }));
  return { ...state, totpVisible: totpVisible > 0, reachedApp: !state.url.includes("/login") };
}

async function png(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`    shot: ${name}.png`);
}

async function trouble(page) {
  return page.evaluate(() => {
    const t = document.body.innerText || "";
    const bad = [];
    if (/Couldn.t load|Something went wrong|SERVICE_UNAVAILABLE|Failed to fetch/i.test(t))
      bad.push("load-failure");
    if (/Access denied|You do not have permission/i.test(t)) bad.push("access-denied");
    if (/This page doesn.t exist/i.test(t)) bad.push("404");
    return {
      bad,
      alerts: Array.from(document.querySelectorAll('[role="alert"]'))
        .map((n) => (n.textContent || "").trim())
        .filter(Boolean)
        .slice(0, 4),
    };
  });
}

async function selectUser(page, email) {
  const search = page
    .locator('input[type="search"], input[placeholder*="Search" i], input[aria-label*="Search" i]')
    .first();
  if (await search.count()) {
    await search.fill(email);
    await page.waitForTimeout(2500);
  }
  await page.getByText(email, { exact: false }).first().click();
  await page.waitForTimeout(2500);
}

/** Read the Roles-by-branch block exactly the way the register's probe did. */
async function rolesProbe(page) {
  return page.evaluate(() => {
    const h = Array.from(document.querySelectorAll("h3")).find((n) =>
      /Roles by branch/i.test(n.textContent || ""),
    );
    if (!h) return { foundRolesBlock: false };
    const block = h.parentElement;
    return {
      foundRolesBlock: true,
      rolesBlockText: (block.innerText || "").replace(/\s+/g, " ").trim(),
      buttonsInsideRolesBlock: Array.from(block.querySelectorAll("button")).map(
        (b) => b.getAttribute("aria-label") || (b.textContent || "").trim(),
      ),
      anyRevokeText: /revoke/i.test(block.innerText || ""),
    };
  });
}

/** Click the row's Revoke, read the dialog, optionally confirm. */
async function revokeViaUi(page, roleCode, branchNameText, { confirm = true } = {}) {
  const btn = page.getByRole("button", { name: `Revoke ${roleCode} at ${branchNameText}` });
  const found = await btn.count();
  if (!found) return { controlFound: false };
  await btn.first().click();
  await page.waitForTimeout(1200);
  const dialogText = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"], [role="alertdialog"]');
    return d ? (d.innerText || "").replace(/\s+/g, " ").trim() : null;
  });
  if (!confirm) return { controlFound: true, dialogText, confirmed: false };
  await page.getByRole("button", { name: /^Revoke role$/ }).first().click();
  await page.waitForTimeout(3500);
  const after = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"], [role="alertdialog"]');
    return {
      dialogStillOpen: !!d,
      dialogAlert: d
        ? Array.from(d.querySelectorAll('[role="alert"]'))
            .map((n) => (n.textContent || "").trim())
            .join(" | ")
        : null,
      toasts: Array.from(document.querySelectorAll("[data-sonner-toast], [role='status']"))
        .map((n) => (n.textContent || "").trim())
        .filter(Boolean)
        .slice(0, 3),
    };
  });
  return { controlFound: true, dialogText, confirmed: true, ...after };
}

const browser = await newBrowser();
const SUBJECT_PASSWORD = "Reopen#Subj1";
try {
  // ══════════ Setup ══════════════════════════════════════════════════════════
  const owner = await newPage(browser);
  await login(owner, PEOPLE.owner);
  await owner.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(3500);
  log("usersPageTrouble", await trouble(owner));

  const ownerToken = await tokenOf(owner);
  const branches = (await apiGet(owner, "/api/v1/branches", ownerToken)).body?.data ?? [];
  // Ten agents share this tenant and several have created branches in it. Pin the two
  // SEEDED branches by exact name rather than "the first one that is not Rooftop".
  const rooftop = branches.find((b) => b.name === "Floating Terrace — Rooftop");
  const hq = branches.find((b) => b.name === "Floating Terrace HQ");
  if (!rooftop || !hq) throw new Error("seeded branches not found: " + branches.map((b) => b.name));
  log("branches", { hq: hq?.name, rooftop: rooftop?.name });

  const stamp = Date.now();
  const email = `s2.reopen.${stamp}@terrace.local`;
  const created = await apiSend(owner, "POST", "/api/v1/users", {
    email,
    fullName: "S2 Reopen Subject",
    branchId: hq.id,
    roleCode: "CASHIER",
  });
  log("createdSubject", { status: created.status, id: created.body?.data?.id });
  const subjectId = created.body?.data?.id;
  if (!subjectId) throw new Error("no subject id: " + JSON.stringify(created.body).slice(0, 300));
  const tempPassword = created.body?.data?.tempPassword;
  log("gotTempPassword", !!tempPassword);

  const granted = await apiSend(owner, "POST", `/api/v1/users/${subjectId}/branch-roles`, {
    branchId: rooftop.id,
    roleCode: "MANAGER",
  });
  log("grantedRooftopMANAGER", granted.status);

  // Give the subject a usable password FIRST, so "can they still sign in" is answerable later.
  const subj = await newPage(browser);
  const first = await trySignIn(
    subj,
    { slug: "floating-terrace", email },
    tempPassword,
  );
  log("subjectFirstSignIn", { url: first.url, reachedApp: first.reachedApp });
  // forced password change
  const newPw = subj.locator('input[name="newPassword"], input#newPassword');
  if (await newPw.count()) {
    await subj
      .locator('input[name="currentPassword"], input#currentPassword')
      .first()
      .fill(tempPassword);
    await newPw.first().fill(SUBJECT_PASSWORD);
    const confirmPw = subj.locator(
      'input[name="confirmPassword"], input#confirmPassword, input[name="confirmNewPassword"]',
    );
    if (await confirmPw.count()) await confirmPw.first().fill(SUBJECT_PASSWORD);
    await subj.locator('button[type="submit"]').first().click();
    await subj.waitForTimeout(6000);
  }
  log("subjectAfterPasswordChange", subj.url());
  await png(subj, "b01-subject-signed-in-before-any-revoke");
  await subj.context().close();
  save();

  // ══════════ A — my own happy path ══════════════════════════════════════════
  await owner.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(3000);
  await selectUser(owner, email);
  await png(owner, "a01-panel-two-roles");
  log("A_probeBeforeRevoke", await rolesProbe(owner));

  const a = await revokeViaUi(owner, "MANAGER", rooftop.name, { confirm: false });
  log("A_dialogText", a.dialogText);
  await png(owner, "a02-dialog-names-role-and-branch");
  // confirm from the open dialog
  await owner.getByRole("button", { name: /^Revoke role$/ }).first().click();
  await owner.waitForTimeout(3500);
  log(
    "A_toasts",
    await owner.evaluate(() =>
      Array.from(document.querySelectorAll("[data-sonner-toast], [role='status']"))
        .map((n) => (n.textContent || "").trim())
        .filter(Boolean)
        .slice(0, 3),
    ),
  );
  await png(owner, "a03-after-revoke");

  await owner.reload({ waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(3500);
  await selectUser(owner, email);
  log("A_probeAfterReload", await rolesProbe(owner));
  await png(owner, "a04-after-reload");
  log(
    "A_serverAssignments",
    ((await apiGet(owner, `/api/v1/users/${subjectId}`, ownerToken)).body?.data?.assignments ?? [])
      .map((x) => `${x.roleCode}@${x.branchId === hq.id ? "HQ" : x.branchId}`),
  );
  save();

  // subject can still sign in (one role left) and cannot reach Rooftop
  {
    const s = await newPage(browser);
    const r = await trySignIn(s, { slug: "floating-terrace", email }, SUBJECT_PASSWORD);
    log("A_subjectStillSignsIn", { reachedApp: r.reachedApp, url: r.url });
    if (r.reachedApp) {
      const t = await tokenOf(s);
      log("A_subjectReadsRooftop", await apiGet(s, `/api/v1/branches/${rooftop.id}`, t));
      log(
        "A_subjectSwitchRooftop",
        await apiSend(s, "POST", "/api/v1/auth/switch-branch", { branchId: rooftop.id }, t),
      );
      log(
        "A_subjectSeesRooftopOnScreen",
        await s.evaluate(() => /rooftop/i.test(document.body.innerText || "")),
      );
    }
    await png(s, "a05-subject-after-first-revoke");
    await s.context().close();
  }
  save();

  // ══════════ F — is Revoke offered on your OWN row? (observed, not clicked) ══
  await owner.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(3000);
  await selectUser(owner, PEOPLE.owner.email);
  log("F_selfProbe", await rolesProbe(owner));
  await png(owner, "f01-owner-own-row");
  save();

  // ══════════ B + C — the LAST role, which is also the PRIMARY role ══════════
  await owner.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(3000);
  await selectUser(owner, email);
  const probeBeforeLast = await rolesProbe(owner);
  log("B_probeBeforeLastRevoke", probeBeforeLast);
  log("B_rowSaysPrimary", /primary/i.test(probeBeforeLast.rolesBlockText || ""));

  const b = await revokeViaUi(owner, "CASHIER", hq.name, { confirm: false });
  log("B_lastRoleDialogText", b.dialogText);
  log(
    "B_dialogClaimsCannotSignIn",
    /no longer be able to sign in/i.test(b.dialogText || ""),
  );
  await png(owner, "b02-last-role-dialog");
  await owner.getByRole("button", { name: /^Revoke role$/ }).first().click();
  await owner.waitForTimeout(4000);
  log(
    "B_afterLastRevoke",
    await owner.evaluate(() => ({
      dialogStillOpen: !!document.querySelector('[role="dialog"], [role="alertdialog"]'),
      toasts: Array.from(document.querySelectorAll("[data-sonner-toast], [role='status']"))
        .map((n) => (n.textContent || "").trim())
        .filter(Boolean)
        .slice(0, 3),
    })),
  );
  await owner.reload({ waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(3500);
  await selectUser(owner, email);
  log("B_probeAfterLastRevoke", await rolesProbe(owner));
  await png(owner, "b03-no-roles-left");
  log(
    "B_serverAssignmentsAfterLast",
    (await apiGet(owner, `/api/v1/users/${subjectId}`, ownerToken)).body?.data?.assignments ?? [],
  );
  save();

  // THE CLAIM UNDER TEST — can the account still sign in?
  {
    const s = await newPage(browser);
    const r = await trySignIn(s, { slug: "floating-terrace", email }, SUBJECT_PASSWORD);
    log("B_signInAfterLastRoleRevoked", {
      reachedApp: r.reachedApp,
      url: r.url,
      alerts: r.alerts,
      snippet: r.bodySnippet.slice(0, 220),
    });
    if (r.reachedApp) {
      const t = await tokenOf(s);
      log("B_tokenAfterLastRoleRevoked", !!t);
      log("B_branchesMine", await apiGet(s, "/api/v1/branches/mine", t));
      log("B_readsHqBranch", await apiGet(s, `/api/v1/branches/${hq.id}`, t));
    }
    await png(s, "b04-signin-attempt-after-last-role-revoked");
    await s.context().close();
  }
  save();

  // ══════════ D — wrong personas ═════════════════════════════════════════════
  // restore a role so there is something to try to revoke
  const restored = await apiSend(owner, "POST", `/api/v1/users/${subjectId}/branch-roles`, {
    branchId: rooftop.id,
    roleCode: "MANAGER",
  });
  log("D_restoredRooftopMANAGER", restored.status);

  for (const who of [PEOPLE.manager, PEOPLE.cashier]) {
    const p = await newPage(browser);
    try {
      await login(p, who);
      await p.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
      await p.waitForTimeout(3500);
      const tr = await trouble(p);
      let probe = { reachedRoster: false };
      if (!tr.bad.includes("access-denied") && !tr.bad.includes("404")) {
        try {
          await selectUser(p, email);
          probe = { reachedRoster: true, ...(await rolesProbe(p)) };
        } catch (e) {
          probe = { reachedRoster: true, selectFailed: String(e).slice(0, 120) };
        }
      }
      const tok = await tokenOf(p);
      const direct = await apiSend(
        p,
        "DELETE",
        `/api/v1/users/${subjectId}/branch-roles?branchId=${rooftop.id}&roleCode=MANAGER`,
        undefined,
        tok,
      );
      log(`D_${who.email.split("@")[0]}`, {
        pageTrouble: tr,
        probe,
        directDelete: { status: direct.status, code: direct.body?.error?.code },
      });
      await png(p, `d01-${who.email.split("@")[0]}-users-page`);
    } catch (e) {
      log(`D_${who.email.split("@")[0]}_ERROR`, String(e).slice(0, 200));
    }
    await p.context().close();
  }
  log(
    "D_assignmentsSurvivedWrongPersonas",
    ((await apiGet(owner, `/api/v1/users/${subjectId}`, ownerToken)).body?.data?.assignments ?? [])
      .map((x) => x.roleCode),
  );
  save();

  // ══════════ Tenant admin vs the role ceiling — my own live re-check ════════
  {
    const ownerGrantsOwner = await apiSend(
      owner,
      "POST",
      `/api/v1/users/${subjectId}/branch-roles`,
      { branchId: rooftop.id, roleCode: "OWNER" },
    );
    log("E_ownerGrantsOWNERatRooftop", ownerGrantsOwner.status);

    const ad = await newPage(browser);
    await login(ad, ADMIN);
    await ad.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
    await ad.waitForTimeout(3500);
    const adToken = await tokenOf(ad);
    log("E_adminAssignOWNER", {
      ...(await apiSend(
        ad,
        "POST",
        `/api/v1/users/${subjectId}/branch-roles`,
        { branchId: rooftop.id, roleCode: "OWNER" },
        adToken,
      ).then((r) => ({ status: r.status, code: r.body?.error?.code }))),
    });
    const revokeOwner = await apiSend(
      ad,
      "DELETE",
      `/api/v1/users/${subjectId}/branch-roles?branchId=${rooftop.id}&roleCode=OWNER`,
      undefined,
      adToken,
    );
    log("E_adminRevokeOWNER", {
      status: revokeOwner.status,
      code: revokeOwner.body?.error?.code,
      message: revokeOwner.body?.error?.message,
      messageLength: (revokeOwner.body?.error?.message ?? "").length,
    });
    log(
      "E_assignmentsAfterRefusedRevoke",
      ((await apiGet(owner, `/api/v1/users/${subjectId}`, ownerToken)).body?.data?.assignments ?? [])
        .map((x) => x.roleCode),
    );
    // and the refusal INSIDE the dialog, driven through the UI
    await selectUser(ad, email);
    const ui = await revokeViaUi(ad, "OWNER", rooftop.name, { confirm: true });
    log("E_adminUiRefusal", {
      controlFound: ui.controlFound,
      dialogStillOpen: ui.dialogStillOpen,
      dialogAlert: ui.dialogAlert,
    });
    await png(ad, "e01-admin-refused-in-dialog");
    await ad.context().close();
  }
  save();

  // ══════════ E2 — CROSS-TENANT ══════════════════════════════════════════════
  {
    const other = await newPage(browser);
    await login(other, OTHER_TENANT_ADMIN);
    const otherToken = await tokenOf(other);
    log("X_otherTenantAdminSignedIn", other.url());
    log(
      "X_crossTenantReadUser",
      await apiGet(other, `/api/v1/users/${subjectId}`, otherToken).then((r) => ({
        status: r.status,
        code: r.body?.error?.code,
      })),
    );
    const xr = await apiSend(
      other,
      "DELETE",
      `/api/v1/users/${subjectId}/branch-roles?branchId=${rooftop.id}&roleCode=OWNER`,
      undefined,
      otherToken,
    );
    log("X_crossTenantRevoke", { status: xr.status, code: xr.body?.error?.code });
    await other.context().close();
  }
  log(
    "X_assignmentsAfterCrossTenant",
    ((await apiGet(owner, `/api/v1/users/${subjectId}`, ownerToken)).body?.data?.assignments ?? [])
      .map((x) => x.roleCode),
  );
  save();

  console.log("\nDONE — journal at", `${OUT}/_reopen.json`);
} catch (e) {
  journal.FATAL = String(e).slice(0, 500);
  save();
  console.error("FATAL", e);
  process.exitCode = 1;
} finally {
  save();
  await browser.close();
}
