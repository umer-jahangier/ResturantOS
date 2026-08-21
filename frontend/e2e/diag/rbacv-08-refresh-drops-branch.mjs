/*
 * PROBE 8 — API-level proof of the mechanism behind probe 7, with no browser in the way.
 *
 * BranchSwitchService.switchBranch() mints an ACCESS token only; it never updates the refresh
 * session's stored branchId (RefreshSessionService.issue writes it once, at login). The SPA holds
 * the access token in memory only and re-bootstraps every full page load from the HttpOnly refresh
 * cookie — so the reload silently re-mints the ORIGINAL branch.
 *
 * The auth-service integration test named `switchBranch_reissuesJwtAndKeepsRefreshSession` asserts
 * exactly this, so the defect ships green.
 *
 * Sequence: login (HQ/WAITER) -> switch-branch to Rooftop -> refresh with the SAME cookie -> read
 * the branch on the token the refresh returned. If it says HQ, the branch switch cannot survive a
 * reload, and that is measured rather than inferred.
 */
import { writeFileSync } from "node:fs";
import { SHOTS, GW, api, apiLogin, jwtClaims } from "./rbacv-lib.mjs";

const out = { probe: "refresh-drops-the-switched-branch", steps: [] };
const log = (k, v) => {
  out.steps.push({ k, v });
  console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v).slice(0, 400));
};

const HQ = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
const ROOF = "c2d74ade-7ff8-4167-8cd0-131bfbdf4fba";
const nameOf = (id) => (id === ROOF ? "ROOFTOP" : id === HQ ? "HQ" : id);

async function main() {
  const owner = await apiLogin({
    email: "owner@terrace.local",
    password: "Terrace#Owner1",
    tenantSlug: "floating-terrace",
    totpEmail: "owner@terrace.local",
  });
  const H = { Authorization: `Bearer ${owner.token}` };
  let waiter = null;
  for (let attempt = 0; attempt < 5 && !waiter; attempt += 1) {
    const res = await fetch(`${GW}/api/v1/users?size=200`, { headers: H });
    const txt = await res.text();
    let parsed = {};
    try { parsed = JSON.parse(txt); } catch {}
    waiter = (parsed.data ?? []).find((u) => u.email === "waiter@terrace.local");
    if (!waiter) {
      log("users-lookup-attempt", { attempt, status: res.status, body: txt.slice(0, 200) });
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
  if (!waiter) throw new Error("could not resolve waiter@terrace.local — probe aborted rather than guessing");
  log("grant", await api(owner.token, `/api/v1/users/${waiter.id}/branch-roles`, {
    method: "POST",
    body: JSON.stringify({ branchId: ROOF, roleCode: "CASHIER" }),
  }));

  // 1. login as the waiter, capture BOTH the access token and the refresh cookie
  const r1 = await fetch(`${GW}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "waiter@terrace.local", password: "Terrace#Waiter1", tenantSlug: "floating-terrace" }),
  });
  const setCookie = r1.headers.getSetCookie?.() ?? [r1.headers.get("set-cookie")].filter(Boolean);
  const j1 = await r1.json();
  const access1 = j1.data.accessToken;
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  const c1 = jwtClaims(access1);
  log("1-login", { branch: nameOf(c1.branch_id), roles: c1.roles, perms: c1.permissions.length, cookieNames: setCookie.map((c) => c.split("=")[0]) });

  // 2. switch to Rooftop
  const r2 = await fetch(`${GW}/api/v1/auth/switch-branch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${access1}`, Cookie: cookie },
    body: JSON.stringify({ branchId: ROOF }),
  });
  const t2 = await r2.text();
  log("2-raw", { status: r2.status, body: t2.slice(0, 300) });
  const j2 = t2 ? JSON.parse(t2) : {};
  const access2 = j2?.data?.accessToken;
  const c2 = jwtClaims(access2 ?? "");
  const setCookie2 = r2.headers.getSetCookie?.() ?? [];
  log("2-switch-branch", {
    status: r2.status,
    branch: nameOf(c2?.branch_id),
    roles: c2?.roles,
    perms: c2?.permissions?.length,
    didItReissueTheRefreshCookie: setCookie2.length ? setCookie2.map((c) => c.split("=")[0]) : "NO Set-Cookie on the switch response",
  });

  // 3. refresh with the SAME cookie — this is exactly what the SPA does on every full page load
  const r3 = await fetch(`${GW}/api/v1/auth/refresh`, { method: "POST", headers: { Cookie: cookie } });
  const t3 = await r3.text();
  log("3-raw", { status: r3.status, body: t3.slice(0, 300) });
  const j3 = t3 ? JSON.parse(t3) : {};
  const access3 = j3?.data?.accessToken;
  const c3 = jwtClaims(access3 ?? "");
  log("3-refresh-after-switch", {
    status: r3.status,
    branch: nameOf(c3?.branch_id),
    roles: c3?.roles,
    perms: c3?.permissions?.length,
    VERDICT: nameOf(c3?.branch_id) === "ROOFTOP" ? "branch survived the reload" : "BRANCH SILENTLY REVERTED TO THE PRIMARY BRANCH",
  });

  // 4. and can the reverted token still reach the branch the user switched to?
  log("4-crm-with-reverted-token", await api(access3, "/api/v1/crm/customers/search?q=&size=1"));
  log("4-crm-with-switched-token", await api(access2, "/api/v1/crm/customers/search?q=&size=1"));

  // 5. is the old refresh cookie now dead (probe 7 landed on ?reason=session_expired)?
  const r5 = await fetch(`${GW}/api/v1/auth/refresh`, { method: "POST", headers: { Cookie: cookie } });
  log("5-second-refresh-same-cookie", { status: r5.status, body: (await r5.text()).slice(0, 200) });

  // ---------- RESTORE ----------
  log("RESTORE-delete", await api(owner.token, `/api/v1/users/${waiter.id}/branch-roles?branchId=${ROOF}&roleCode=CASHIER`, { method: "DELETE" }));
  const after = await fetch(`${GW}/api/v1/users/${waiter.id}`, { headers: H }).then((r) => r.json());
  log("RESTORE-assignments", JSON.stringify(after.data.assignments));

  writeFileSync(`${SHOTS}/08-refresh-drops-branch.json`, JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error("FATAL", e);
  writeFileSync(`${SHOTS}/08-refresh-drops-branch.json`, JSON.stringify({ ...out, fatal: String(e) }, null, 2));
  process.exit(1);
});
