/*
 * S1-07 RISK PROBE — what happens to a session whose ACTIVE branch is revoked underneath it?
 *
 * Persisting the switched branch means a refresh session can now point at a branch other than the
 * login branch. `PermissionResolver.resolveAtBranch` THROWS IllegalStateException when the user has
 * no active assignment at the branch it is asked about, so this asks the live stack what a reload
 * does in that state — measured, not reasoned about.
 *
 * Uses the WAITER and a grant this script creates and deletes, never the manager's seeded rows, so
 * a failure mid-run cannot leave the demo tenant altered.
 */
import { writeFileSync } from "node:fs";
import { SHOTS, GW, rawLogin, api, jwtClaims, totp } from "./s1-07-lib.mjs";

const out = { probe: "s1-07-revoked-active-branch", steps: [] };
const log = (k, v) => {
  out.steps.push({ k, v });
  console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v).slice(0, 400));
};

async function main() {
  const owner = await rawLogin({
    email: "owner@terrace.local", password: "Terrace#Owner1",
    tenantSlug: "floating-terrace", totpEmail: "owner@terrace.local",
  });
  if (!owner.token) throw new Error("owner login failed");
  const users = JSON.parse((await api(owner.token, "/api/v1/users?size=200")).body).data ?? [];
  const waiter = users.find((u) => u.email === "waiter@terrace.local");
  if (!waiter) throw new Error("waiter not found");

  // The OWNER is assigned to HQ only, so its own /branches/mine has no Rooftop row. Read the
  // branch list from the MANAGER, who holds both — the same list the switcher renders.
  const mgr = await rawLogin({
    email: "manager@terrace.local", password: "Terrace#Manager1", tenantSlug: "floating-terrace",
  });
  const branches = JSON.parse((await api(mgr.token, "/api/v1/branches/mine")).body).data;
  const roof = branches.find((b) => !b.isHq);
  if (!roof) throw new Error(`no non-HQ branch in ${JSON.stringify(branches)}`);
  const nameOf = (id) => branches.find((b) => b.id === id)?.name ?? id;

  let granted = false;
  try {
    log("1-grant-rooftop-to-waiter", await api(owner.token, `/api/v1/users/${waiter.id}/branch-roles`, {
      method: "POST", body: JSON.stringify({ branchId: roof.id, roleCode: "CASHIER" }),
    }));
    granted = true;

    const w = await rawLogin({
      email: "waiter@terrace.local", password: "Terrace#Waiter1", tenantSlug: "floating-terrace",
    });
    log("2-waiter-login-branch", nameOf(jwtClaims(w.token).branch_id));

    const sw = await fetch(`${GW}/api/v1/auth/switch-branch`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${w.token}`, Cookie: w.cookie },
      body: JSON.stringify({ branchId: roof.id }),
    });
    log("3-switch-to-rooftop", { status: sw.status });

    log("4-revoke-the-rooftop-grant", await api(owner.token,
      `/api/v1/users/${waiter.id}/branch-roles?branchId=${roof.id}&roleCode=CASHIER`, { method: "DELETE" }));
    granted = false;

    const r = await fetch(`${GW}/api/v1/auth/refresh`, { method: "POST", headers: { Cookie: w.cookie } });
    const body = await r.text();
    log("5-reload-with-a-revoked-active-branch", {
      status: r.status,
      branch: jwtClaims(JSON.parse(body || "{}")?.data?.accessToken ?? "")?.branch_id,
      body: body.slice(0, 220),
    });
  } finally {
    if (granted) {
      log("RESTORE", await api(owner.token,
        `/api/v1/users/${waiter.id}/branch-roles?branchId=${roof.id}&roleCode=CASHIER`, { method: "DELETE" }));
    }
    const after = JSON.parse((await api(owner.token, `/api/v1/users/${waiter.id}`)).body).data;
    log("RESTORE-final-assignments", after.assignments);
  }

  writeFileSync(`${SHOTS}/revoked-branch.json`, JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error("FATAL", e);
  writeFileSync(`${SHOTS}/revoked-branch.json`, JSON.stringify({ ...out, fatal: String(e) }, null, 2));
  process.exit(1);
});
