/*
 * S2 — SERVER-SIDE PROBE for the revoke path.
 *
 * DONE MEANS demands that "a revoke as a persona below the role ceiling is refused server-side,
 * not merely hidden". Assign is ceiling-checked (`RoleCeiling.requireAssignable`, and
 * `AuthInternalController` refuses a request with no `X-Acting-User-Id`). Revoke goes through
 * `BranchRoleAdminService.revoke`, which takes no acting user at all. This measures what actually
 * happens rather than assuming either way.
 *
 * Three probes:
 *   A. MANAGER (holds neither rbac.manage nor rbac.role.manage) → expect 403 at user-service.
 *   B. TENANT_ADMIN revoking a role ABOVE their own ceiling (OWNER) → the open question.
 *   C. A revoke of a role the target does not hold → what does the caller see?
 *
 * The OWNER-at-Rooftop grant is made on a THROWAWAY account by the real owner first, so nothing
 * this script does can lock the seeded owner out.
 */
import { PEOPLE, newBrowser, newPage, apiGet, apiSend, tokenOf, totpNow } from "./shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S2");
mkdirSync(OUT, { recursive: true });
const journal = {};
const log = (k, v) => {
  journal[k] = v;
  console.log(`  · ${k} = ${JSON.stringify(v)}`);
};

async function login(page, who) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto("http://localhost:3000/login", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await slug.count()) await slug.first().fill(who.slug);
    await page.locator('input[name="email"], input#email').first().fill(who.email);
    await page.locator('input[name="password"], input#password').first().fill(who.password);
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
      await page.waitForTimeout(2000);
      console.log(`  ✓ signed in as ${who.email}`);
      return page;
    } catch {
      console.log(`  … attempt ${attempt + 1} did not land`);
      await page.waitForTimeout(31_000);
    }
  }
  throw new Error(`login failed for ${who.email}`);
}

const ADMIN = {
  slug: "floating-terrace",
  email: "admin@terrace.local",
  password: "Terrace#Admin1",
  totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS",
};

const browser = await newBrowser();
try {
  // ── as OWNER: build the fixture ────────────────────────────────────────────
  const ownerPage = await newPage(browser);
  await login(ownerPage, PEOPLE.owner);
  await ownerPage.goto("http://localhost:3000/app/users", { waitUntil: "domcontentloaded" });
  await ownerPage.waitForTimeout(2500);
  const ownerToken = await tokenOf(ownerPage);

  const branches = await apiGet(ownerPage, "/api/v1/branches", ownerToken);
  const list = branches.body?.data ?? [];
  const rooftop = list.find((b) => /rooftop/i.test(b.name ?? ""));
  const hq = list.find((b) => !/rooftop/i.test(b.name ?? ""));
  log("branches", { rooftop: rooftop?.name, hq: hq?.name });

  const stamp = Date.now();
  const created = await apiSend(
    ownerPage,
    "POST",
    "/api/v1/users",
    {
      email: `s2.ceiling.${stamp}@terrace.local`,
      fullName: "S2 Ceiling Fixture",
      branchId: hq.id,
      roleCode: "CASHIER",
    },
    ownerToken,
  );
  log("createFixtureStatus", created.status);
  const fixtureId = created.body?.data?.userId ?? created.body?.data?.id ?? created.body?.userId;
  log("fixtureId", fixtureId);

  const grantOwner = await apiSend(
    ownerPage,
    "POST",
    `/api/v1/users/${fixtureId}/branch-roles`,
    { branchId: rooftop.id, roleCode: "OWNER" },
    ownerToken,
  );
  log("ownerGrantsOWNERatRooftop", grantOwner.status);

  // ── as MANAGER: no role-administration authority at all ────────────────────
  const mgrPage = await newPage(browser);
  await login(mgrPage, PEOPLE.manager);
  await mgrPage.goto("http://localhost:3000/app/dashboard", { waitUntil: "domcontentloaded" });
  await mgrPage.waitForTimeout(2000);
  const mgrRevoke = await apiSend(
    mgrPage,
    "DELETE",
    `/api/v1/users/${fixtureId}/branch-roles?branchId=${rooftop.id}&roleCode=OWNER`,
    undefined,
    await tokenOf(mgrPage),
  );
  log("A_managerRevokeStatus", mgrRevoke.status);
  log("A_managerRevokeBody", mgrRevoke.body);
  await mgrPage.close();

  // ── as TENANT_ADMIN: holds rbac.role.manage, ceiling is BELOW OWNER ────────
  const adminPage = await newPage(browser);
  await login(adminPage, ADMIN);
  await adminPage.goto("http://localhost:3000/app/users", { waitUntil: "domcontentloaded" });
  await adminPage.waitForTimeout(2500);
  const adminToken = await tokenOf(adminPage);

  const adminAssignOwner = await apiSend(
    adminPage,
    "POST",
    `/api/v1/users/${fixtureId}/branch-roles`,
    { branchId: rooftop.id, roleCode: "OWNER" },
    adminToken,
  );
  log("B_adminASSIGNownerStatus", adminAssignOwner.status);
  log("B_adminASSIGNownerBody", adminAssignOwner.body?.error?.code ?? adminAssignOwner.body);

  const adminRevokeOwner = await apiSend(
    adminPage,
    "DELETE",
    `/api/v1/users/${fixtureId}/branch-roles?branchId=${rooftop.id}&roleCode=OWNER`,
    undefined,
    adminToken,
  );
  log("B_adminREVOKEownerStatus", adminRevokeOwner.status);
  log("B_adminREVOKEownerBody", adminRevokeOwner.body);

  const afterAdmin = await apiGet(adminPage, `/api/v1/users/${fixtureId}`, adminToken);
  log(
    "B_assignmentsAfterAdminRevoke",
    (afterAdmin.body?.data?.assignments ?? []).map((a) => a.roleCode),
  );

  // ── C. revoking a role the target does not hold ────────────────────────────
  const noSuch = await apiSend(
    adminPage,
    "DELETE",
    `/api/v1/users/${fixtureId}/branch-roles?branchId=${rooftop.id}&roleCode=WAITER`,
    undefined,
    adminToken,
  );
  log("C_revokeRoleNotHeldStatus", noSuch.status);
  log("C_revokeRoleNotHeldBody", noSuch.body);

  // ── D. revoking the caller's OWN last role ─────────────────────────────────
  const meAssignments = await apiGet(adminPage, "/api/v1/branches/mine", adminToken);
  log("D_adminOwnBranches", meAssignments.status);

  await adminPage.close();
  await ownerPage.close();
} catch (e) {
  journal.error = String(e);
  console.error(e);
} finally {
  writeFileSync(`${OUT}/_ceiling-probe.json`, JSON.stringify(journal, null, 2));
  await browser.close();
}
