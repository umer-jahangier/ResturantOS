/*
 * S2 — re-verification after a SIBLING agent rebuilt and restarted user-service mid-run.
 *
 * The whole point of the "check stale jars before trusting any live result" rule is that the
 * process answering your request may not be running your code. user-service's pid and jar inode
 * both changed between the proof run and the commit, so the proof is re-run in miniature against
 * whatever is answering now: the button's request, the ceiling refusal, and the two personas that
 * must be refused.
 */
import { PEOPLE, newBrowser, newPage, apiGet, apiSend, tokenOf, totpNow } from "./shift/lib.mjs";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/S2");
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

async function login(page, who) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await slug.count()) await slug.first().fill(who.slug);
    await page.locator('input[name="email"], input#email').first().fill(who.email);
    await page.locator('input[name="password"], input#password').first().fill(who.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(3000);
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
      await page.waitForTimeout(31_000);
    }
  }
  throw new Error(`login failed for ${who.email}`);
}

const browser = await newBrowser();
try {
  const owner = await newPage(browser);
  await login(owner, PEOPLE.owner);
  await owner.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await owner.waitForTimeout(3000);
  const ownerToken = await tokenOf(owner);

  const branches = (await apiGet(owner, "/api/v1/branches", ownerToken)).body?.data ?? [];
  const rooftop = branches.find((b) => /rooftop/i.test(b.name ?? ""));
  const hq = branches.find((b) => !/rooftop/i.test(b.name ?? ""));

  const email = `s2.recheck.${Date.now()}@terrace.local`;
  const created = await apiSend(
    owner,
    "POST",
    "/api/v1/users",
    { email, fullName: "S2 Recheck", branchId: hq.id, roleCode: "CASHIER" },
    ownerToken,
  );
  const id = created.body?.data?.id ?? created.body?.data?.userId;
  await apiSend(
    owner,
    "POST",
    `/api/v1/users/${id}/branch-roles`,
    { branchId: rooftop.id, roleCode: "OWNER" },
    ownerToken,
  );

  // 1. The owner's own revoke — within their ceiling — still works.
  const ownerRevoke = await apiSend(
    owner,
    "DELETE",
    `/api/v1/users/${id}/branch-roles?branchId=${rooftop.id}&roleCode=OWNER`,
    undefined,
    await tokenOf(owner),
  );
  log("ownerRevokeWithinCeiling", ownerRevoke.status);
  log(
    "assignmentsAfterOwnerRevoke",
    ((await apiGet(owner, `/api/v1/users/${id}`, await tokenOf(owner))).body?.data?.assignments ?? [])
      .map((a) => a.roleCode),
  );

  // Put it back so the ceiling has something to defend.
  await apiSend(
    owner,
    "POST",
    `/api/v1/users/${id}/branch-roles`,
    { branchId: rooftop.id, roleCode: "OWNER" },
    await tokenOf(owner),
  );

  // 2. Above the ceiling — still refused, still writes nothing.
  const adminPage = await newPage(browser);
  await login(adminPage, ADMIN);
  await adminPage.goto(`${BASE}/app/users`, { waitUntil: "domcontentloaded" });
  await adminPage.waitForTimeout(2500);
  const adminToken = await tokenOf(adminPage);
  const adminRevoke = await apiSend(
    adminPage,
    "DELETE",
    `/api/v1/users/${id}/branch-roles?branchId=${rooftop.id}&roleCode=OWNER`,
    undefined,
    adminToken,
  );
  log("adminRevokeAboveCeiling", {
    status: adminRevoke.status,
    code: adminRevoke.body?.error?.code ?? null,
  });
  log(
    "assignmentsAfterRefusedRevoke",
    ((await apiGet(adminPage, `/api/v1/users/${id}`, adminToken)).body?.data?.assignments ?? []).map(
      (a) => a.roleCode,
    ),
  );
  await adminPage.close();

  // 3. No role authority at all — still refused at user-service.
  const mgr = await newPage(browser);
  await login(mgr, PEOPLE.manager);
  await mgr.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await mgr.waitForTimeout(2500);
  const mgrRevoke = await apiSend(
    mgr,
    "DELETE",
    `/api/v1/users/${id}/branch-roles?branchId=${rooftop.id}&roleCode=OWNER`,
    undefined,
    await tokenOf(mgr),
  );
  log("managerRevoke", { status: mgrRevoke.status, code: mgrRevoke.body?.error?.code ?? null });
  await mgr.close();
  await owner.close();
} catch (e) {
  journal.error = String(e);
  console.error(e);
} finally {
  writeFileSync(`${OUT}/_recheck.json`, JSON.stringify(journal, null, 2));
  await browser.close();
}
