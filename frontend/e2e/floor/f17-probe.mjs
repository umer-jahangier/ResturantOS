/*
 * F17 RE-VERIFICATION — the probes DONE MEANS does not cover on the happy path:
 * wrong persona, wrong tenant, wrong station, and the audit row.
 *
 * Each persona mints ONE token and reuses it: /auth/refresh ROTATES the cookie, so a probe that
 * mints per call logs its own tab out and every later call reads 401 — which looks exactly like
 * a permission denial and is not one.
 */
import { newBrowser, newPage, login, go, log } from "../shift/lib.mjs";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const OUT =
  "/private/tmp/claude-501/-Users-muhammadumer-Documents-Projects-ResturantOS/b8e6f92e-7d80-4d4f-b270-4f05a9458825/scratchpad";

const ZAITOON = "zaitoon-kitchen";
const Z_BRANCH = "2a587e3f-e076-4a24-881d-52a46f03b393";
const FT_BRANCH = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03"; // Floating Terrace F-7
const MARINA_BRANCH = "40e9c0d7-52c7-4ce8-ac62-22060746e9b8"; // Marina Bay Dining, 7 stale

const totp = (email) => {
  const out = execFileSync("python3", ["../scripts/generate_totp.py", email], { encoding: "utf8" });
  return out.match(/TOTP code:\s*(\d{6})/)?.[1];
};

const mint = (page) =>
  page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });

const call = (page, method, path, token) =>
  page.evaluate(
    async ({ m, p, t }) => {
      const r = await fetch(`http://localhost:8080${p}`, {
        method: m,
        credentials: "include",
        headers: t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : {},
        body: m === "POST" ? "{}" : undefined,
      });
      let b = null;
      try { b = await r.json(); } catch { b = null; }
      return { status: r.status, body: b };
    },
    { m: method, p: path, t: token },
  );

const claims = (tok) => JSON.parse(Buffer.from(tok.split(".")[1], "base64").toString());

const browser = await newBrowser();
const J = {};

// ── the cook who owns this board ────────────────────────────────────────────
const cook = await newPage(browser);
await login(cook, { slug: ZAITOON, email: "kitchen@zaitoon.local", password: "Zaitoon#Kitchen1" });
await go(cook, "/app/kitchen/GRILL", { waitMs: 4000 });
const cookTok = await mint(cook);
const c = claims(cookTok);
J.cook = { sub: c.sub, tenantId: c.tenantId, branchId: c.branchId, permissions: c.permissions };
log("cook:", JSON.stringify(J.cook));

// station he does not work? (KITCHEN_STAFF here is branch-wide; recorded either way)
J.cookOwnBranch = {
  staleGrill: await call(cook, "GET", `/api/v1/kitchen/kds/tickets/stale?branchId=${Z_BRANCH}&stationCode=GRILL`, cookTok),
  staleNonsense: await call(cook, "GET", `/api/v1/kitchen/kds/tickets/stale?branchId=${Z_BRANCH}&stationCode=NO_SUCH_STATION_XYZ`, cookTok),
};
J.cookOwnBranch.staleGrillCount = J.cookOwnBranch.staleGrill.body?.data?.ticketCount;
J.cookOwnBranch.staleNonsenseCount = J.cookOwnBranch.staleNonsense.body?.data?.ticketCount;
delete J.cookOwnBranch.staleGrill; delete J.cookOwnBranch.staleNonsense;

// ── CROSS-TENANT: the same cook aimed at two other tenants' branches ────────
J.crossTenant = {};
for (const [name, br] of [["floating-terrace-F7", FT_BRANCH], ["marina-bay-dining", MARINA_BRANCH]]) {
  const s = await call(cook, "GET", `/api/v1/kitchen/kds/tickets/stale?branchId=${br}`, cookTok);
  const cl = await call(cook, "POST", `/api/v1/kitchen/kds/tickets/clear-stale?branchId=${br}`, cookTok);
  const list = await call(cook, "GET", `/api/v1/kitchen/kds/tickets?branchId=${br}`, cookTok);
  J.crossTenant[name] = {
    staleStatus: s.status, staleCount: s.body?.data?.ticketCount, staleBody: JSON.stringify(s.body).slice(0, 220),
    clearStatus: cl.status, clearCount: cl.body?.data?.ticketCount, clearBody: JSON.stringify(cl.body).slice(0, 220),
    listStatus: list.status, listRows: Array.isArray(list.body?.data) ? list.body.data.length : null,
  };
}
log("crossTenant:", JSON.stringify(J.crossTenant, null, 1));

// ── read back this cook's own board on his own bearer ──────────────────────
const rActive = await call(cook, "GET", `/api/v1/kitchen/kds/tickets?branchId=${Z_BRANCH}&stationCode=DEFAULT`, cookTok);
const rCleared = await call(cook, "GET", `/api/v1/kitchen/kds/tickets?branchId=${Z_BRANCH}&stationCode=DEFAULT&status=CLEARED`, cookTok);
J.readBack = {
  activeStatus: rActive.status,
  active: (rActive.body?.data ?? []).map((t) => ({ no: t.orderNo, st: t.status, at: t.receivedAt })),
  clearedStatus: rCleared.status,
  clearedBodyKeys: rCleared.body ? Object.keys(rCleared.body) : null,
  cleared: (rCleared.body?.data ?? []).map((t) => ({ no: t.orderNo, st: t.status, at: t.receivedAt, cl: t.clearedAt, items: t.items?.length })),
  clearedRaw: JSON.stringify(rCleared.body).slice(0, 400),
};
log("readBack:", JSON.stringify(J.readBack, null, 1).slice(0, 1600));

// ── WRONG PERSONAS in the same tenant ──────────────────────────────────────
J.wrongPersona = {};
for (const [role, email, pw] of [
  ["cashier", "cashier@zaitoon.local", "Zaitoon#Cashier1"],
  ["waiter", "waiter@zaitoon.local", "Zaitoon#Waiter1"],
  ["manager", "manager@zaitoon.local", "Zaitoon#Manager1"],
]) {
  const p = await newPage(browser);
  try {
    await login(p, { slug: ZAITOON, email, password: pw });
  } catch (e) {
    J.wrongPersona[role] = { loginError: e.message };
    await p.context().close();
    continue;
  }
  const tok = await mint(p);
  const cl2 = tok ? claims(tok) : {};
  const beforeGrill = await call(p, "GET", `/api/v1/kitchen/kds/tickets/stale?branchId=${Z_BRANCH}&stationCode=GRILL`, tok);
  const clear = await call(p, "POST", `/api/v1/kitchen/kds/tickets/clear-stale?branchId=${Z_BRANCH}&stationCode=GRILL`, tok);
  // does the SCREEN offer it?
  await go(p, "/app/kitchen/GRILL", { waitMs: 5000, allowTrouble: true });
  const screen = await p.evaluate(() => ({
    url: location.href,
    trigger: document.querySelector('[data-testid="kds-clear-stale-trigger"]')?.innerText.trim() ?? null,
    bodyHasClearWord: /clear\s+\d+\s+old/i.test(document.body.innerText),
    denied: /Access denied|do not have permission|not enabled/i.test(document.body.innerText),
  }));
  J.wrongPersona[role] = {
    kdsPerms: (cl2.permissions ?? []).filter((x) => x.startsWith("pos.kds")),
    staleStatus: beforeGrill.status,
    clearStatus: clear.status,
    clearBody: JSON.stringify(clear.body).slice(0, 220),
    screen,
  };
  log(`${role}:`, JSON.stringify(J.wrongPersona[role]).slice(0, 500));
  await p.context().close();
}

// ── AUDIT, as the owner (TOTP) ─────────────────────────────────────────────
const owner = await newPage(browser);
await login(owner, {
  slug: ZAITOON, email: "owner@zaitoon.local", password: "Zaitoon#Owner1",
  totpSecret: null, __code: null,
});
const ownerTok = await mint(owner);
const a = await call(owner, "GET", `/api/v1/audit/events?action=KDS_STALE_TICKETS_CLEARED&size=20`, ownerTok);
J.audit = {
  status: a.status,
  count: (a.body?.data?.content ?? a.body?.data ?? []).length,
  rows: (a.body?.data?.content ?? a.body?.data ?? []).slice(0, 4),
};
log("audit:", JSON.stringify(J.audit).slice(0, 2500));

writeFileSync(`${OUT}/f17r-probe.json`, JSON.stringify(J, null, 2));
await browser.close();
log("probe written");
