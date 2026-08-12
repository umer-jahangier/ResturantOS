/*
 * S2 RE-OPEN — final confirmation. Other agents rebuilt auth-service and pos-service DURING
 * this session, so the two decisive measurements are taken again, last, and reported with the
 * stack state around them: the role ceiling on the public route, and the cross-tenant 204.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/S2/reopen2");
mkdirSync(OUT, { recursive: true });
const J = {};
const log = (k, v) => { J[k] = v; console.log(`  · ${k} = ${JSON.stringify(v).slice(0, 420)}`); };
const results = [];
const check = (n, p, d) => { results.push({ name: n, pass: p, detail: d }); console.log(`  ${p ? "PASS" : "FAIL"}  ${n}${d !== undefined ? ` — ${JSON.stringify(d).slice(0, 240)}` : ""}`); };

const T = {
  owner: { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1", totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" },
  admin: { slug: "floating-terrace", email: "admin@terrace.local", password: "Terrace#Admin1", totpSecret: "WGPB246SK2YWJZBGNHUTDGKHMJXUGXLS" },
  control: { slug: "control-bistro-isolation-test-tenant", email: "owner@control.local", password: "Control#Owner1", totpSecret: "77YCNG564SWVW7YPUCJRGDSE6ZSCC3GQ" },
};
function totpNow(secret) {
  const b32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) { const i = b32.indexOf(c); if (i < 0) continue; bits += i.toString(2).padStart(5, "0"); }
  const bytes = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8); ctr.writeBigInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const h = createHmac("sha1", bytes).update(ctr).digest(); const o = h[19] & 0xf;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}
async function newPage(b) { const c = await b.newContext({ viewport: { width: 1440, height: 900 } }); return c.newPage(); }
async function login(page, who) {
  for (let a = 0; a < 4; a++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" }); await page.waitForTimeout(1500);
    const s = page.locator('input[name="tenantSlug"], input#tenantSlug'); if (await s.count()) await s.first().fill(who.slug);
    await page.locator('input[name="email"], input#email').first().fill(who.email);
    await page.locator('input[name="password"], input#password').first().fill(who.password);
    await page.locator('button[type="submit"]').first().click(); await page.waitForTimeout(3500);
    const t = page.locator('input[name="totpCode"], input#totpCode');
    if (await t.count() && who.totpSecret) { await t.first().fill(totpNow(who.totpSecret)); await page.locator('button[type="submit"]').first().click(); }
    try { await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 40_000 }); await page.waitForTimeout(2500); console.log(`  ✓ ${who.email}`); return true; }
    catch { await page.waitForTimeout(12_000); }
  }
  return false;
}
async function tokenOf(page) {
  return page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) return null; const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
}
async function api(page, method, path, payload, token) {
  const t = token ?? (await tokenOf(page));
  return page.evaluate(async ({ m, p, b, tok }) => {
    const r = await fetch(`http://localhost:8080${p}`, {
      method: m, credentials: "include",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    let body = null; try { body = await r.json(); } catch { body = null; }
    return { status: r.status, body };
  }, { m: method, p: path, b: payload, tok: t });
}
const asList = (b) => (Array.isArray(b) ? b : (b?.data ?? b?.content ?? b?.items ?? []));
const rurl = (u, b, r) => `/api/v1/users/${u}/branch-roles?branchId=${b}&roleCode=${encodeURIComponent(r)}`;
const rolesOf = async (p, id, t) => ((await api(p, "GET", `/api/v1/users/${id}`, undefined, t)).body?.data?.assignments ?? []).map((a) => a.roleCode);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const owner = await newPage(browser);
  if (!(await login(owner, T.owner))) throw new Error("owner login failed");
  const oTok = await tokenOf(owner);
  const branches = asList((await api(owner, "GET", "/api/v1/branches/mine", undefined, oTok)).body);
  const hq = branches.find((b) => b.isHq);
  const email = `s2fin.${Date.now().toString(36)}@terrace.local`;
  const cr = await api(owner, "POST", "/api/v1/users", { email, firstName: "S2", lastName: "Fin", branchId: hq.id, roleCode: "OWNER" }, oTok);
  const id = (cr.body?.data ?? cr.body)?.id;
  log("subject", { email, id, created: cr.status });
  log("subjectRoles", await rolesOf(owner, id, oTok));

  // 1. the ceiling on the PUBLIC route the button drives
  const admin = await newPage(browser);
  await login(admin, T.admin);
  const aTok = await tokenOf(admin);
  const rev = await api(admin, "DELETE", rurl(id, hq.id, "OWNER"), undefined, aTok);
  const msg = (rev.body?.error ?? rev.body)?.message ?? "";
  log("TENANT_ADMIN revokes OWNER", { status: rev.status, code: (rev.body?.error ?? rev.body)?.code, msgLen: msg.length });
  check("ceiling refuses a tenant admin revoking OWNER (public route)", rev.status === 403, { status: rev.status });
  check("the OWNER role survives the refusal", (await rolesOf(owner, id, oTok)).includes("OWNER"));
  check("refusal fits the 160-char dialog budget", msg.length > 0 && msg.length <= 160, { len: msg.length });

  // 2. the cross-tenant verb asymmetry
  const foreign = await newPage(browser);
  await login(foreign, T.control);
  const fTok = await tokenOf(foreign);
  const fRead = await api(foreign, "GET", `/api/v1/users/${id}`, undefined, fTok);
  const fAssign = await api(foreign, "POST", `/api/v1/users/${id}/branch-roles`, { branchId: hq.id, roleCode: "WAITER" }, fTok);
  const fRevoke = await api(foreign, "DELETE", rurl(id, hq.id, "OWNER"), undefined, fTok);
  log("crossTenant", { READ: fRead.status, ASSIGN: fAssign.status, REVOKE: fRevoke.status });
  check("cross-tenant READ 404s", fRead.status === 404, fRead.status);
  check("cross-tenant ASSIGN 404s", fAssign.status === 404, fAssign.status);
  check("cross-tenant REVOKE is refused like its siblings", fRevoke.status >= 400, fRevoke.status);
  const after = await rolesOf(owner, id, oTok);
  log("subjectRolesAfterEverything", after);
  check("NOTHING was actually removed by any refused call", after.includes("OWNER"), after);

  // 3. the owner (who IS at the ceiling) can still do it — the positive control
  const ok = await api(owner, "DELETE", rurl(id, hq.id, "OWNER"), undefined, oTok);
  log("OWNER revokes OWNER", ok.status);
  check("the positive control holds: a caller AT the ceiling succeeds (204)", ok.status === 204, ok.status);
  check("and it actually removed the row", (await rolesOf(owner, id, oTok)).length === 0);

  J._results = results;
  writeFileSync(`${OUT}/_final.json`, JSON.stringify(J, null, 2));
  await browser.close();
  console.log(`\n  ${results.filter((r) => r.pass).length}/${results.length} checks passed`);
  const bad = results.filter((r) => !r.pass);
  if (bad.length) console.log("  FAILURES:\n" + bad.map((f) => `   - ${f.name}`).join("\n"));
})();
