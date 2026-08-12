/*
 * S1-07 PROOF — real Chromium, the manager's click path from DONE MEANS.
 *
 *   1. sign in as manager@terrace.local
 *   2. read the branch switcher label + the branch claim on the live access token
 *   3. select "Floating Terrace — Rooftop"; label changes, branch-scoped data reloads
 *   4. F5 — label MUST still read Rooftop, and the token's branch claim MUST be Rooftop
 *   5. visit /app/pos and /app/dashboard and confirm they are branch-scoped to Rooftop
 *   6. CLOSE THE TAB (new browser context on the same profile dir), reopen /app/dashboard
 *   7. switch back to HQ, reload, confirm HQ survives too
 *
 * The token is memory-only, so it is sniffed off the Authorization header of the requests the
 * app itself makes — the same bytes the UI is using, not a token this script minted.
 */
import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { SHOTS, BASE, GW, MANAGER, loginUi, sniffToken, jwtClaims, switcherLabel, pickBranch, shot } from "./s1-07-lib.mjs";

const HQ = "Floating Terrace HQ";
const ROOF = "Floating Terrace — Rooftop";
const PROFILE = `${SHOTS}/.chrome-profile`;

const out = { proof: "s1-07-branch-switch-survives-reload", steps: [] };
const log = (k, v) => {
  out.steps.push({ k, v });
  console.log(`[${k}]`, typeof v === "string" ? v : JSON.stringify(v));
};

/** Which branch is the app's own traffic carrying right now? */
async function liveBranch(page, sniff, label) {
  sniff.value = null;
  // Any branch-scoped read will do; the switcher's own query is always present on the shell.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const claims = jwtClaims(sniff.value ?? "");
  log(`token:${label}`, { branch_id: claims?.branch_id ?? null, sub: claims?.sub ?? null });
  return claims?.branch_id ?? null;
}

/** Names the branch id, using /branches/mine fetched with the app's own token. */
async function branchNames(token) {
  const r = await fetch(`${GW}/api/v1/branches/mine`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  return Object.fromEntries((j.data ?? []).map((b) => [b.id, b.name]));
}

async function main() {
  rmSync(PROFILE, { recursive: true, force: true });
  mkdirSync(PROFILE, { recursive: true });

  // A persistent context so that "close the tab and reopen" keeps the HttpOnly refresh cookie,
  // which is exactly what a real browser does and what a fresh incognito context would not.
  let ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1440, height: 900 } });
  let page = ctx.pages()[0] ?? (await ctx.newPage());
  let sniff = sniffToken(page);

  log("1-login", await loginUi(page, MANAGER));
  await page.waitForTimeout(2500);
  const names = await branchNames(sniff.value);
  const idOf = (n) => Object.entries(names).find(([, v]) => v === n)?.[0];
  log("1-branches", names);
  const ROOF_ID = idOf(ROOF);
  const HQ_ID = idOf(HQ);
  if (!ROOF_ID || !HQ_ID) throw new Error(`could not resolve both branch ids from ${JSON.stringify(names)}`);

  log("2-label-at-login", await switcherLabel(page));
  log("2-branch-at-login", { branch_id: jwtClaims(sniff.value)?.branch_id, name: names[jwtClaims(sniff.value)?.branch_id] });
  await shot(page, "01-after-login-HQ");

  // ---- 3. switch to Rooftop ----
  await pickBranch(page, ROOF);
  const labelAfterSwitch = await switcherLabel(page);
  sniff.value = null;
  await page.waitForTimeout(2500);
  const tokenAfterSwitch = jwtClaims(sniff.value ?? "");
  log("3-after-switch", {
    label: labelAfterSwitch,
    branch_id: tokenAfterSwitch?.branch_id,
    branchName: names[tokenAfterSwitch?.branch_id],
  });
  await shot(page, "02-after-switch-ROOFTOP");

  // ---- 4. F5 ----
  const branchAfterReload = await liveBranch(page, sniff, "after-F5");
  const labelAfterReload = await switcherLabel(page);
  log("4-after-F5", {
    label: labelAfterReload,
    branch_id: branchAfterReload,
    branchName: names[branchAfterReload],
    VERDICT: labelAfterReload === ROOF && branchAfterReload === ROOF_ID ? "SURVIVED" : "REVERTED",
  });
  await shot(page, "03-after-F5-still-ROOFTOP");

  // ---- 5. branch-scoped screens ----
  // Not just the token: collect every `branchId=` the page's OWN reads send, because "the data on
  // /app/pos and /app/dashboard must be Rooftop's" is a statement about the queries, not the JWT.
  const scoped = [];
  const onReq = (r) => {
    const m = r.url().match(/[?&]branchId=([0-9a-f-]{36})/i);
    if (m) scoped.push(m[1]);
  };
  page.on("request", onReq);
  for (const path of ["/app/pos", "/app/dashboard"]) {
    sniff.value = null;
    scoped.length = 0;
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    const alerts = (await page.locator('[role="alert"]').allInnerTexts().catch(() => [])).filter((t) => t.trim());
    const claims = jwtClaims(sniff.value ?? "");
    const distinct = [...new Set(scoped)];
    log(`5-${path}`, {
      label: await switcherLabel(page),
      branch_id: claims?.branch_id,
      branchName: names[claims?.branch_id],
      branchIdsOnItsOwnReads: distinct.map((id) => names[id] ?? id),
      alerts,
    });
    await shot(page, `04-${path.replace(/\//g, "_")}-ROOFTOP`);
  }
  page.off("request", onReq);

  // ---- 6. close the tab / whole browser, reopen ----
  await ctx.close();
  ctx = await chromium.launchPersistentContext(PROFILE, { headless: true, viewport: { width: 1440, height: 900 } });
  page = ctx.pages()[0] ?? (await ctx.newPage());
  sniff = sniffToken(page);
  await page.goto(`${BASE}/app/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  const reopenClaims = jwtClaims(sniff.value ?? "");
  const reopenLabel = await switcherLabel(page).catch(() => "(switcher not visible)");
  log("6-after-reopening-the-browser", {
    url: page.url(),
    label: reopenLabel,
    branch_id: reopenClaims?.branch_id,
    branchName: names[reopenClaims?.branch_id],
    VERDICT: reopenLabel === ROOF && reopenClaims?.branch_id === ROOF_ID ? "SURVIVED" : "REVERTED",
  });
  await shot(page, "05-after-reopen-ROOFTOP");

  // ---- 7. switch back to HQ and reload ----
  await pickBranch(page, HQ);
  const labelBack = await switcherLabel(page);
  const branchBack = await liveBranch(page, sniff, "after-switch-back-F5");
  const labelBackAfterReload = await switcherLabel(page);
  log("7-switch-back-to-HQ", {
    labelImmediately: labelBack,
    labelAfterF5: labelBackAfterReload,
    branch_id: branchBack,
    branchName: names[branchBack],
    VERDICT: labelBackAfterReload === HQ && branchBack === HQ_ID ? "SURVIVED" : "REVERTED",
  });
  await shot(page, "06-back-on-HQ-after-F5");

  await ctx.close();
  writeFileSync(`${SHOTS}/proof.json`, JSON.stringify(out, null, 2));
  console.log("\nwrote", `${SHOTS}/proof.json`);
}

main().catch((e) => {
  console.error("FATAL", e);
  writeFileSync(`${SHOTS}/proof.json`, JSON.stringify({ ...out, fatal: String(e) }, null, 2));
  process.exit(1);
});
