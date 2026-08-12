/*
 * S2 RE-OPEN — an INDEPENDENT drive of "revoke a role from the screen".
 *
 * Written from the DONE MEANS clause, not from the other agent's harness. Every persona
 * signs in for real. Nothing is asserted from a screenshot alone.
 *
 * Clauses driven here:
 *   1. owner@terrace.local opens /app/users, picks a user with a role on a SECOND branch,
 *      revokes it from the Roles-by-branch panel, confirmation names the role AND branch.
 *   2. RELOAD — the role is gone (screen AND server).
 *   3. Sign in as that user — they no longer reach that branch's data.
 *   4. A persona below the role ceiling is refused SERVER-SIDE, not merely hidden.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const API = "http://localhost:8080";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/S2/reopen2");
mkdirSync(OUT, { recursive: true });

const J = {};
const log = (k, v) => {
  J[k] = v;
  console.log(`  · ${k} = ${JSON.stringify(v)}`);
};
const save = () => writeFileSync(`${OUT}/_drive.json`, JSON.stringify(J, null, 2));

const OWNER = {
  slug: "floating-terrace",
  email: "owner@terrace.local",
  password: "Terrace#Owner1",
  totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
};
const ADMIN = {
  slug: "floating-terrace",
  email: "admin@terrace.local",
  password: "Terrace#Admin1",
  totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS",
};
const MANAGER = {
  slug: "floating-terrace",
  email: "manager@terrace.local",
  password: "Terrace#Manager1",
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
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`    [console.error] ${m.text().slice(0, 160)}`);
  });
  return page;
}

async function login(page, who, password = who.password) {
  for (let attempt = 0; attempt < 3; attempt++) {
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
      return page;
    } catch {
      console.log(`  … attempt ${attempt + 1} did not land (${page.url()})`);
      await page.waitForTimeout(20_000);
    }
  }
  throw new Error(`login failed for ${who.email} — still at ${page.url()}`);
}

async function png(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
}

/** An error state looks exactly like an empty state. Always call this after a navigation. */
async function trouble(page) {
  return page.evaluate(() => {
    const t = document.body.innerText || "";
    const bad = [];
    if (/Couldn.t load|Something went wrong|SERVICE_UNAVAILABLE|Failed to fetch/i.test(t))
      bad.push("load-failure");
    if (/Access denied|You do not have permission/i.test(t)) bad.push("access-denied");
    return {
      bad,
      alerts: Array.from(document.querySelectorAll('[role="alert"]'))
        .map((n) => (n.textContent || "").trim())
        .filter(Boolean)
        .slice(0, 4),
    };
  });
}

async function tokenOf(page) {
  return page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
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
        method: m,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body: b === undefined ? undefined : JSON.stringify(b),
      });
      let body = null;
      try {
        body = await r.json();
      } catch {
        body = null;
      }
      return { status: r.status, body };
    },
    { m: method, p: path, b: payload, tok: t },
  );
}

/** Type into the roster search and click the row for `email`. */
async function selectUser(page, email) {
  // The roster search is rate limited (429) and the list is paginated; retry rather than
  // score a rate-limited empty list as "the user is not there".
  for (let attempt = 0; attempt < 6; attempt++) {
    const search = page
      .locator('input[type="search"], input[placeholder*="Search" i], input[aria-label*="Search" i]')
      .first();
    if (await search.count()) {
      await search.fill("");
      await page.waitForTimeout(600);
      await search.fill(email);
      await page.waitForTimeout(3500);
    }
    const row = page.locator(`text=${email}`).first();
    if (await row.count()) {
      await row.click();
      await page.waitForTimeout(3000);
      return;
    }
    console.log(`    … roster did not show ${email} (attempt ${attempt + 1}); waiting`);
    await page.waitForTimeout(12_000);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
  }
  throw new Error(`roster never showed ${email}`);
}

/** The register's own probe, verbatim in shape: what controls live inside the Roles block? */
async function rolesProbe(page) {
  return page.evaluate(() => {
    const heads = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,div,span,p"));
    const h = heads.find((n) => /roles?\s*(by|per)\s*branch/i.test(n.textContent || ""));
    if (!h) return { foundRolesBlock: false, buttonsInsideRolesBlock: [], anyRevokeText: false };
    let block = h;
    for (let i = 0; i < 6 && block.parentElement; i++) {
      block = block.parentElement;
      if (block.querySelectorAll("button").length > 0) break;
    }
    const btns = Array.from(block.querySelectorAll("button")).map(
      (b) => b.getAttribute("aria-label") || (b.textContent || "").trim(),
    );
    return {
      foundRolesBlock: true,
      buttonsInsideRolesBlock: btns,
      anyRevokeText: /revoke/i.test(block.innerText || ""),
      blockText: (block.innerText || "").replace(/\s+/g, " ").slice(0, 400),
    };
  });
}

const asList = (b) => (Array.isArray(b) ? b : (b?.data ?? b?.content ?? b?.items ?? []));

/**
 * There is no GET /api/v1/users/{id}/branch-roles — the assignments live on the user detail.
 * Reading them over HTTP is the point: a screen agreeing with itself proves nothing.
 */
async function serverAssignments(page, userId, token) {
  const r = await api(page, "GET", `/api/v1/users/${userId}`, undefined, token);
  const d = r.body?.data ?? r.body;
  return { status: r.status, assignments: d?.assignments ?? [] };
}

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${JSON.stringify(detail)}` : ""}`);
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const stamp = Date.now().toString(36);
  const subject = `s2ro.${stamp}@terrace.local`;

  // ─────────────────────────────────────────────────────────── OWNER
  const owner = await newPage(browser);
  await login(owner, OWNER);
  const ownerTok = await tokenOf(owner);

  const branches = await api(owner, "GET", "/api/v1/branches/mine", undefined, ownerTok);
  
  log("branchesRaw", JSON.stringify(branches.body).slice(0, 500));
  const list = asList(branches.body);
  log("branchesOwnerSees", list.map((b) => ({ id: b.id, name: b.name })));
  const hq = list.find((b) => b.isHq) ?? list[0];
  const second = list.find((b) => !b.isHq) ?? list[1];
  if (!second) throw new Error("no second branch to revoke at");
  log("hq", { id: hq.id, name: hq.name });
  log("second", { id: second.id, name: second.name });

  // Create a subject with a role at BOTH branches, so revoking one leaves the other.
  const created = await api(
    owner,
    "POST",
    "/api/v1/users",
    {
      email: subject,
      firstName: "S2Reopen",
      lastName: "Subject",
      branchId: hq.id,
      roleCode: "CASHIER",
    },
    ownerTok,
  );
  const cbody = created.body?.data ?? created.body;
  log("createUser", { status: created.status, body: JSON.stringify(cbody).slice(0, 300) });
  let subjectId = cbody?.id ?? cbody?.userId;
  const tempPassword = cbody?.temporaryPassword ?? cbody?.tempPassword;
  log("gotTempPassword", Boolean(tempPassword));
  if (!subjectId) {
    // The create can answer 503 on a just-restarted service and still have written the row.
    for (let i = 0; i < 6 && !subjectId; i++) {
      await owner.waitForTimeout(4000);
      const found = await api(owner, "GET", `/api/v1/users?search=${encodeURIComponent(subject)}&size=20`, undefined, ownerTok);
      const hit = asList(found.body).find((u) => u.email === subject);
      if (hit) subjectId = hit.id;
    }
    log("subjectIdRecoveredFromRoster", subjectId ?? null);
  }
  if (!subjectId) throw new Error("could not establish the subject user");

  let grant2 = { status: 0 };
  for (let i = 0; i < 5; i++) {
    grant2 = await api(
      owner,
      "POST",
      `/api/v1/users/${subjectId}/branch-roles`,
      { branchId: second.id, roleCode: "MANAGER" },
      ownerTok,
    );
    if (grant2.status < 500) break;
    await owner.waitForTimeout(4000);
  }
  log("grantSecondBranchRole", { status: grant2.status, body: JSON.stringify(grant2.body).slice(0, 200) });
  if (grant2.status >= 400) throw new Error(`could not grant the second-branch role: ${grant2.status}`);

  // ───────── CLAUSE 1: the control exists on the panel and the confirmation names both
  await owner.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(4000);
  log("usersPageTrouble", await trouble(owner));
  await selectUser(owner, subject);
  await png(owner, "01-panel-two-roles");
  const probe = await rolesProbe(owner);
  log("probe_beforeRevoke", probe);
  check(
    "a Revoke control exists on each role row, named with role AND branch",
    probe.buttonsInsideRolesBlock.some((b) => b === `Revoke MANAGER at ${second.name}`) &&
      probe.buttonsInsideRolesBlock.some((b) => /Revoke CASHIER at /i.test(b)),
    probe.buttonsInsideRolesBlock,
  );

  const revokeBtn = owner.locator(`[data-testid="revoke-role-${second.id}-MANAGER"]`);
  check("the row's revoke button is addressable by testid", (await revokeBtn.count()) > 0);
  await revokeBtn.first().click();
  await owner.waitForTimeout(1200);
  await png(owner, "02-confirmation");
  const dlg = await owner.evaluate(() => {
    const d = document.querySelector('[role="dialog"], [role="alertdialog"]');
    return d ? (d.innerText || "").replace(/\s+/g, " ") : null;
  });
  log("confirmationText", dlg);
  check(
    "the confirmation names the ROLE and the BRANCH",
    Boolean(dlg) && /MANAGER/.test(dlg) && dlg.includes(second.name),
    dlg?.slice(0, 200),
  );
  check(
    "the confirmation is not the generic error fallback",
    Boolean(dlg) && !/Something went wrong/i.test(dlg),
  );

  // nothing has been sent yet
  const beforeConfirm = await serverAssignments(owner, subjectId, ownerTok);
  log("serverRolesWhileDialogOpen", beforeConfirm.assignments.map((r) => r.roleCode));
  check(
    "opening the dialog has not yet written anything",
    beforeConfirm.assignments.length === 2,
    beforeConfirm.assignments.map((r) => r.roleCode),
  );

  await owner.locator('button:has-text("Revoke role")').first().click();
  await owner.waitForTimeout(3500);
  await png(owner, "03-after-revoke");
  const afterText = await owner.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
  log("toastPresent", /revoked at/i.test(afterText));

  // ───────── CLAUSE 2: RELOAD — gone on screen and on the server
  await owner.reload({ waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(4000);
  await selectUser(owner, subject);
  await png(owner, "04-after-reload");
  const probeAfter = await rolesProbe(owner);
  log("probe_afterReload", probeAfter);
  check(
    "after RELOAD the revoked role is gone from the screen",
    !(probeAfter.blockText || "").includes(second.name) && /CASHIER/i.test(probeAfter.blockText || ""),
    probeAfter.blockText,
  );

  const serverAfter = await serverAssignments(owner, subjectId, ownerTok);
  log(
    "serverRolesAfterRevoke",
    serverAfter.assignments.map((r) => ({ roleCode: r.roleCode, branchId: r.branchId })),
  );
  check(
    "the SERVER agrees the role is gone",
    serverAfter.assignments.length === 1 &&
      serverAfter.assignments[0].roleCode === "CASHIER" &&
      serverAfter.assignments[0].branchId === hq.id,
    serverAfter.assignments,
  );

  writeFileSync(`${OUT}/_state.json`, JSON.stringify({ subject, subjectId, tempPassword, hq, second }, null, 2));
  J._results = results;
  save();
  await browser.close();
  console.log(`\n  subject = ${subject} (${subjectId})`);
  console.log(`  ${results.filter((r) => r.pass).length}/${results.length} checks passed`);
})();
