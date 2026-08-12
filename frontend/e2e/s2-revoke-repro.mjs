/*
 * S2 — REPRODUCTION. "Revoke a role: the endpoint exists; only the control is missing."
 *
 * Signs in as the OWNER, opens /app/users, picks a user, assigns CASHIER on the SECOND branch
 * so there is definitely a revocable role on a second branch, then probes the Roles-by-branch
 * panel for any control that could take it back.
 *
 * It also drives the DELETE endpoint straight from inside the page with the owner's own bearer,
 * to separate "the endpoint is missing" from "the control is missing" — the exact distinction
 * the register's #39 asserts and this item exists to settle.
 */
import { PEOPLE, newBrowser, newPage, go, apiGet, apiSend, tokenOf, totpNow } from "./shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A patient sign-in. `shift/lib.mjs`'s own `login` waits a fixed 4s after the TOTP submit and
 * this machine is shared with nine other agents — the button was still reading "Signing in…"
 * when it gave up. Polls instead of guessing, and re-mints the TOTP if the window rolled.
 */
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
      if (!who.totpSecret) throw new Error(`${who.email} was challenged for TOTP and has no secret`);
      await totp.first().fill(totpNow(who.totpSecret));
      await page.locator('button[type="submit"]').first().click();
    }
    try {
      await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 45_000 });
      console.log(`  ✓ signed in as ${who.email}`);
      await page.waitForTimeout(2000);
      return page;
    } catch {
      console.log(`  … sign-in attempt ${attempt + 1} did not land, retrying`);
      await page.waitForTimeout(31_000);
    }
  }
  throw new Error(`login failed for ${who.email} — still at ${page.url()}`);
}

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S2");
mkdirSync(OUT, { recursive: true });

const journal = {};

function log(k, v) {
  journal[k] = v;
  console.log(`  · ${k} = ${JSON.stringify(v)}`);
}

async function png(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`    shot: ${name}.png`);
}

const browser = await newBrowser();
const page = await newPage(browser);

try {
  await login(page, PEOPLE.owner);

  const t = await go(page, "/app/users");
  log("usersPageTrouble", t);
  await png(page, "r01-users-page");

  const token = await tokenOf(page);

  // Which branches exist? The second branch is the one the register used (Rooftop).
  const branches = await apiGet(page, "/api/v1/branches", token);
  log("branchesStatus", branches.status);
  const branchList = branches.body?.data ?? branches.body ?? [];
  log(
    "branches",
    (Array.isArray(branchList) ? branchList : []).map((b) => ({ id: b.id, name: b.name })),
  );

  const roster = await apiGet(page, "/api/v1/users?page=0&size=50&search=waiter@terrace.local", token);
  const users = roster.body?.data ?? [];
  log("rosterCount", users.length);

  // A target who is NOT the owner: revoking your own role mid-session is a different test.
  const target = users.find((u) => u.email === "waiter@terrace.local");
  log("target", { id: target?.id, email: target?.email });

  const second = (Array.isArray(branchList) ? branchList : []).find((b) => /rooftop/i.test(b.name ?? ""));
  log("secondBranch", second ? { id: second.id, name: second.name } : null);

  // Ensure there IS a role on the second branch to revoke.
  const assigned = await apiSend(
    page,
    "POST",
    `/api/v1/users/${target.id}/branch-roles`,
    { branchId: second.id, roleCode: "CASHIER" },
    token,
  );
  log("assignSecondBranchStatus", assigned.status);

  // Reload the panel and select the target so the Roles-by-branch block is on screen.
  await go(page, "/app/users");
  const row = page.locator(`text=${target.email}`).first();
  if (await row.count()) {
    await row.click();
    await page.waitForTimeout(2500);
  }
  await png(page, "r02-user-selected");

  // THE PROBE the register ran. Any button inside the Roles-by-branch section, any revoke wording.
  const probe = await page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4"));
    const h = headings.find((n) => /roles by branch/i.test(n.textContent || ""));
    const block = h ? h.closest("section") ?? h.parentElement : null;
    const text = block ? block.innerText : "";
    return {
      foundRolesBlock: Boolean(block),
      rolesBlockText: text.slice(0, 400),
      buttonsInsideRolesBlock: block
        ? Array.from(block.querySelectorAll("button")).map(
            (b) => (b.textContent || "").trim() || b.getAttribute("aria-label") || "(unlabelled)",
          )
        : [],
      anyRevokeText: /revoke|remove role|take back|unassign/i.test(document.body.innerText),
      panelButtons: Array.from(document.querySelectorAll("button"))
        .map((b) => (b.textContent || "").trim())
        .filter(Boolean),
    };
  });
  log("probe", probe);

  // Now the endpoint itself, with the parameters the controller actually declares.
  const del = await apiSend(
    page,
    "DELETE",
    `/api/v1/users/${target.id}/branch-roles?branchId=${second.id}&roleCode=CASHIER`,
    undefined,
    token,
  );
  log("deleteWithParamsStatus", del.status);
  log("deleteWithParamsBody", del.body);

  // And the shape the repository currently sends: no query params at all.
  const delNoParams = await apiSend(
    page,
    "DELETE",
    `/api/v1/users/${target.id}/branch-roles`,
    undefined,
    token,
  );
  log("deleteWithoutParamsStatus", delNoParams.status);
  log("deleteWithoutParamsBody", delNoParams.body);

  const after = await apiGet(page, `/api/v1/users/${target.id}`, token);
  log(
    "assignmentsAfterDelete",
    (after.body?.data?.assignments ?? []).map((a) => ({ branchId: a.branchId, roleCode: a.roleCode })),
  );

  await go(page, "/app/users");
  const row2 = page.locator(`text=${target.email}`).first();
  if (await row2.count()) {
    await row2.click();
    await page.waitForTimeout(2500);
  }
  await png(page, "r03-after-api-revoke");
} catch (e) {
  journal.error = String(e);
  console.error(e);
  await png(page, "r99-failure");
} finally {
  writeFileSync(`${OUT}/_repro.json`, JSON.stringify(journal, null, 2));
  await browser.close();
}
