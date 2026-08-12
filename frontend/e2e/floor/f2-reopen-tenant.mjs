/*
 * Cross-tenant probe for the ONE new seam this fix introduced: pos-service resolving a staff
 * name out of auth-service's internal directory.
 *
 * Two questions the prior pass never asked:
 *   1. Does GET /internal/auth/users/{id} honour X-Tenant-Id, or will it hand tenant B a name
 *      out of tenant A given only a user id?
 *   2. Can Control Bistro read a Floating Terrace order through the public API at all?
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, tokenOf, log } from "./f2-lib.mjs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F2");
const rung = JSON.parse(readFileSync(`${OUT}/_reopen-rung.json`, "utf8"));
const CONTROL = {
  slug: "control-bistro-isolation-test-tenant",
  email: "manager@control.local",
  password: "Control#Manager1",
};
const claims = (b) => JSON.parse(Buffer.from(b.split(".")[1], "base64url").toString());

const browser = await newBrowser();

async function whoami(who) {
  const page = await newPage(browser);
  await login(page, who);
  await go(page, "/app/pos", { waitMs: 7000, allowTrouble: true });
  const bearer = await tokenOf(page);
  const c = claims(bearer);
  const req = page.__requests.find((r) => r.u.includes("/api/v1/pos/orders?"));
  const branchId = req ? new URL(req.u).searchParams.get("branchId") : null;
  return { page, bearer, tenantId: c.tenant_id, userId: c.sub, branchId };
}

const terrace = await whoami(PEOPLE.manager);
log(`terrace: tenant=${terrace.tenantId} user=${terrace.userId} branch=${terrace.branchId}`);
const control = await whoami(CONTROL);
log(`control: tenant=${control.tenantId} user=${control.userId} branch=${control.branchId}`);

// ── 1. the internal directory seam, hit directly on auth-service ────────────────
async function internalGet(tenantId, userId) {
  const r = await fetch(`http://localhost:8081/internal/auth/users/${userId}`, {
    headers: { "X-Internal-Service": "dev-internal-secret", "X-Tenant-Id": tenantId },
  });
  const body = await r.text();
  return { status: r.status, body: body.slice(0, 220) };
}

log("\n--- GET /internal/auth/users/{terraceManager} ---");
const right = await internalGet(terrace.tenantId, terrace.userId);
log(`  with TERRACE tenant  → ${right.status} ${right.body}`);
const wrong = await internalGet(control.tenantId, terrace.userId);
log(`  with CONTROL tenant  → ${wrong.status} ${wrong.body}`);
const leaked = wrong.status === 200 && /Terrace/i.test(wrong.body);
log(`  CROSS-TENANT NAME LEAK: ${leaked ? "YES — the tenant header is not enforced" : "no"}`);

// no secret at all
const noSecret = await fetch(
  `http://localhost:8081/internal/auth/users/${terrace.userId}`,
  { headers: { "X-Tenant-Id": terrace.tenantId } },
).then((r) => r.status);
log(`  with NO internal secret → ${noSecret}`);

// ── 2. Control Bistro reaching a Floating Terrace order, properly parameterised ──
log("\n--- Control Bistro → a Floating Terrace order id ---");
for (const [label, o] of Object.entries(rung)) {
  const ownBranch = await apiGet(
    control.page,
    `/api/v1/pos/orders/${o.orderId}?branchId=${control.branchId}`,
    control.bearer,
  );
  const theirBranch = await apiGet(
    control.page,
    `/api/v1/pos/orders/${o.orderId}?branchId=${terrace.branchId}`,
    control.bearer,
  );
  const row = (r) => (r.body?.data ? JSON.stringify(r.body.data).slice(0, 90) : "no data");
  log(
    `  ${label} ${o.orderNo}: ownBranch=${ownBranch.status} (${row(ownBranch)}) | terraceBranch=${theirBranch.status} (${row(theirBranch)})`,
  );
}

// And the LIST, scoped at Floating Terrace's branch, spent on Control's token.
const listAcross = await apiGet(
  control.page,
  `/api/v1/pos/orders?branchId=${terrace.branchId}&size=5`,
  control.bearer,
);
log(
  `\n  Control token + Terrace branchId on the LIST → ${listAcross.status}, rows=${(listAcross.body?.data ?? []).length}`,
);
for (const o of (listAcross.body?.data ?? []).slice(0, 3)) {
  log(`     LEAKED ROW: ${o.orderNo} cashierName=${JSON.stringify(o.cashierName)}`);
}

await browser.close();
