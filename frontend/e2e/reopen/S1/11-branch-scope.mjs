/* Is the missing branch switcher an S1 defect, or is the owner simply assigned to one branch? */
import { newBrowser, newPage, login, PEOPLE, apiGet, log, writeJson, loadState } from "./lib.mjs";

const st = loadState();
const browser = await newBrowser();
const out = {};
try {
  const page = await newPage(browser);
  await login(page, PEOPLE.owner);
  const mine = await apiGet(page, "/api/v1/branches/mine");
  out.mine = mine;
  log(`  /api/v1/branches/mine -> ${mine.status} ${JSON.stringify(mine.body).slice(0, 400)}`);

  const all = await apiGet(page, "/api/v1/branches");
  const list = all.body?.data ?? all.body ?? [];
  out.allBranches = (Array.isArray(list) ? list : []).map((b) => ({ id: b.id, name: b.name, code: b.code }));
  log(`  tenant branches: ${JSON.stringify(out.allBranches)}`);

  // Can the owner READ the other branch's routing at all?
  const other = out.allBranches.find((b) => b.id !== st.branchId);
  if (other) {
    const r = await apiGet(page, `/api/v1/pos/menu/routing?branchId=${other.id}`);
    out.otherBranchRouting = { branch: other, status: r.status, body: JSON.stringify(r.body).slice(0, 250) };
    log(`  routing for the OTHER branch (${other.name}) -> ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  writeJson("11-branch-scope.json", out);
} finally {
  await browser.close();
}
