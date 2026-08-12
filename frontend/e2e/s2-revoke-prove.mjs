/*
 * S2 — PROOF. Every clause of DONE MEANS, driven in real Chromium against the live stack.
 *
 *  1. As owner@terrace.local open /app/users, pick a user with a role on a SECOND branch, and
 *     revoke it from the Roles-by-branch panel with a confirmation naming the role and the branch.
 *  2. Reload: the role is gone.
 *  3. Sign in AS THAT USER and confirm they no longer reach that branch's data.
 *  4. Attempt a revoke as a persona below the role ceiling and confirm it is refused SERVER-SIDE.
 *
 * Nothing here injects a token: every persona signs in for real, so a persona that cannot reach a
 * screen fails here the way it fails for the employee.
 */
import { PEOPLE, newBrowser, newPage, apiGet, apiSend, tokenOf, totpNow } from "./shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/S2");
mkdirSync(OUT, { recursive: true });

const journal = {};
const log = (k, v) => {
  journal[k] = v;
  console.log(`  · ${k} = ${JSON.stringify(v)}`);
};

const ADMIN = {
  slug: "floating-terrace",
  email: "admin@terrace.local",
  password: "Terrace#Admin1",
  totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS",
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
    await page.waitForTimeout(3000);
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

async function png(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`    shot: ${name}.png`);
}

/** An error state looks exactly like an empty state in a screenshot. Never score a broken page. */
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

/** Selecting a user by typing into the roster's search box — the roster is paginated. */
async function selectUser(page, email) {
  const search = page
    .locator('input[type="search"], input[placeholder*="Search" i], input[aria-label*="Search" i]')
    .first();
  if (await search.count()) {
    await search.fill(email);
    await page.waitForTimeout(2500);
  }
  const row = page.getByText(email, { exact: false }).first();
  await row.click();
  await page.waitForTimeout(2500);
}

const browser = await newBrowser();
try {
  // ═══ Setup: a throwaway hire with a role on the SECOND branch ═══════════════
  const owner = await newPage(browser);
  await login(owner, PEOPLE.owner);
  await owner.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(3000);
  log("usersPageTrouble", await trouble(owner));

  const ownerToken = await tokenOf(owner);
  const branches = (await apiGet(owner, "/api/v1/branches", ownerToken)).body?.data ?? [];
  const rooftop = branches.find((b) => /rooftop/i.test(b.name ?? ""));
  const hq = branches.find((b) => !/rooftop/i.test(b.name ?? ""));
  log("branches", { hq: hq?.name, rooftop: rooftop?.name });

  const stamp = Date.now();
  const email = `s2.revoke.${stamp}@terrace.local`;
  const created = await apiSend(
    owner,
    "POST",
    "/api/v1/users",
    { email, fullName: "S2 Revoke Subject", branchId: hq.id, roleCode: "CASHIER" },
    ownerToken,
  );
  const subjectId = created.body?.data?.id ?? created.body?.data?.userId;
  const tempPassword = created.body?.data?.tempPassword;
  log("createdSubject", { status: created.status, subjectId, email });

  // A role on the SECOND branch — the exact shape DONE MEANS asks for.
  const grant = await apiSend(
    owner,
    "POST",
    `/api/v1/users/${subjectId}/branch-roles`,
    { branchId: rooftop.id, roleCode: "MANAGER", approvalLimitPaisa: 500000 },
    ownerToken,
  );
  log("grantedRooftopMANAGER", grant.status);

  // ═══ 1. The control exists, on the row, and confirms by name ════════════════
  await owner.reload({ waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(3000);
  await selectUser(owner, email);
  await png(owner, "p01-panel-with-two-roles");

  const probe = await owner.evaluate(() => {
    const h = Array.from(document.querySelectorAll("h1,h2,h3,h4")).find((n) =>
      /roles by branch/i.test(n.textContent || ""),
    );
    const block = h ? (h.closest("section") ?? h.parentElement) : null;
    return {
      foundRolesBlock: Boolean(block),
      rolesBlockText: block ? block.innerText.replace(/\s+/g, " ").slice(0, 300) : "",
      // The register's own probe, verbatim.
      buttonsInsideRolesBlock: block
        ? Array.from(block.querySelectorAll("button")).map(
            (b) => b.getAttribute("aria-label") || (b.textContent || "").trim(),
          )
        : [],
      anyRevokeText: /revoke/i.test(document.body.innerText),
    };
  });
  log("REGISTER_PROBE_after", probe);

  const revokeBtn = owner.locator(`[data-testid="revoke-role-${rooftop.id}-MANAGER"]`);
  log("revokeButtonCount", await revokeBtn.count());
  await revokeBtn.first().click();
  await owner.waitForTimeout(1200);

  const dialogText = await owner.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return d ? d.innerText.replace(/\s+/g, " ") : null;
  });
  log("confirmationText", dialogText);
  log("confirmationNamesRoleAndBranch", {
    namesRole: /MANAGER/.test(dialogText ?? ""),
    namesBranch: /Rooftop/.test(dialogText ?? ""),
  });
  await png(owner, "p02-confirmation-names-role-and-branch");

  await owner.locator('[data-testid="confirm-dialog-confirm"]').click();
  await owner.waitForTimeout(3500);
  await png(owner, "p03-after-revoke");

  const toast = await owner.evaluate(() => {
    const t = Array.from(document.querySelectorAll("[data-sonner-toast], li[data-sonner-toast]"))
      .map((n) => (n.textContent || "").trim())
      .filter(Boolean);
    return t;
  });
  log("successToast", toast);

  // ═══ 2. Reload: the role is gone ════════════════════════════════════════════
  await owner.reload({ waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(3000);
  await selectUser(owner, email);
  await png(owner, "p04-after-reload");

  const afterReload = await owner.evaluate(() => {
    const h = Array.from(document.querySelectorAll("h1,h2,h3,h4")).find((n) =>
      /roles by branch/i.test(n.textContent || ""),
    );
    const block = h ? (h.closest("section") ?? h.parentElement) : null;
    return block ? block.innerText.replace(/\s+/g, " ") : null;
  });
  log("rolesBlockAfterReload", afterReload);

  const serverAfter = await apiGet(owner, `/api/v1/users/${subjectId}`, await tokenOf(owner));
  log(
    "serverAssignmentsAfterRevoke",
    (serverAfter.body?.data?.assignments ?? []).map((a) => ({
      branch: branches.find((b) => b.id === a.branchId)?.name,
      roleCode: a.roleCode,
    })),
  );

  // ═══ 3. The subject signs in and cannot reach that branch ═══════════════════
  const subject = await newPage(browser);
  await subject.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await subject.waitForTimeout(1000);
  const slug = subject.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill("floating-terrace");
  await subject.locator('input[name="email"], input#email').first().fill(email);
  await subject.locator('input[name="password"], input#password').first().fill(tempPassword);
  await subject.locator('button[type="submit"]').first().click();
  await subject.waitForTimeout(4000);
  log("subjectLandedAt", subject.url());
  await png(subject, "p05-subject-forced-change");

  // A first sign-in forces a password change; set one so the session is a real one.
  const newPassword = `S2Revoke#${stamp % 100000}a`;
  const pwFields = subject.locator('input[type="password"]');
  const n = await pwFields.count();
  if (n >= 2) {
    for (let i = 0; i < n; i++) {
      await pwFields.nth(i).fill(i === 0 && n === 3 ? tempPassword : newPassword);
    }
    await subject.locator('button[type="submit"]').first().click();
    await subject.waitForTimeout(4000);
  }
  log("subjectAfterChangeAt", subject.url());

  if (subject.url().includes("/login")) {
    await login(subject, { slug: "floating-terrace", email }, newPassword);
  }
  await subject.waitForTimeout(2000);
  await png(subject, "p06-subject-signed-in");

  const subjectToken = await tokenOf(subject);
  const mine = await apiGet(subject, "/api/v1/branches/mine", subjectToken);
  log("subjectBranchesMine", {
    status: mine.status,
    branches: (mine.body?.data ?? mine.body ?? []).map((b) => b.name ?? b.branchName ?? b.id),
  });

  // The branch switcher is the user-visible form of the same fact.
  const switcherText = await subject.evaluate(() => {
    const el = document.querySelector('[data-testid="branch-switcher"]');
    return el ? el.innerText.replace(/\s+/g, " ") : document.body.innerText.includes("Rooftop");
  });
  log("subjectSeesRooftopAnywhereOnScreen", switcherText);

  // The decisive read: ask the server for the Rooftop branch's own data with their bearer.
  const rooftopRead = await apiGet(
    subject,
    `/api/v1/branches/${rooftop.id}/receipt-config`,
    subjectToken,
  );
  log("subjectReadsRooftopBranchData", {
    status: rooftopRead.status,
    code: rooftopRead.body?.error?.code ?? null,
  });
  const rooftopSwitch = await apiSend(
    subject,
    "POST",
    "/api/v1/auth/switch-branch",
    { branchId: rooftop.id },
    subjectToken,
  );
  log("subjectSwitchToRooftop", {
    status: rooftopSwitch.status,
    code: rooftopSwitch.body?.error?.code ?? null,
  });
  await png(subject, "p07-subject-refused-rooftop");
  await subject.close();

  // ═══ 4. A persona below the ceiling is refused SERVER-SIDE ══════════════════
  // Give the subject OWNER at Rooftop, as the owner, so there is a role a TENANT_ADMIN
  // demonstrably cannot grant — and must therefore not be able to take away.
  const regrant = await apiSend(
    owner,
    "POST",
    `/api/v1/users/${subjectId}/branch-roles`,
    { branchId: rooftop.id, roleCode: "OWNER" },
    await tokenOf(owner),
  );
  log("ownerGrantsOWNERatRooftop", regrant.status);

  const adminPage = await newPage(browser);
  await login(adminPage, ADMIN);
  await adminPage.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await adminPage.waitForTimeout(3000);
  const adminToken = await tokenOf(adminPage);

  const adminAssign = await apiSend(
    adminPage,
    "POST",
    `/api/v1/users/${subjectId}/branch-roles`,
    { branchId: rooftop.id, roleCode: "OWNER" },
    adminToken,
  );
  log("CEILING_adminAssignOWNER", {
    status: adminAssign.status,
    code: adminAssign.body?.error?.code ?? null,
  });

  const adminRevoke = await apiSend(
    adminPage,
    "DELETE",
    `/api/v1/users/${subjectId}/branch-roles?branchId=${rooftop.id}&roleCode=OWNER`,
    undefined,
    adminToken,
  );
  log("CEILING_adminRevokeOWNER", {
    status: adminRevoke.status,
    code: adminRevoke.body?.error?.code ?? null,
    message: adminRevoke.body?.error?.message ?? null,
  });

  const stillThere = await apiGet(adminPage, `/api/v1/users/${subjectId}`, adminToken);
  log(
    "CEILING_assignmentsAfterRefusedRevoke",
    (stillThere.body?.data?.assignments ?? []).map((a) => a.roleCode),
  );

  // The same refusal through the UI, so it is not merely an API fact.
  await selectUser(adminPage, email);
  const adminRevokeBtn = adminPage.locator(`[data-testid="revoke-role-${rooftop.id}-OWNER"]`);
  log("adminSeesRevokeControl", await adminRevokeBtn.count());
  if (await adminRevokeBtn.count()) {
    await adminRevokeBtn.first().click();
    await adminPage.waitForTimeout(1000);
    await adminPage.locator('[data-testid="confirm-dialog-confirm"]').click();
    await adminPage.waitForTimeout(3000);
    const refusal = await adminPage.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return {
        dialogStillOpen: Boolean(d),
        alertInDialog: d
          ? Array.from(d.querySelectorAll('[role="alert"]'))
              .map((n) => (n.textContent || "").trim())
              .join(" | ")
          : null,
      };
    });
    log("CEILING_uiRefusal", refusal);
    await png(adminPage, "p08-admin-refused-in-dialog");
  }

  // And a persona with NO role authority at all.
  const mgr = await newPage(browser);
  await login(mgr, PEOPLE.manager);
  await mgr.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await mgr.waitForTimeout(2500);
  const mgrRevoke = await apiSend(
    mgr,
    "DELETE",
    `/api/v1/users/${subjectId}/branch-roles?branchId=${rooftop.id}&roleCode=OWNER`,
    undefined,
    await tokenOf(mgr),
  );
  log("CEILING_managerRevoke", {
    status: mgrRevoke.status,
    code: mgrRevoke.body?.error?.code ?? null,
  });
  await mgr.close();

  // ═══ 5. Responsive + both themes, on the panel that gained the control ══════
  await owner.reload({ waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(2500);
  await selectUser(owner, email);
  for (const [w, h] of [
    [390, 844],
    [768, 1024],
    [1440, 950],
  ]) {
    for (const theme of ["light", "dark"]) {
      await owner.setViewportSize({ width: w, height: h });
      await owner.emulateMedia({ colorScheme: theme });
      await owner.evaluate((t) => {
        document.documentElement.classList.toggle("dark", t === "dark");
        document.documentElement.setAttribute("data-theme", t);
      }, theme);
      await owner.waitForTimeout(900);
      await png(owner, `p09-panel-${w}-${theme}`);
    }
  }
  await owner.setViewportSize({ width: 1440, height: 950 });

  // The one visual claim worth asserting by computed style rather than class list.
  await owner.evaluate(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.setAttribute("data-theme", "light");
  });
  await owner.emulateMedia({ colorScheme: "light" });
  await owner.waitForTimeout(600);
  const style = await owner.evaluate(() => {
    const b = document.querySelector('[data-testid^="revoke-role-"]');
    if (!b) return null;
    const cs = getComputedStyle(b);
    const r = b.getBoundingClientRect();
    return { color: cs.color, width: Math.round(r.width), height: Math.round(r.height) };
  });
  log("revokeControlComputedStyle", style);

  await owner.close();
  await adminPage.close();
} catch (e) {
  journal.error = String(e);
  console.error(e);
} finally {
  writeFileSync(`${OUT}/_prove.json`, JSON.stringify(journal, null, 2));
  await browser.close();
}
