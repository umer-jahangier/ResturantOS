/*
 * Recon — what does the live stack actually hold right now?
 *
 * Reads on each persona's own bearer. Nothing is written.
 */
import { PEOPLE, newBrowser, newPage, login, go, apiGet, shot, saveState } from "./lib.mjs";

const run = async () => {
  const browser = await newBrowser();
  const out = {};

  // ── manager ────────────────────────────────────────────────────────────────
  const mp = await newPage(browser);
  await login(mp, PEOPLE.manager);
  const mtok = await mp.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
  const claims = JSON.parse(Buffer.from(mtok.split(".")[1], "base64").toString());
  out.manager = {
    sub: claims.sub,
    branchId: claims.branchId ?? claims.branch_id,
    tenantId: claims.tenantId ?? claims.tenant_id,
    perms: (claims.permissions ?? claims.perms ?? []).filter((p) => p.startsWith("pos.till")),
  };
  console.log("manager:", JSON.stringify(out.manager, null, 2));

  const branchId = out.manager.branchId;
  const cashiers = await apiGet(mp, `/api/v1/pos/tills/cashiers?branchId=${branchId}`, mtok);
  out.cashiersEndpoint = { status: cashiers.status, body: cashiers.body };
  console.log("GET /tills/cashiers ->", cashiers.status, JSON.stringify(cashiers.body, null, 2));

  const tills = await apiGet(
    mp,
    `/api/v1/pos/tills?branchId=${branchId}&size=10`,
    mtok,
  );
  out.branchTills = {
    status: tills.status,
    rows: (tills.body?.data ?? []).map((t) => ({
      id: t.id,
      cashierId: t.cashierId,
      cashierName: t.cashierName ?? null,
      status: t.status,
      float: t.openingFloatPaisa,
    })),
  };
  console.log("branch tills ->", JSON.stringify(out.branchTills, null, 2));

  await go(mp, "/app/pos/tills");
  await shot(mp, "01-manager-till-review");

  // ── cashier ────────────────────────────────────────────────────────────────
  const cp = await newPage(browser);
  await login(cp, PEOPLE.cashier);
  const ctok = await cp.evaluate(async () => {
    const r = await fetch("http://localhost:8080/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const j = await r.json().catch(() => null);
    return j?.accessToken ?? j?.data?.accessToken ?? null;
  });
  const cclaims = JSON.parse(Buffer.from(ctok.split(".")[1], "base64").toString());
  out.cashier = {
    sub: cclaims.sub,
    branchId: cclaims.branchId ?? cclaims.branch_id,
    perms: (cclaims.permissions ?? cclaims.perms ?? []).filter((p) => p.startsWith("pos.till")),
  };
  console.log("cashier:", JSON.stringify(out.cashier, null, 2));

  const own = await apiGet(
    cp,
    `/api/v1/pos/tills?cashierId=${out.cashier.sub}&status=OPEN`,
    ctok,
  );
  out.cashierOpenTill = { status: own.status, body: own.body?.data ?? own.body };
  console.log("cashier open till ->", JSON.stringify(out.cashierOpenTill, null, 2));

  await go(cp, "/app/pos");
  const strip = await cp.evaluate(() => {
    const t = document.body.innerText || "";
    const m = t.match(/(No active till[\s\S]{0,80}|Till\s+OPEN[\s\S]{0,160})/);
    return m ? m[0].replace(/\s+/g, " ").trim() : t.slice(0, 300).replace(/\s+/g, " ");
  });
  out.cashierStrip = strip;
  console.log("cashier POS strip:", strip);
  await shot(cp, "02-cashier-pos");

  saveState({ recon: out });
  console.log("\n" + JSON.stringify(out, null, 2));
  await browser.close();
};

run().catch((e) => {
  console.error("RECON FAILED:", e);
  process.exit(1);
});
