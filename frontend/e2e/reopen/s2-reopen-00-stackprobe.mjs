/*
 * S2 RE-OPEN — step 0. Is the live stack honest enough to measure the revoke seam on?
 *
 * check-stale-jars.sh reports user-service STALE (jar replaced under a running JVM). The
 * failure mode is CLASS-BY-CLASS: everything already loaded keeps working, anything not yet
 * loaded throws NoClassDefFoundError. So "stale" is not automatically "cannot measure" —
 * it has to be established per path. This probes the exact paths S2's DONE MEANS needs.
 */
import { chromium } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASE = "http://localhost:3000";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/S2/reopen2");
mkdirSync(OUT, { recursive: true });
const J = {};
const log = (k, v) => {
  J[k] = v;
  console.log(`  · ${k} = ${JSON.stringify(v).slice(0, 400)}`);
};

const OWNER = {
  slug: "floating-terrace",
  email: "owner@terrace.local",
  password: "Terrace#Owner1",
  totpSecret: "EY5CNU3FGGQSSAQYLUDYTGHWPKYZNM2R",
};

function totpNow(secret) {
  const b32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) {
    const i = b32.indexOf(c);
    if (i < 0) continue;
    bits += i.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8);
  ctr.writeBigInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const h = createHmac("sha1", bytes).update(ctr).digest();
  const o = h[19] & 0xf;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1e6).padStart(6, "0");
}

async function login(page, who) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
    if (await slug.count()) await slug.first().fill(who.slug);
    await page.locator('input[name="email"], input#email').first().fill(who.email);
    await page.locator('input[name="password"], input#password').first().fill(who.password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(3500);
    const totp = page.locator('input[name="totpCode"], input#totpCode');
    if (await totp.count()) {
      await totp.first().fill(totpNow(who.totpSecret));
      await page.locator('button[type="submit"]').first().click();
    }
    try {
      await page.waitForURL((u) => !String(u).includes("/login"), { timeout: 45_000 });
      await page.waitForTimeout(2500);
      console.log(`  ✓ signed in as ${who.email}`);
      return page;
    } catch {
      await page.waitForTimeout(15_000);
    }
  }
  throw new Error("login failed");
}

async function tokenOf(page) {
  return page.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
}

async function api(page, method, path, payload, token) {
  const t = token ?? (await tokenOf(page));
  return page.evaluate(
    async ({ m, p, b, tok }) => {
      const r = await fetch(`http://localhost:8080${p}`, {
        method: m,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body: b === undefined ? undefined : JSON.stringify(b),
      });
      let body = null;
      try {
        body = await r.json();
      } catch {
        body = null;
      }
      return { status: r.status, body };
    },
    { m: method, p: path, b: payload, tok: t },
  );
}
const asList = (b) => (Array.isArray(b) ? b : (b?.data ?? b?.content ?? b?.items ?? []));

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page, OWNER);
  const tok = await tokenOf(page);

  const br = await api(page, "GET", "/api/v1/branches/mine", undefined, tok);
  const branches = asList(br.body);
  log("GET /branches/mine", { status: br.status, n: branches.length });
  log("branches", branches.map((b) => ({ id: b.id, name: b.name, isHq: b.isHq })));

  const users = await api(page, "GET", "/api/v1/users?size=100", undefined, tok);
  const list = asList(users.body);
  log("GET /users", { status: users.status, n: list.length });
  log(
    "someUsers",
    list.slice(0, 12).map((u) => ({ id: u.id, email: u.email })),
  );

  // The three writes S2's path depends on, probed one at a time on the RUNNING jar.
  const stamp = Date.now().toString(36);
  const create = await api(
    page,
    "POST",
    "/api/v1/users",
    {
      email: `s2probe.${stamp}@terrace.local`,
      firstName: "S2",
      lastName: "Probe",
      branchId: branches[0].id,
      roleCode: "CASHIER",
    },
    tok,
  );
  log("POST /users (create)", { status: create.status, body: JSON.stringify(create.body).slice(0, 300) });

  // Pick an existing user that is NOT one of the seeded personas, to grant/revoke on.
  const victim = list.find((u) => /cashier@terrace\.local/.test(u.email)) ?? list[1];
  log("victim", { id: victim?.id, email: victim?.email });

  const second = branches.find((b) => !b.isHq) ?? branches[1];
  log("secondBranch", { id: second?.id, name: second?.name });

  const grant = await api(
    page,
    "POST",
    `/api/v1/users/${victim.id}/branch-roles`,
    { branchId: second.id, roleCode: "WAITER" },
    tok,
  );
  log("POST /users/{id}/branch-roles (grant)", {
    status: grant.status,
    body: JSON.stringify(grant.body).slice(0, 300),
  });

  const roles1 = await api(page, "GET", `/api/v1/users/${victim.id}/branch-roles`, undefined, tok);
  log("GET branch-roles after grant", {
    status: roles1.status,
    roles: asList(roles1.body).map((r) => ({ b: r.branchId, r: r.roleCode })),
  });

  const revoke = await api(
    page,
    "DELETE",
    `/api/v1/users/${victim.id}/branch-roles?branchId=${second.id}&roleCode=WAITER`,
    undefined,
    tok,
  );
  log("DELETE branch-roles (revoke)", {
    status: revoke.status,
    body: JSON.stringify(revoke.body).slice(0, 300),
  });

  const roles2 = await api(page, "GET", `/api/v1/users/${victim.id}/branch-roles`, undefined, tok);
  log("GET branch-roles after revoke", {
    status: roles2.status,
    roles: asList(roles2.body).map((r) => ({ b: r.branchId, r: r.roleCode })),
  });

  writeFileSync(`${OUT}/_stackprobe.json`, JSON.stringify(J, null, 2));
  await browser.close();
})();
