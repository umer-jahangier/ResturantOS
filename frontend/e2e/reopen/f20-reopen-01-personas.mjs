/*
 * F20 RE-OPEN — probe 1: who can read the policy, who can write it, and can it be written
 * for a branch that is not yours.
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, apiSend, tokenOf, log } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/reopen/F20");
mkdirSync(OUT, { recursive: true });
const R = {};

async function signIn(page, who, attempts = 4) {
  for (let i = 1; ; i += 1) {
    try { return await login(page, who); }
    catch (e) { if (i >= attempts) throw e; log(`  retry login ${who.email}: ${e.message}`); await page.waitForTimeout(4000); }
  }
}

const browser = await newBrowser();

// ── OWNER ─────────────────────────────────────────────────────────────────────
{
  const page = await newPage(browser);
  await signIn(page, PEOPLE.owner);
  const token = await tokenOf(page);
  const branches = await apiGet(page, "/api/v1/branches?size=50", token);
  R.branches = (branches.body?.data ?? branches.body ?? []).map?.((b) => ({ id: b.id, name: b.branchName ?? b.name })) ?? branches.body;
  log("branches", JSON.stringify(R.branches));

  const first = (Array.isArray(R.branches) ? R.branches[0] : null);
  R.ownerBranchId = first?.id ?? null;

  for (const b of (Array.isArray(R.branches) ? R.branches : [])) {
    const got = await apiGet(page, `/api/v1/pos/branches/${b.id}/service-charge`, token);
    R[`owner-get-${b.name}`] = { status: got.status, body: got.body };
  }

  // A branch id that belongs to ANOTHER tenant (random uuid stands in first; then a real one below)
  const bogus = "00000000-0000-4000-8000-000000000999";
  const w = await apiSend(page, "PUT", `/api/v1/pos/branches/${bogus}/service-charge`,
    { enabled: true, ratePct: 99, label: "Bogus branch charge", dineIn: true, takeaway: true, pickup: true }, token);
  R["owner-put-unknown-branch"] = { status: w.status, body: w.body };

  await page.close();
}

// ── MANAGER / CASHIER / WAITER-ish ────────────────────────────────────────────
for (const key of ["manager", "cashier"]) {
  const page = await newPage(browser);
  await signIn(page, PEOPLE[key]);
  const token = await tokenOf(page);
  const bid = R.ownerBranchId;
  const g = await apiGet(page, `/api/v1/pos/branches/${bid}/service-charge`, token);
  const p = await apiSend(page, "PUT", `/api/v1/pos/branches/${bid}/service-charge`,
    { enabled: true, ratePct: 25, label: "Sneaky", dineIn: true, takeaway: true, pickup: true }, token);
  R[`${key}-get`] = { status: g.status, canManage: g.body?.canManage, ratePct: g.body?.ratePct, enabled: g.body?.enabled };
  R[`${key}-put`] = { status: p.status, body: typeof p.body === "string" ? p.body.slice(0, 300) : p.body };

  // and the screen itself
  await go(page, "/app/settings/service-charge", { allowTrouble: true });
  R[`${key}-screen`] = await page.evaluate(() => ({
    url: location.pathname,
    denied: /access denied|not authorised|not authorized|403/i.test(document.body.innerText),
    head: document.body.innerText.replace(/\s+/g, " ").slice(0, 400),
  }));
  await page.screenshot({ path: `${OUT}/persona-${key}.png` });
  await page.close();
}

// re-read as owner to confirm nothing moved
{
  const page = await newPage(browser);
  await signIn(page, PEOPLE.owner);
  const token = await tokenOf(page);
  const got = await apiGet(page, `/api/v1/pos/branches/${R.ownerBranchId}/service-charge`, token);
  R["owner-final"] = { status: got.status, body: got.body };
  await page.close();
}

await browser.close();
writeFileSync(`${OUT}/01-personas.json`, JSON.stringify(R, null, 2));
log(JSON.stringify(R, null, 2));
