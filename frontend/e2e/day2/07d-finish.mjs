/* DAY 2 — finish 7: role create+assign, branch create+edit, dish photo -> POS grid. */
import { newBrowser, newPage, go, shot, saveState, loadState, finding, apiGet, log, PEOPLE, login } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const S = loadState();
const STAMP = Date.now().toString().slice(-5);
const ROLE = `Day2 Runner ${STAMP}`;
const BRANCH = `Day2 Terrace ${STAMP}`;
const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
const out = {};

// ── role ─────────────────────────────────────────────────────────────────────
try {
  await go(owner, "/app/roles", { waitMs: 7000 });
  await owner.getByRole("button", { name: /new role/i }).first().click();
  await owner.waitForTimeout(2500);
  await owner.locator("#role-name").fill(ROLE);
  await owner.waitForTimeout(400);
  const want = ["build-pos.order.view", "build-pos.menu.view", "build-pos.order.create"];
  const ticked = [];
  for (const id of want) {
    const el = owner.locator(`[id="${id}"]`);
    if (await el.count()) { await el.click(); ticked.push(id); await owner.waitForTimeout(300); }
  }
  log("  ticked:", JSON.stringify(ticked));
  const counter = await owner.evaluate(() => /(\d+) of (\d+) selected/.exec(document.body.innerText || "")?.[0] ?? null);
  log("  counter reads:", counter);
  await shot(owner, "07i-role-ticked");
  await owner.locator("[role=dialog] button").filter({ hasText: /^Create role$|^Create$|^Save/i }).last().click();
  await owner.waitForTimeout(5000);
  await shot(owner, "07j-role-created");
  const after = await owner.evaluate((n) => {
    const t = (document.body.innerText || "").replace(/\s+/g, " ");
    const i = t.indexOf(n);
    return { present: i >= 0, snippet: i >= 0 ? t.slice(Math.max(0, i - 30), i + 220) : null, count: /(\d+) roles/.exec(t)?.[0] ?? null };
  }, ROLE);
  log("  ROLE AFTER CREATE:", JSON.stringify(after));
  out.role = { name: ROLE, ticked, counter, after };
} catch (e) { log("  role failed:", e.message.slice(0, 250)); out.roleErr = e.message.slice(0, 300); }

// ── assign it to a NEW user ──────────────────────────────────────────────────
try {
  await go(owner, "/app/users", { waitMs: 6000 });
  await owner.getByRole("button", { name: /add (a )?user|new user/i }).first().click();
  await owner.waitForTimeout(1500);
  const roleOpts = await owner.locator("[data-testid=role-select] option").allTextContents();
  log("  role options on Add user:", JSON.stringify(roleOpts));
  const hit = roleOpts.find((o) => o.includes(ROLE));
  log("  new role assignable:", !!hit, hit);
  out.assign = { roleOpts, assignable: !!hit };
  if (hit) {
    await owner.locator("input[type=email]").first().fill(`day2.runner.${STAMP}@terrace.local`);
    const nm = owner.locator('input[placeholder="Optional"]');
    if (await nm.count()) await nm.first().fill(`Day2 Runner Hire ${STAMP}`);
    const bs = owner.locator("#create-user-branch");
    const bo = await bs.locator("option").allTextContents();
    await bs.selectOption({ index: bo.findIndex((t) => /HQ|Floating Terrace$/i.test(t.trim())) > 0 ? bo.findIndex((t) => /HQ|Floating Terrace$/i.test(t.trim())) : 1 });
    await owner.waitForTimeout(400);
    await owner.locator("[data-testid=role-select]").selectOption({ label: hit });
    await owner.waitForTimeout(400);
    await shot(owner, "07k-assign-new-role");
    await owner.getByRole("button", { name: /^Create user$/i }).click();
    await owner.waitForTimeout(4500);
    const created = await owner.evaluate(() => document.querySelector("[role=dialog]")?.innerText.replace(/\s+/g, " ").slice(0, 400) ?? null);
    log("  after create user:", created?.slice(0, 300));
    out.assign.created = created;
    await shot(owner, "07l-role-assigned");
  }
} catch (e) { log("  assign failed:", e.message.slice(0, 250)); out.assignErr = e.message.slice(0, 300); }

// ── branch: create, then edit ────────────────────────────────────────────────
try {
  await go(owner, "/app/branches", { waitMs: 7000 });
  const before = await owner.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " ").slice(300, 900));
  await owner.locator("[data-testid=add-branch]").click();
  await owner.waitForTimeout(2000);
  await owner.locator('[role=dialog] input[name="name"]').fill(BRANCH);
  await owner.locator('[role=dialog] input[name="address"]').fill("9 Marina Walk, Clifton, Karachi");
  await owner.locator('[role=dialog] input[name="phone"]').fill("021 111 2222");
  await owner.locator('[role=dialog] input[name="email"]').fill(`day2.${STAMP}@terrace.local`);
  await owner.waitForTimeout(400);
  await shot(owner, "07m-branch-filled");
  await owner.locator("[role=dialog] button").filter({ hasText: /^Add branch$/ }).last().click();
  await owner.waitForTimeout(6000);
  await shot(owner, "07n-branch-created");
  const created = await owner.evaluate((n) => {
    const t = (document.body.innerText || "").replace(/\s+/g, " ");
    const i = t.indexOf(n);
    return { present: i >= 0, snippet: i >= 0 ? t.slice(Math.max(0, i - 40), i + 300) : null };
  }, BRANCH);
  log("  BRANCH CREATED:", JSON.stringify(created).slice(0, 500));
  out.branch = { created };
  // edit it
  const editBtn = owner.locator(`[aria-label="Actions for ${BRANCH}"]`);
  log("  actions menu for the new branch:", await editBtn.count());
  if (await editBtn.count()) {
    await editBtn.first().click();
    await owner.waitForTimeout(1200);
    await owner.getByRole("menuitem", { name: /edit details/i }).click();
    await owner.waitForTimeout(2500);
    const phone = owner.locator('[role=dialog] input[name="phone"]');
    await phone.fill("021 333 4444");
    await owner.waitForTimeout(400);
    await shot(owner, "07o-branch-edit");
    await owner.locator("[role=dialog] button").filter({ hasText: /save|update/i }).last().click();
    await owner.waitForTimeout(5000);
    const edited = await owner.evaluate((n) => {
      const t = (document.body.innerText || "").replace(/\s+/g, " ");
      const i = t.indexOf(n);
      return i >= 0 ? t.slice(Math.max(0, i - 40), i + 300) : null;
    }, BRANCH);
    log("  BRANCH AFTER EDIT:", edited);
    out.branch.edited = edited;
    await shot(owner, "07p-branch-edited");
  } else {
    log("  no Edit control found for the new branch");
    out.branch.noEdit = true;
  }
} catch (e) { log("  branch failed:", e.message.slice(0, 250)); out.branchErr = e.message.slice(0, 300); }

saveState({ newScreens3: out });
await browser.close();
