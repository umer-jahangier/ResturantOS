/*
 * F16 RE-OPEN — Stage C2. The authz re-test with a WELL-FORMED body.
 *
 * My first pass sent a PUT missing the required `active` field, so every persona got a 400
 * from bean validation and the 403 was never reached. A 400 that arrives before the gate
 * proves nothing about the gate. This sends a body that WOULD succeed for the owner, from
 * every persona that should not be allowed to send it, and re-reads the row afterwards to
 * confirm nothing moved.
 */
import { newBrowser, newPage, login, apiGet as rawGet, apiSend as rawSend, tokenOf, log } from "../shift/lib.mjs";
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F16-reopen");
const A = JSON.parse(readFileSync(`${OUT}/stage-a.json`, "utf8"));
const S = A.S, STD = A.STD;
const F = {};
const rec = (k, v) => { F[k] = v; log(`  > ${k}: ${JSON.stringify(v)}`); };

const WHO = {
  cashier: { slug: "floating-terrace", email: "cashier@terrace.local", password: "Terrace#Cashier1" },
  manager: { slug: "floating-terrace", email: "manager@terrace.local", password: "Terrace#Manager1" },
  waiter: { slug: "floating-terrace", email: "waiter@terrace.local", password: "Terrace#Waiter1" },
  tenantB: { slug: "control-bistro-isolation-test-tenant", email: "owner@control.local",
             password: "Control#Owner1", totpSecret: "77YCNG564SWVW7YPUCJRGDSE6ZSCC3GQ" },
  owner: { slug: "floating-terrace", email: "owner@terrace.local", password: "Terrace#Owner1",
           totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R" },
};

const browser = await newBrowser();

// The body an OWNER could legitimately send: complete, valid, and destructive.
const HOSTILE = { code: `RX-STD-${S}`, name: "PWNED", ratePct: "1.00", active: true };

async function attempt(tag, who) {
  const p = await newPage(browser);
  try { await login(p, who); } catch (e) { rec(`${tag}`, `login FAILED ${String(e.message).slice(0,60)}`); await p.close(); return; }
  const tok = await tokenOf(p);
  const upd = await rawSend(p, "PUT", `/api/v1/pos/tax-classes/${STD.id}`, HOSTILE, tok);
  rec(`${tag}_PUT_wellformed`, { status: upd.status, err: upd.body?.error?.code ?? null });
  await p.close();
}

log("\n=== well-formed hostile PUT against the terrace 17% class ===");
await attempt("cashier", WHO.cashier);
await attempt("manager", WHO.manager);
await attempt("waiter", WHO.waiter);
await attempt("tenantB", WHO.tenantB);

// read it back as the owner — did any of them move it?
const o = await newPage(browser);
await login(o, WHO.owner);
const tok = await tokenOf(o);
const list = await rawGet(o, "/api/v1/pos/tax-classes", tok);
const row = (list.body?.data ?? []).find((c) => c.id === STD.id);
rec("classAfterAllAttempts", row ? { code: row.code, name: row.name, rate: row.ratePct, active: row.active } : "GONE");

// and the owner CAN do it (so the gate is a gate, not a wall)
const ownerUpd = await rawSend(o, "PUT", `/api/v1/pos/tax-classes/${STD.id}`,
  { code: `RX-STD-${S}`, name: `RX Standard ${S}`, ratePct: "17.00", active: true }, tok);
rec("ownerPUT", { status: ownerUpd.status });
await o.close();

writeFileSync(`${OUT}/stage-c2.json`, JSON.stringify(F, null, 2));
log("\nSTAGE C2 written");
await browser.close();
