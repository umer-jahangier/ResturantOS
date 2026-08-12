/*
 * S1 RE-OPEN 08 — isolation. Cross-branch as the Terrace owner, then cross-tenant with a
 * Control Bistro token minted over the API (its UI login is a separate problem, diagnosed below).
 */
import { PEOPLE, newBrowser, newPage, login, apiSend, apiGet, totpNow, log, OUT, API } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const HQ = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
const ROOFTOP = "c2d74ade-7ff8-4167-8cd0-131bfbdf4fba";
const DRINKS_CAT = "6cc887fb-2453-449b-9144-259d8d3a9281";
const PINA_ITEM = "0fc28f38-8170-47fb-b0c6-e96f68c5423f";
const BAR_STATION = "789ce266-5808-48ec-a39a-9c7755961b44";

const browser = await newBrowser();
const out = {};

try {
  const op = await newPage(browser);
  await login(op, PEOPLE.owner);

  // ── C. cross-branch: HQ owner naming the Rooftop branch ─────────────────────
  const rooftopRead = await apiGet(op, `/api/v1/pos/menu/routing?branchId=${ROOFTOP}`);
  const rooftopCat = await apiSend(op, "PUT", `/api/v1/pos/menu/categories/${DRINKS_CAT}/station?branchId=${ROOFTOP}`, { stationId: BAR_STATION });
  const rooftopItem = await apiSend(op, "PUT", `/api/v1/pos/menu/items/${PINA_ITEM}/station?branchId=${ROOFTOP}`, { stationId: BAR_STATION });
  out.crossBranch = {
    readRooftop: { status: rooftopRead.status, body: JSON.stringify(rooftopRead.body).slice(0, 220) },
    writeRooftopCategory: { status: rooftopCat.status, body: JSON.stringify(rooftopCat.body).slice(0, 220) },
    writeRooftopItem: { status: rooftopItem.status, body: JSON.stringify(rooftopItem.body).slice(0, 220) },
  };
  log("CROSS-BRANCH:", JSON.stringify(out.crossBranch, null, 1));

  // ── D. a station id that belongs to no branch of mine ───────────────────────
  const bogus = await apiSend(op, "PUT", `/api/v1/pos/menu/categories/${DRINKS_CAT}/station?branchId=${HQ}`, { stationId: "00000000-0000-0000-0000-000000000001" });
  out.bogusStation = { status: bogus.status, body: JSON.stringify(bogus.body).slice(0, 220) };
  log("BOGUS STATION:", JSON.stringify(out.bogusStation));

  // HQ routing must be untouched by any of that
  const after = await apiGet(op, `/api/v1/pos/menu/routing?branchId=${HQ}`);
  const d = after.body?.data ?? after.body;
  out.hqAfter = {
    drinks: (d?.categories ?? []).find((c) => c.categoryId === DRINKS_CAT),
    pinacolada: (d?.items ?? []).find((i) => i.itemId === PINA_ITEM),
    samosa: (d?.items ?? []).find((i) => i.itemName === "Chicken Samosa"),
  };
  log("HQ AFTER:", JSON.stringify(out.hqAfter, null, 1));

  // ── B. cross-tenant, over a real Control Bistro token ───────────────────────
  const ctl = await op.evaluate(
    async ({ api, code }) => {
      const attempt = async (body) => {
        const r = await fetch(`${api}/api/v1/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return { status: r.status, body: await r.json().catch(() => null) };
      };
      const first = await attempt({
        email: "owner@control.local",
        password: "Control#Owner1",
        tenantSlug: "control-bistro-isolation-test-tenant",
      });
      const second = await attempt({
        email: "owner@control.local",
        password: "Control#Owner1",
        tenantSlug: "control-bistro-isolation-test-tenant",
        totpCode: code,
      });
      return { first, second };
    },
    { api: API, code: totpNow(PEOPLE.controlOwner.totpSecret) },
  );
  log("control login:", JSON.stringify(ctl).slice(0, 900));
  const token =
    ctl.second.body?.data?.accessToken ?? ctl.second.body?.accessToken ??
    ctl.first.body?.data?.accessToken ?? ctl.first.body?.accessToken ?? null;
  out.controlTokenObtained = !!token;

  if (token) {
    const ctlRead = await apiGet(op, `/api/v1/pos/menu/routing?branchId=${HQ}`, token);
    const ctlCat = await apiSend(op, "PUT", `/api/v1/pos/menu/categories/${DRINKS_CAT}/station?branchId=${HQ}`, { stationId: BAR_STATION }, token);
    const ctlItem = await apiSend(op, "PUT", `/api/v1/pos/menu/items/${PINA_ITEM}/station?branchId=${HQ}`, { stationId: BAR_STATION }, token);
    out.crossTenant = {
      readTerraceRouting: { status: ctlRead.status, body: JSON.stringify(ctlRead.body).slice(0, 250) },
      writeTerraceCategory: { status: ctlCat.status, body: JSON.stringify(ctlCat.body).slice(0, 250) },
      writeTerraceItem: { status: ctlItem.status, body: JSON.stringify(ctlItem.body).slice(0, 250) },
    };
    log("CROSS-TENANT:", JSON.stringify(out.crossTenant, null, 1));

    // and re-read HQ as the owner: nothing must have moved
    const after2 = await apiGet(op, `/api/v1/pos/menu/routing?branchId=${HQ}`);
    const d2 = after2.body?.data ?? after2.body;
    out.hqAfterCrossTenant = {
      drinks: (d2?.categories ?? []).find((c) => c.categoryId === DRINKS_CAT),
      pinacolada: (d2?.items ?? []).find((i) => i.itemId === PINA_ITEM),
    };
    log("HQ AFTER CROSS-TENANT:", JSON.stringify(out.hqAfterCrossTenant, null, 1));
  }

  writeFileSync(`${OUT}/08-isolation.json`, JSON.stringify(out, null, 2));
} catch (e) {
  console.error("FAILED:", e.message);
  writeFileSync(`${OUT}/08-isolation.json`, JSON.stringify({ ...out, error: e.message }, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
