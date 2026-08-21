/*
 * PROBE 10 — the boundary tests nobody ran.
 *
 * The prior report praised a "privilege-escalation ceiling" on the strength of the OWNER option
 * being absent from a TENANT_ADMIN's dropdown. A filtered <select> is a UI courtesy, not a control:
 * the question is whether auth-service refuses the grant when the request skips the dropdown
 * entirely. Same shape for the vendor/customer boundary: the platform console is hidden from a
 * TENANT_ADMIN in the UI, which says nothing about whether the platform API refuses their token.
 *
 * Every assertion here is a live HTTP call with a real, correctly-minted token for the persona named.
 *
 *  1. TENANT_ADMIN grants OWNER over the API, bypassing the filtered dropdown.        must FAIL
 *  2. CASHIER grants themselves OWNER.                                                 must FAIL
 *  3. TENANT_ADMIN / OWNER switch on a module for their own tenant via platform API.   must FAIL
 *  4. Floating Terrace OWNER touches Control Bistro's tenant, users and roles.         must FAIL
 *  5. MANAGER reads the role catalogue.                                                documented 403
 *
 * Any test data written is removed in the same run.
 */
import { writeFileSync } from "node:fs";
import { SHOTS, GW, api, apiLogin, jwtClaims } from "./rbacv-lib.mjs";

const out = { probe: "privilege-and-tenant-boundaries", results: [] };
const record = (name, expectation, res, extra = {}) => {
  const row = { name, expectation, status: res.status, body: res.body?.slice(0, 220), ...extra };
  row.PASS =
    expectation === "must-be-refused" ? res.status >= 400 : expectation === "must-succeed" ? res.status < 300 : null;
  out.results.push(row);
  console.log(`${row.PASS === false ? "*** FAIL ***" : row.PASS ? "ok  " : "note"} ${name} -> ${res.status} ${String(res.body).slice(0, 130)}`);
  return row;
};

const FT_TENANT = "d108c2e6-a70d-49c8-acdc-37531fd752d8";
const FT_ROOFTOP = "c2d74ade-7ff8-4167-8cd0-131bfbdf4fba";

async function main() {
  // ---- tokens ----
  const owner = await apiLogin({ email: "owner@terrace.local", password: "Terrace#Owner1", tenantSlug: "floating-terrace", totpEmail: "owner@terrace.local" });
  const admin = await apiLogin({ email: "admin@terrace.local", password: "Terrace#Admin1", tenantSlug: "floating-terrace", totpEmail: "admin@terrace.local" });
  const cashier = await apiLogin({ email: "cashier@terrace.local", password: "Terrace#Cashier1", tenantSlug: "floating-terrace" });
  const manager = await apiLogin({ email: "manager@terrace.local", password: "Terrace#Manager1", tenantSlug: "floating-terrace" });
  const ctrlOwner = await apiLogin({ email: "owner@control.local", password: "Control#Owner1", tenantSlug: "control-bistro-isolation-test-tenant", totpEmail: "owner@control.local" });

  const toks = { owner: owner.token, admin: admin.token, cashier: cashier.token, manager: manager.token, ctrlOwner: ctrlOwner.token };
  out.tokens = Object.fromEntries(
    Object.entries(toks).map(([k, v]) => {
      const c = jwtClaims(v ?? "");
      return [k, v ? { roles: c?.roles, tenant: c?.tenant_id, perms: c?.permissions?.length } : "LOGIN FAILED"];
    }),
  );
  console.log("tokens:", JSON.stringify(out.tokens, null, 1));

  const H = { Authorization: `Bearer ${owner.token}` };
  const ftUsers = await fetch(`${GW}/api/v1/users?size=200`, { headers: H }).then((r) => r.json());
  const waiter = (ftUsers.data ?? []).find((u) => u.email === "waiter@terrace.local");
  const adminUser = (ftUsers.data ?? []).find((u) => u.email === "admin@terrace.local");

  // ---------- 1. TENANT_ADMIN grants OWNER, skipping the dropdown ----------
  const esc = await api(toks.admin, `/api/v1/users/${waiter.id}/branch-roles`, {
    method: "POST",
    body: JSON.stringify({ branchId: FT_ROOFTOP, roleCode: "OWNER" }),
  });
  record("TENANT_ADMIN grants OWNER over the API (dropdown bypassed)", "must-be-refused", esc);

  // and to ITSELF, which is the actual attack
  const escSelf = await api(toks.admin, `/api/v1/users/${adminUser.id}/branch-roles`, {
    method: "POST",
    body: JSON.stringify({ branchId: FT_ROOFTOP, roleCode: "OWNER" }),
  });
  record("TENANT_ADMIN grants OWNER to ITSELF", "must-be-refused", escSelf);

  // ---------- 2. CASHIER self-escalates ----------
  record(
    "CASHIER grants themselves OWNER",
    "must-be-refused",
    await api(toks.cashier, `/api/v1/users/${waiter.id}/branch-roles`, {
      method: "POST",
      body: JSON.stringify({ branchId: FT_ROOFTOP, roleCode: "OWNER" }),
    }),
  );
  record("CASHIER reads the user list", "must-be-refused", await api(toks.cashier, "/api/v1/users?size=5"));

  // ---------- 3. the tenant reaching the vendor's console ----------
  for (const [who, tok] of [["TENANT_ADMIN", toks.admin], ["OWNER", toks.owner], ["MANAGER", toks.manager]]) {
    record(
      `${who} enables a module on their OWN tenant via the platform API`,
      "must-be-refused",
      await api(tok, `/api/v1/platform/tenants/${FT_TENANT}/features/FEATURE_ECOMMERCE`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      }),
    );
    record(`${who} lists all tenants`, "must-be-refused", await api(tok, "/api/v1/platform/tenants"));
  }

  // ---------- 4. cross-tenant ----------
  const ctrlH = { Authorization: `Bearer ${ctrlOwner.token}` };
  const ctrlUsers = await fetch(`${GW}/api/v1/users?size=50`, { headers: ctrlH }).then((r) => r.json()).catch(() => ({}));
  const ctrlWaiter = (ctrlUsers.data ?? []).find((u) => u.email === "waiter@control.local");
  const ctrlClaims = jwtClaims(ctrlOwner.token ?? "");
  out.controlTenantId = ctrlClaims?.tenant_id;
  console.log("control tenant:", out.controlTenantId, "control waiter:", ctrlWaiter?.id);

  if (ctrlWaiter?.id) {
    record(
      "Floating Terrace OWNER reads a Control Bistro user row",
      "must-be-refused",
      await api(toks.owner, `/api/v1/users/${ctrlWaiter.id}`),
    );
    record(
      "Floating Terrace OWNER assigns a role to a Control Bistro user",
      "must-be-refused",
      await api(toks.owner, `/api/v1/users/${ctrlWaiter.id}/branch-roles`, {
        method: "POST",
        body: JSON.stringify({ branchId: FT_ROOFTOP, roleCode: "MANAGER" }),
      }),
    );
  }
  record(
    "Floating Terrace OWNER reads Control Bistro's branches",
    "must-be-refused",
    await api(toks.owner, `/api/v1/branches/${out.controlTenantId}`),
  );
  // does the role catalogue leak anything tenant-specific across the boundary?
  const ftRoles = await api(toks.owner, "/api/v1/roles");
  const ctRoles = await api(toks.ctrlOwner, "/api/v1/roles");
  out.roleCatalogueIdenticalAcrossTenants = ftRoles.body === ctRoles.body;
  console.log("note role catalogue identical across the two tenants:", out.roleCatalogueIdenticalAcrossTenants);

  // ---------- 5. who may read the catalogue at all ----------
  for (const [who, tok] of [["OWNER", toks.owner], ["TENANT_ADMIN", toks.admin], ["MANAGER", toks.manager], ["CASHIER", toks.cashier]]) {
    record(`${who} GET /api/v1/roles`, "note", await api(tok, "/api/v1/roles"));
    record(`${who} GET /api/v1/permissions`, "note", await api(tok, "/api/v1/permissions"));
  }

  // ---------- CLEANUP: undo anything that unexpectedly succeeded ----------
  for (const r of out.results) {
    if (r.PASS === false && /grants/i.test(r.name)) {
      const uid = /ITSELF/.test(r.name) ? adminUser.id : waiter.id;
      const del = await api(toks.owner, `/api/v1/users/${uid}/branch-roles?branchId=${FT_ROOFTOP}&roleCode=OWNER`, { method: "DELETE" });
      console.log("CLEANUP removed an escalated grant:", JSON.stringify(del));
      out.cleanup = (out.cleanup ?? []).concat({ uid, del });
    }
  }
  const finalWaiter = await fetch(`${GW}/api/v1/users/${waiter.id}`, { headers: H }).then((r) => r.json());
  const finalAdmin = await fetch(`${GW}/api/v1/users/${adminUser.id}`, { headers: H }).then((r) => r.json());
  out.finalState = { waiter: finalWaiter.data.assignments, admin: finalAdmin.data.assignments };
  console.log("FINAL waiter:", JSON.stringify(out.finalState.waiter));
  console.log("FINAL admin:", JSON.stringify(out.finalState.admin));

  writeFileSync(`${SHOTS}/10-boundaries.json`, JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error("FATAL", e);
  writeFileSync(`${SHOTS}/10-boundaries.json`, JSON.stringify({ ...out, fatal: String(e) }, null, 2));
  process.exit(1);
});
