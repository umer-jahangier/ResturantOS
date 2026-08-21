/*
 * S5 RE-OPEN — drive D: the wrong personas against the ENDPOINTS, re-measured.
 *
 * The first attempt returned 503 for everything because another agent replaced user-service's jar
 * under the running JVM mid-run. 503 is "the service is down", not "you may not do that" — the two
 * are indistinguishable in a screenshot, so this re-measures them on a live user-service.
 */
import { newBrowser, newPage, login, PEOPLE, apiSend, apiGet, BASE } from "../shift/lib.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S5-reopen");
mkdirSync(OUT, { recursive: true });
const STAMP = String(Date.now()).slice(-5);
const HQ = "34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03";
const J = { stamp: STAMP };

const browser = await newBrowser();
for (const [label, who] of [
  ["cashier", PEOPLE.cashier],
  ["manager", PEOPLE.manager],
  ["kitchen", PEOPLE.kitchen],
]) {
  const page = await newPage(browser);
  for (let i = 1; ; i++) {
    try {
      await login(page, who);
      break;
    } catch (e) {
      if (i >= 4) throw e;
      await page.waitForTimeout(21000);
    }
  }
  // sanity: user-service is answering for this persona at all
  const mine = await apiGet(page, "/api/v1/branches/mine");
  const post = await apiSend(page, "POST", "/api/v1/branches", {
    name: `${label} escalation ${STAMP}`,
    address: "nowhere",
  });
  const put = await apiSend(page, "PUT", `/api/v1/branches/${HQ}`, {
    name: `${label} renamed HQ ${STAMP}`,
  });
  const del = await apiSend(page, "DELETE", `/api/v1/branches/${HQ}`, undefined);
  J[label] = {
    mineStatus: mine.status,
    post: { status: post.status, code: post.body?.error?.code },
    put: { status: put.status, code: put.body?.error?.code },
    del: { status: del.status, code: del.body?.error?.code },
  };
  console.log(`  · ${label}:`, JSON.stringify(J[label]));
  await page.context().close();
}

// HQ must still be named exactly what it was — no rename slipped through.
const page = await newPage(browser);
for (let i = 1; ; i++) {
  try {
    await login(page, PEOPLE.owner);
    break;
  } catch (e) {
    if (i >= 4) throw e;
    await page.waitForTimeout(21000);
  }
}
const hq = await apiGet(page, `/api/v1/branches/${HQ}`);
J.hqAfterAllAttempts = { name: hq.body?.data?.name, isActive: hq.body?.data?.isActive };
console.log("  · HQ after every escalation attempt:", JSON.stringify(J.hqAfterAllAttempts));
await page.context().close();

writeFileSync(`${OUT}/s5-reopen-d.json`, JSON.stringify(J, null, 2));
console.log(`\nwrote ${OUT}/s5-reopen-d.json`);
await browser.close();
