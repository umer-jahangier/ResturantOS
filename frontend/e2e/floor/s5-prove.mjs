/*
 * S5 — PROOF. Branch management + a branch switch that survives a reload.
 *
 * Drives the exact path in DONE MEANS as owner@terrace.local, in real Chromium:
 *   sidebar → Branches → list → create → reload → rename → switch → RELOAD → data screen
 *   → switch back → deactivate → gone from the switcher.
 *
 * Every token reading is taken from the Authorization header the APP ITSELF sent on its next
 * API call — not from a token this script minted — so "the branch claim moved" is a fact about
 * what the product is using, not about what an endpoint can be made to return.
 *
 * Run: node e2e/floor/s5-prove.mjs
 */
import { newBrowser, newPage, login, PEOPLE, go, pageTrouble, BASE } from "../shift/lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S5");
mkdirSync(OUT, { recursive: true });

const STAMP = String(Date.now()).slice(-5);
const NEW_NAME = `Gulberg Terrace ${STAMP}`;
const RENAMED = `Gulberg Terrace ${STAMP} — Garden`;
const ADDRESS = "5 MM Alam Road, Gulberg III, Lahore";
const ZONE = "Asia/Dubai";

const log = [];
function note(step, detail) {
  log.push({ step, detail });
  console.log(`  · ${step}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
}

function decode(tok) {
  if (!tok) return null;
  try {
    return JSON.parse(Buffer.from(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  } catch {
    return null;
  }
}

const browser = await newBrowser();
const page = await newPage(browser);

// Record the bearer the APPLICATION sends on every gateway call.
const bearers = [];
page.on("request", (req) => {
  const auth = req.headers()["authorization"];
  if (auth && req.url().includes("localhost:8080")) bearers.push(auth.slice(7));
});
function liveBranchClaim() {
  const claims = decode(bearers[bearers.length - 1]);
  return claims?.branch_id ?? null;
}
async function shotAt(name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  console.log(`    shot: ${name}.png`);
}

/**
 * Sign in, retrying a refused attempt.
 *
 * A TOTP code minted at second 29 of its window is stale by the time the second form posts, and
 * the gateway rate-limits repeated logins. Both look identical to "the credentials are wrong",
 * which is why the failure is REPORTED rather than swallowed: a run that quietly signed in as
 * nobody would produce screenshots of a login page filed as evidence of a branch screen.
 */
for (let attempt = 1; ; attempt++) {
  try {
    await login(page, PEOPLE.owner);
    break;
  } catch (e) {
    const shown = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="alert"]'))
        .map((n) => n.textContent?.trim())
        .join(" | "),
    );
    console.log(`  ! login attempt ${attempt} failed (${shown || "no alert on screen"})`);
    if (attempt >= 4) throw e;
    await page.waitForTimeout(20000);
  }
}

// ── 1. Reach Branches FROM THE SIDEBAR ────────────────────────────────────────
await go(page, "/app/dashboard");
const navLink = page.locator('nav a[href="/app/branches"]');
note("sidebar entries matching /app/branches", await navLink.count());
if ((await navLink.count()) === 0) throw new Error("no sidebar link to /app/branches");
await navLink.first().click();
// 90s, not 15: the Next dev server compiles a route on its first request and this one is new.
await page.waitForURL("**/app/branches", { timeout: 90000 });
await page.waitForTimeout(3500);
let trouble = await pageTrouble(page);
if (trouble.bad.length) throw new Error(`branches page in trouble: ${trouble.bad.join(",")}`);
await shotAt("01-branches-from-sidebar");

const rowNames = () =>
  page.$$eval('[data-testid="branch-row"]', (rows) =>
    rows.map((r) => r.querySelector("span.truncate")?.textContent?.trim() ?? ""),
  );
note("branches listed on arrival", await rowNames());

// ── 2. Inline validation, while typing ────────────────────────────────────────
await page.getByTestId("add-branch").click();
await page.waitForTimeout(700);
const emailBox = page.getByLabel("Email");
await emailBox.fill("not-an-email");
await page.waitForTimeout(500);
note("email aria-invalid while typing", await emailBox.getAttribute("aria-invalid"));
note(
  "message under the email box",
  (await page.locator("p.text-destructive, [role='alert']").allTextContents())
    .filter((t) => /@/.test(t))
    .join(" | "),
);
await shotAt("02-inline-validation");
await emailBox.fill("");

// ── 3. Create the third branch ────────────────────────────────────────────────
await page.getByTestId("branch-name-input").fill(NEW_NAME);
await page.getByTestId("branch-address-input").fill(ADDRESS);
// Timezone is a searchable list, not a free text box.
await page.locator("#branch-timezone").click();
await page.waitForTimeout(400);
await page.locator('input[placeholder="Search time zones…"], [cmdk-input]').first().fill(ZONE);
await page.waitForTimeout(600);
await page.locator(`[cmdk-item]:has-text("${ZONE}")`).first().click();
await page.waitForTimeout(300);
await shotAt("03-create-filled");
const posts = [];
page.on("response", async (res) => {
  if (res.request().method() === "POST" && res.url().includes("/api/v1/branches")) {
    posts.push({ status: res.status(), body: (await res.text().catch(() => "")).slice(0, 300) });
  }
});
await page.getByTestId("branch-form-submit").click();
await page.waitForTimeout(4000);
note("POST /api/v1/branches", posts);
note(
  "anything shouting on screen",
  (await page.locator('[role="alert"], .text-destructive, [data-sonner-toast]').allTextContents())
    .map((t) => t.trim())
    .filter(Boolean),
);
note("console errors", page.__console.slice(-4));
await shotAt("03b-after-submit");
note("after create, rows", await rowNames());

// ── 4. It survives a reload ───────────────────────────────────────────────────
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const afterReload = await rowNames();
note("after RELOAD, rows", afterReload);
if (!afterReload.some((n) => n.includes(NEW_NAME))) throw new Error("new branch not in list after reload");
const rowText = await page.locator(`[data-testid="branch-row"]:has-text("${NEW_NAME}")`).innerText();
note("the new row reads", rowText.replace(/\n/g, " | "));
await shotAt("04-after-reload-listed");

// ── 5. Rename it ──────────────────────────────────────────────────────────────
await page.getByRole("button", { name: `Actions for ${NEW_NAME}` }).click();
await page.waitForTimeout(400);
await page.getByRole("menuitem", { name: "Edit details" }).click();
await page.waitForTimeout(800);
await page.getByTestId("branch-name-input").fill(RENAMED);
await page.getByTestId("branch-form-submit").click();
await page.waitForTimeout(2500);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
note("after rename + RELOAD, rows", await rowNames());
await shotAt("05-renamed");

// ── 6. The switcher now offers it, and switching MOVES THE TOKEN ──────────────
const trigger = page.locator('button[aria-label="Switch branch"]');
note("switcher present", (await trigger.count()) > 0);
if ((await trigger.count()) === 0) throw new Error("branch switcher did not appear after create");
note("switcher label before switch", (await trigger.first().textContent())?.trim());
const branchBefore = liveBranchClaim();
note("live token branch_id BEFORE switch", branchBefore);

await trigger.first().click();
await page.waitForTimeout(600);
const options = await page.locator('[role="menuitem"]').allTextContents();
note("switcher options", options.map((o) => o.trim()));
await page.locator(`[role="menuitem"]:has-text("${RENAMED}")`).first().click();
await page.waitForTimeout(4000);
note("switcher label after switch", (await trigger.first().textContent())?.trim());
bearers.length = 0;
await go(page, "/app/branches");
await page.waitForTimeout(2000);
const branchAfterSwitch = liveBranchClaim();
note("live token branch_id AFTER switch", branchAfterSwitch);
await shotAt("06-switched");

// ── 7. RELOAD — the register's #16: the label used to revert to HQ ────────────
bearers.length = 0;
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
const labelAfterReload = (await trigger.first().textContent())?.trim();
const branchAfterReload = liveBranchClaim();
note("switcher label after RELOAD", labelAfterReload);
note("live token branch_id after RELOAD", branchAfterReload);
await shotAt("07-after-reload-still-switched");

// ── 8. A data screen shows THAT branch's data ────────────────────────────────
bearers.length = 0;
const takings = await go(page, "/app/finance/takings", { waitMs: 5000 });
note("takings page trouble", takings.bad);
note("takings branch on the wire", liveBranchClaim());
note(
  "takings body head",
  (await page.evaluate(() => (document.body.innerText || "").slice(0, 400))).replace(/\n/g, " | "),
);
await shotAt("08-takings-on-new-branch");

bearers.length = 0;
const pos = await go(page, "/app/pos", { waitMs: 6000, allowTrouble: true });
note("order management trouble", pos.bad);
note("order management branch on the wire", liveBranchClaim());
note(
  "order management body head",
  (await page.evaluate(() => (document.body.innerText || "").slice(0, 400))).replace(/\n/g, " | "),
);
await shotAt("09-orders-on-new-branch");

// ── 9. Switch back, then deactivate — it leaves the switcher ─────────────────
await go(page, "/app/branches");
await trigger.first().click();
await page.waitForTimeout(600);
await page.locator('[role="menuitem"]:has-text("Floating Terrace HQ")').first().click();
await page.waitForTimeout(4000);
note("switched back to", (await trigger.first().textContent())?.trim());

await go(page, "/app/branches");
await page.getByRole("button", { name: `Actions for ${RENAMED}` }).click();
await page.waitForTimeout(400);
await page.getByRole("menuitem", { name: "Deactivate" }).click();
await page.waitForTimeout(800);
note(
  "confirmation copy",
  (await page.locator('[role="dialog"]').innerText()).replace(/\n/g, " | ").slice(0, 300),
);
await shotAt("10-deactivate-confirm");
await page.getByRole("button", { name: "Deactivate branch" }).click();
await page.waitForTimeout(3500);
note("rows after deactivate", await rowNames());

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(4500);
const switcherAfterDeactivate = await trigger.count();
note("switcher present after deactivate + reload", switcherAfterDeactivate > 0);
if (switcherAfterDeactivate > 0) {
  await trigger.first().click();
  await page.waitForTimeout(600);
  note(
    "switcher options after deactivate",
    (await page.locator('[role="menuitem"]').allTextContents()).map((o) => o.trim()),
  );
  await page.keyboard.press("Escape");
}
note("rows after deactivate + reload", await rowNames());
const showDeactivated = page.locator('input[type="checkbox"]');
if (await showDeactivated.count()) {
  await showDeactivated.first().check();
  await page.waitForTimeout(800);
  note("rows with Show deactivated ticked", await rowNames());
}
await shotAt("11-deactivated-gone-from-switcher");

// ── 10. Responsive + themes ──────────────────────────────────────────────────
await showDeactivated.first().uncheck().catch(() => {});
for (const [w, h] of [
  [390, 844],
  [768, 1024],
  [1440, 900],
]) {
  for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: w, height: h });
    await page.emulateMedia({ colorScheme: theme });
    await go(page, "/app/branches", { waitMs: 2500 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    note(`viewport ${w} ${theme}`, { horizontalOverflow: overflow, bodyBackground: bg });
    await shotAt(`12-branches-${w}-${theme}`);
  }
}

writeFileSync(resolve(OUT, "s5-prove.json"), JSON.stringify(log, null, 2));
await browser.close();
console.log("\nwrote", resolve(OUT, "s5-prove.json"));
console.log("NEW BRANCH:", RENAMED);
