/*
 * S1-07 GUARD — the active branch must be PER SESSION, not per account.
 *
 * The fix persists the switched branch on the refresh session identified by the cookie presented
 * with the switch. The obvious wrong implementation — "update every live session for this user" —
 * would pass the DONE MEANS click path exactly as well, and would then drag a manager's back-office
 * desktop onto the rooftop's takings the moment they switched on the floor tablet.
 *
 * So: open TWO independent sessions for the same manager, switch only session A, and check that
 * session B's reload still lands on the branch B logged in on.
 */
import { writeFileSync } from "node:fs";
import { SHOTS, GW, MANAGER, rawLogin, api, jwtClaims } from "./s1-07-lib.mjs";

const out = { probe: "s1-07-session-isolation", steps: [] };
const log = (k, v) => {
  out.steps.push({ k, v });
  console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v));
};

const refresh = async (cookie) => {
  const r = await fetch(`${GW}/api/v1/auth/refresh`, { method: "POST", headers: { Cookie: cookie } });
  const t = await r.text();
  return { status: r.status, branch: jwtClaims(JSON.parse(t || "{}")?.data?.accessToken ?? "")?.branch_id };
};

async function main() {
  const a = await rawLogin({ ...MANAGER, tenantSlug: MANAGER.tenant });
  const b = await rawLogin({ ...MANAGER, tenantSlug: MANAGER.tenant });
  if (!a.token || !b.token) throw new Error("could not open two sessions");
  if (a.cookie === b.cookie) throw new Error("the two logins returned the same cookie — not two sessions");

  const branches = JSON.parse((await api(a.token, "/api/v1/branches/mine")).body).data;
  const nameOf = (id) => branches.find((x) => x.id === id)?.name ?? id;
  const loginBranch = jwtClaims(a.token).branch_id;
  const target = branches.find((x) => x.id !== loginBranch);
  log("0-setup", { loginBranch: nameOf(loginBranch), target: target.name });

  const sw = await fetch(`${GW}/api/v1/auth/switch-branch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${a.token}`, Cookie: a.cookie },
    body: JSON.stringify({ branchId: target.id }),
  });
  log("1-session-A-switches", { status: sw.status });

  const ra = await refresh(a.cookie);
  const rb = await refresh(b.cookie);
  log("2-session-A-reload", { branch: nameOf(ra.branch), expected: target.name });
  log("2-session-B-reload", { branch: nameOf(rb.branch), expected: nameOf(loginBranch) });
  log("VERDICT", {
    aMoved: ra.branch === target.id,
    bUntouched: rb.branch === loginBranch,
    ok: ra.branch === target.id && rb.branch === loginBranch
      ? "per-session: A moved, B did not"
      : "WRONG — the active branch is not per session",
  });

  writeFileSync(`${SHOTS}/session-isolation.json`, JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error("FATAL", e);
  writeFileSync(`${SHOTS}/session-isolation.json`, JSON.stringify({ ...out, fatal: String(e) }, null, 2));
  process.exit(1);
});
