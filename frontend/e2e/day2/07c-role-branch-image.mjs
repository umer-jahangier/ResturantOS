/* DAY 2 — 7c/d/e: create a role by ticking permissions and assign it; create and edit a
 * branch; upload a dish photo and confirm it reaches the POS grid. */
import { newBrowser, newPage, go, shot, saveState, loadState, finding, apiGet, log, PEOPLE, login } from "./lib.mjs";
import { writeFileSync } from "node:fs";

const S = loadState();
const STAMP = Date.now().toString().slice(-5);
const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
const out = {};

// ── (c) a role, by ticking permissions ───────────────────────────────────────
try {
  log("\n=== (c) create a role ===");
  await go(owner, "/app/roles", { waitMs: 7000 });
  await owner.getByRole("button", { name: /new role/i }).first().click();
  await owner.waitForTimeout(2500);
  await shot(owner, "07i-new-role-dialog");
  const dlg = await owner.evaluate(() => {
    const d = document.querySelector("[role=dialog]");
    if (!d) return null;
    return {
      inputs: Array.from(d.querySelectorAll("input")).map((i) => ({ type: i.type, ph: i.placeholder, id: i.id, name: i.name })).slice(0, 8),
      checks: d.querySelectorAll('input[type=checkbox], [role=checkbox]').length,
      btns: Array.from(d.querySelectorAll("button")).map((b) => b.textContent.trim()).slice(0, 12),
      text: d.innerText.replace(/\s+/g, " ").slice(0, 700),
    };
  });
  log("  NEW ROLE DIALOG:", JSON.stringify(dlg, null, 1).slice(0, 1500));
  out.roleDialog = dlg;
  const nameBox = owner.locator("[role=dialog] input[type=text]").first();
  await nameBox.fill(`Day2 Runner ${STAMP}`);
  await owner.waitForTimeout(500);
  const checks = owner.locator('[role=dialog] input[type=checkbox], [role=dialog] [role=checkbox]');
  const nChecks = await checks.count();
  log("  permission checkboxes:", nChecks);
  const ticked = [];
  for (let i = 0; i < Math.min(nChecks, 400) && ticked.length < 3; i++) {
    const lbl = await checks.nth(i).evaluate((n) => (n.closest("label") ?? n.parentElement)?.innerText?.trim().slice(0, 60) ?? "");
    if (/pos\.order\.view|pos\.menu\.view|kds/i.test(lbl)) {
      await checks.nth(i).click();
      ticked.push(lbl);
      await owner.waitForTimeout(300);
    }
  }
  if (!ticked.length && nChecks) {
    for (let i = 0; i < 3 && i < nChecks; i++) {
      await checks.nth(i).click();
      ticked.push(await checks.nth(i).evaluate((n) => (n.closest("label") ?? n.parentElement)?.innerText?.trim().slice(0, 60) ?? ""));
      await owner.waitForTimeout(300);
    }
  }
  log("  ticked:", JSON.stringify(ticked));
  await shot(owner, "07j-role-permissions-ticked");
  const create = owner.locator("[role=dialog] button").filter({ hasText: /create|save/i });
  await create.last().click();
  await owner.waitForTimeout(5000);
  await shot(owner, "07k-role-created");
  const after = await owner.evaluate((n) => {
    const t = (document.body.innerText || "").replace(/\s+/g, " ");
    const i = t.indexOf(n);
    return { present: i >= 0, snippet: i >= 0 ? t.slice(i - 40, i + 260) : null, count: /(\d+) roles/.exec(t)?.[0] ?? null };
  }, `Day2 Runner ${STAMP}`);
  log("  ROLE AFTER CREATE:", JSON.stringify(after));
  out.roleCreated = { name: `Day2 Runner ${STAMP}`, ticked, after };
} catch (e) { log("  ROLE STEP FAILED:", e.message.slice(0, 200)); out.roleError = e.message.slice(0, 300); }

// assign it to a user
try {
  await go(owner, "/app/users", { waitMs: 6000 });
  const assign = await owner.evaluate((rn) => {
    const sels = Array.from(document.querySelectorAll("select"));
    const hit = sels.find((s) => Array.from(s.options).some((o) => o.textContent.includes(rn)));
    return { selects: sels.length, roleSelectFound: !!hit, opts: hit ? Array.from(hit.options).map((o) => o.textContent.trim()).slice(0, 15) : null };
  }, out.roleCreated?.name ?? "");
  log("  assign probe on /app/users:", JSON.stringify(assign).slice(0, 500));
  out.assignProbe = assign;
  await shot(owner, "07l-users-assign");
} catch (e) { log("  assign probe failed:", e.message.slice(0, 150)); }

// ── (d) create and edit a branch ─────────────────────────────────────────────
try {
  log("\n=== (d) create and edit a branch ===");
  const tr = await go(owner, "/app/branches", { waitMs: 7000 });
  log("  trouble:", JSON.stringify(tr.bad));
  await shot(owner, "07m-branches");
  await owner.locator("[data-testid=add-branch]").click();
  await owner.waitForTimeout(2500);
  await shot(owner, "07n-add-branch-dialog");
  const bd = await owner.evaluate(() => {
    const d = document.querySelector("[role=dialog]");
    return d ? {
      inputs: Array.from(d.querySelectorAll("input,select,textarea")).map((i) => ({ tag: i.tagName, type: i.type, ph: i.placeholder, id: i.id, name: i.name, label: (i.closest("label")?.innerText ?? "").trim().slice(0, 40) })),
      btns: Array.from(d.querySelectorAll("button")).map((b) => b.textContent.trim()),
      text: d.innerText.replace(/\s+/g, " ").slice(0, 700),
    } : null;
  });
  log("  ADD BRANCH DIALOG:", JSON.stringify(bd, null, 1).slice(0, 1800));
  out.branchDialog = bd;
} catch (e) { log("  BRANCH STEP FAILED:", e.message.slice(0, 200)); out.branchError = e.message.slice(0, 300); }

saveState({ newScreens2: out });
await browser.close();
