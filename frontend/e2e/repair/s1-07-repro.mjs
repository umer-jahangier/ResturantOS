/*
 * S1-07 REPRO — API level. Measure the seam, do not reason about it.
 *
 * Sequence, as the SPA actually behaves:
 *   1. login as the manager, keep BOTH the access token and the refresh cookie
 *   2. read /api/v1/branches/mine to learn the real branch ids
 *   3. POST /auth/switch-branch to the non-login branch, read the branch claim on the NEW token
 *   4. POST /auth/refresh with the SAME cookie (this is what a full page reload does), read the
 *      branch claim on the token the refresh returned
 *
 * If (3) says Rooftop and (4) says HQ, the switch does not survive a reload and the register's
 * claim that "the JWT branch claim never changed in either state" is itself wrong.
 */
import { writeFileSync } from "node:fs";
import { SHOTS, GW, MANAGER, rawLogin, api, jwtClaims } from "./s1-07-lib.mjs";

const out = { probe: "s1-07-repro-api", steps: [] };
const log = (k, v) => {
  out.steps.push({ k, v });
  console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v).slice(0, 500));
};

async function main() {
  const l = await rawLogin({ ...MANAGER, tenantSlug: MANAGER.tenant });
  if (!l.token) throw new Error(`login failed: ${JSON.stringify(l.raw).slice(0, 300)}`);
  const c1 = jwtClaims(l.token);
  log("1-login", { status: l.status, branch_id: c1.branch_id, cookies: l.setCookie.map((c) => c.split("=")[0]) });

  const br = await api(l.token, "/api/v1/branches/mine");
  log("2-branches-raw", { status: br.status, body: br.body.slice(0, 600) });
  const branches = JSON.parse(br.body).data ?? [];
  const nameOf = (id) => branches.find((b) => b.id === id)?.name ?? id;
  log("2-branches", branches.map((b) => ({ id: b.id, name: b.name })));

  const target = branches.find((b) => b.id !== c1.branch_id);
  if (!target) throw new Error("manager is not assigned to a second branch — cannot test the switch");
  log("2-target", { id: target.id, name: target.name, loginBranch: nameOf(c1.branch_id) });

  const sw = await fetch(`${GW}/api/v1/auth/switch-branch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${l.token}`, Cookie: l.cookie },
    body: JSON.stringify({ branchId: target.id }),
  });
  const swTxt = await sw.text();
  const token2 = JSON.parse(swTxt || "{}")?.data?.accessToken;
  const c2 = jwtClaims(token2 ?? "");
  const swCookies = sw.headers.getSetCookie?.() ?? [];
  log("3-switch", {
    status: sw.status,
    branch_id: c2?.branch_id,
    branch: nameOf(c2?.branch_id),
    setCookieOnSwitch: swCookies.length ? swCookies.map((c) => c.split("=")[0]) : "none",
    CLAIM_CHANGED: c2?.branch_id !== c1.branch_id,
  });

  const rf = await fetch(`${GW}/api/v1/auth/refresh`, { method: "POST", headers: { Cookie: l.cookie } });
  const rfTxt = await rf.text();
  const token3 = JSON.parse(rfTxt || "{}")?.data?.accessToken;
  const c3 = jwtClaims(token3 ?? "");
  log("4-refresh-after-switch", {
    status: rf.status,
    branch_id: c3?.branch_id,
    branch: nameOf(c3?.branch_id),
    VERDICT:
      c3?.branch_id === target.id
        ? "SURVIVED — refresh re-minted the switched branch"
        : `REVERTED — refresh re-minted ${nameOf(c3?.branch_id)}, not ${target.name}`,
  });

  // switch back and refresh again: does HQ survive too?
  const sw2 = await fetch(`${GW}/api/v1/auth/switch-branch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token3 ?? token2}`, Cookie: l.cookie },
    body: JSON.stringify({ branchId: c1.branch_id }),
  });
  const token4 = JSON.parse((await sw2.text()) || "{}")?.data?.accessToken;
  const rf2 = await fetch(`${GW}/api/v1/auth/refresh`, { method: "POST", headers: { Cookie: l.cookie } });
  const token5 = JSON.parse((await rf2.text()) || "{}")?.data?.accessToken;
  log("5-switch-back-then-refresh", {
    switchBack: { status: sw2.status, branch: nameOf(jwtClaims(token4 ?? "")?.branch_id) },
    refresh: { status: rf2.status, branch: nameOf(jwtClaims(token5 ?? "")?.branch_id) },
  });

  writeFileSync(`${SHOTS}/repro-api.json`, JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error("FATAL", e);
  writeFileSync(`${SHOTS}/repro-api.json`, JSON.stringify({ ...out, fatal: String(e) }, null, 2));
  process.exit(1);
});
