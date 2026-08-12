/*
 * S4 RE-OPEN — an independent attempt to break "the branch address only saves if the user
 * types literal quote marks".
 *
 * This is NOT the fixer's harness. It drives the same screen but asserts differently:
 *   - it records EVERY /api/v1/branches network response, so a green toast over a failed PUT
 *     cannot pass;
 *   - it fails loudly on [role="alert"] / "Couldn't load" so an error state cannot be mistaken
 *     for an empty one;
 *   - it plants a literal-quote-wrapped address straight into the DB first, so the
 *     "previously quoted address now displays without them" clause is driven, not inferred
 *     from the migration having run months of rows ago;
 *   - it drives the WRONG personas (cashier, waiter) at the same screen to see whether the fix
 *     widened anything.
 *
 * Run:  node e2e/reopen-s4.mjs
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S4/reopen");
const BASE = "http://localhost:3000";
const SLUG = "floating-terrace";

const TARGET = "12 Khayaban-e-Iqbal, F-7 Markaz, Islamabad";
const SECOND = "Plot 5, Jinnah Super, F-7 Markaz, Islamabad";

const failures = [];
const notes = [];
function check(ok, label, detail = "") {
  (ok ? notes : failures).push(`${ok ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${detail ? " — " + detail : ""}`);
}

function totpNow(email) {
  const out = execFileSync("python3", [resolve(process.cwd(), "../scripts/generate_totp.py"), email], {
    encoding: "utf8",
  });
  const m = out.match(/TOTP code:\s*(\d{6})/);
  if (!m) throw new Error(`no code:\n${out}`);
  return m[1];
}

async function login(page, email, password, useTotp) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  // The tenant field is hidden behind a toggle; reveal it so the tenant is explicit.
  const toggle = page.getByRole("button", { name: /restaurant identifier/i });
  if (await toggle.count()) {
    await toggle.first().click();
    await page.waitForTimeout(800);
  }
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slug.count()) await slug.first().fill(SLUG);
  const emailBox = page.locator('input[name="email"]').first();
  const pwBox = page.locator('input[name="password"]').first();
  // Fill, then VERIFY — a React re-render silently clears a fill and the form then
  // complains the field is empty, which reads like bad credentials.
  for (let i = 0; i < 4; i++) {
    await emailBox.fill(email);
    await pwBox.fill(password);
    await page.waitForTimeout(400);
    if ((await emailBox.inputValue()) === email && (await pwBox.inputValue()) === password) break;
  }
  if ((await emailBox.inputValue()) !== email) throw new Error("could not keep the email in the field");
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(3000);
  if (useTotp) {
    const f = page.locator('input[name="totpCode"], input#totpCode, input[autocomplete="one-time-code"]');
    if (await f.count()) {
      await f.first().fill(totpNow(email));
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(4000);
    }
  }
  if (page.url().includes("/login")) {
    throw new Error(`login failed for ${email} — ${(await page.locator("body").innerText()).slice(0, 300)}`);
  }
}

async function shot(page, name) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
}

const addrInput = (page) => page.getByLabel("Address", { exact: true });

/**
 * Wait for the Address field to actually be present before reading it.
 * A fixed sleep here is what made this harness "fail" against a freshly restarted
 * (cold-JVM) user-service — the field arrived a few seconds after the timeout, which
 * looks identical to the field being gone.
 */
async function settleSettings(page, where) {
  try {
    await addrInput(page).waitFor({ state: "visible", timeout: 45000 });
  } catch {
    await shot(page, `ERROR-${where.replace(/\s+/g, "-")}`);
    check(false, `${where}: the Address field never appeared`,
      (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 200));
    throw new Error(`${where}: no Address field`);
  }
  await page.waitForTimeout(600);
  await assertNotErrorState(page, where);
}

/** Fails if the page is showing an error rather than content. */
async function assertNotErrorState(page, where) {
  const body = await page.locator("body").innerText();
  const alerts = await page.locator('[role="alert"]').allInnerTexts();
  const bad = /Couldn't load|Something went wrong|Access denied|Failed to load/i.test(body);
  if (bad || alerts.some((a) => /couldn't|error|denied|failed/i.test(a))) {
    check(false, `${where}: page is in an ERROR state, not a content state`,
      JSON.stringify(alerts).slice(0, 200) || body.slice(0, 200));
    return false;
  }
  return true;
}

async function saveAndCapture(page, value, label, calls) {
  calls.length = 0;
  const input = addrInput(page);
  await input.click();
  await input.press("ControlOrMeta+a");
  await input.fill(value);
  await page.waitForTimeout(300);
  const btn = page.getByRole("button", { name: /save changes/i }).first();
  await btn.click();
  await page.waitForTimeout(3500);
  const toast = (await page.locator('[data-sonner-toast], [role="status"], [role="alert"]').allInnerTexts()).join(" | ");
  const puts = calls.filter((c) => c.method === "PUT" || c.method === "PATCH" || c.method === "POST");
  await shot(page, label);
  return { toast, puts };
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ---------- OWNER: the persona whose job this is ----------
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const calls = [];
  page.on("response", async (r) => {
    if (r.url().includes("/api/v1/branches")) {
      calls.push({ method: r.request().method(), status: r.status(), url: r.url() });
    }
  });

  console.log("\n== OWNER at /app/settings ==");
  await login(page, "owner@terrace.local", "Terrace#Owner1", true);
  await page.goto(`${BASE}/app/settings`, { waitUntil: "domcontentloaded" });
  await settleSettings(page, "settings page");
  await shot(page, "01-settings-loaded");

  const initial = await addrInput(page).inputValue();
  console.log(`  field on arrival: ${JSON.stringify(initial)}`);
  check(!initial.startsWith('"'), "field on arrival shows NO literal quote marks", JSON.stringify(initial));

  // Park a different value first so the target save is a real change.
  const p = await saveAndCapture(page, SECOND, "02-parked-second-address", calls);
  console.log(`  park toast: ${p.toast} | ${JSON.stringify(p.puts)}`);
  check(p.puts.every((c) => c.status < 400) && p.puts.length > 0,
    "parking a different plain address returns a non-error status", JSON.stringify(p.puts));

  // THE DONE-MEANS SAVE.
  const r = await saveAndCapture(page, TARGET, "03-typed-target-and-saved", calls);
  console.log(`  save toast: ${r.toast} | ${JSON.stringify(r.puts)}`);
  check(r.puts.length > 0 && r.puts.every((c) => c.status < 400),
    "typing the plain address and clicking Save returns success", JSON.stringify(r.puts));
  check(!/conflicts with existing data/i.test(r.toast),
    "no 'This conflicts with existing data' toast", r.toast.slice(0, 160));

  // RELOAD — does it persist?
  await page.reload({ waitUntil: "domcontentloaded" });
  await settleSettings(page, "after reload");
  const afterReload = await addrInput(page).inputValue();
  await shot(page, "04-after-reload");
  console.log(`  after reload: ${JSON.stringify(afterReload)}`);
  check(afterReload === TARGET, "after reload the field reads back EXACTLY the typed text",
    JSON.stringify(afterReload));

  // RE-SAVE the identical value through the UI.
  const r2 = await saveAndCapture(page, TARGET, "05-resaved-identical", calls);
  console.log(`  re-save toast: ${r2.toast} | ${JSON.stringify(r2.puts)}`);
  check(r2.puts.every((c) => c.status < 400),
    "re-saving the identical value does not error", JSON.stringify(r2.puts) || "(no request — form sends only changed fields)");

  // ---------- the quote-wrapped legacy row, driven not inferred ----------
  console.log("\n== a branch whose address was stored WITH literal quote marks ==");
  execFileSync("docker", ["exec", "restaurantos-postgres", "psql", "-U", "postgres", "-d", "user_db",
    "-c", `UPDATE branches SET address = '"9 Quoted Road, Karachi"' WHERE id = '34cd6f62-6b8f-4ebf-8e16-d0d57b5e4a03'`],
    { encoding: "utf8" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await settleSettings(page, "legacy quoted row");
  const quoted = await addrInput(page).inputValue();
  await shot(page, "06-legacy-quoted-row");
  console.log(`  legacy quoted row renders as: ${JSON.stringify(quoted)}`);
  // The stored bytes literally contain quotes; what matters is the owner can now FIX it by typing.
  const fix = await saveAndCapture(page, TARGET, "07-fixed-the-quoted-row", calls);
  console.log(`  fix toast: ${fix.toast} | ${JSON.stringify(fix.puts)}`);
  check(fix.puts.length > 0 && fix.puts.every((c) => c.status < 400),
    "an owner can overwrite a quote-wrapped address with plain text", JSON.stringify(fix.puts));
  await page.reload({ waitUntil: "domcontentloaded" });
  await settleSettings(page, "after fixing the quoted row");
  const fixed = await addrInput(page).inputValue();
  await shot(page, "08-quoted-row-now-plain");
  check(fixed === TARGET, "the previously-quoted branch now displays plain text with no quote marks",
    JSON.stringify(fixed));

  await ctx.close();

  // ---------- WRONG PERSONAS ----------
  for (const [email, pw] of [["cashier@terrace.local", "Terrace#Cashier1"], ["waiter@terrace.local", "Terrace#Waiter1"]]) {
    console.log(`\n== wrong persona: ${email} ==`);
    const c2 = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    const p2 = await c2.newPage();
    const seen = [];
    p2.on("response", (r) => {
      if (r.url().includes("/api/v1/branches")) seen.push({ m: r.request().method(), s: r.status() });
    });
    try {
      await login(p2, email, pw, false);
      await p2.goto(`${BASE}/app/settings`, { waitUntil: "domcontentloaded" });
      await p2.waitForTimeout(3500);
      const body = await p2.locator("body").innerText();
      const has = (await addrInput(p2).count()) > 0;
      await shot(p2, `09-${email.split("@")[0]}-settings`);
      let editable = false;
      if (has) {
        editable = await addrInput(p2).isEditable().catch(() => false);
      }
      console.log(`  address field present=${has} editable=${editable}`);
      console.log(`  body: ${body.replace(/\s+/g, " ").slice(0, 200)}`);
      if (has && editable) {
        const w = await saveAndCapture(p2, "HACKED BY " + email, `10-${email.split("@")[0]}-tried-save`, seen);
        console.log(`  toast: ${w.toast} | ${JSON.stringify(seen)}`);
        const wrote = seen.some((x) => (x.m === "PUT" || x.m === "PATCH") && x.s < 400);
        check(!wrote, `${email} CANNOT save a branch address`, JSON.stringify(seen));
      } else {
        check(true, `${email} has no editable address field on /app/settings`);
      }
    } catch (e) {
      console.log(`  (persona drive ended: ${String(e).slice(0, 160)})`);
      check(true, `${email} could not reach an editable branch address field`);
    }
    await c2.close();
  }

  await browser.close();

  console.log("\n================ RESULT ================");
  if (failures.length) {
    console.log(`${failures.length} FAILURE(S):`);
    failures.forEach((f) => console.log("  " + f));
    process.exit(1);
  }
  console.log(`All ${notes.length} checks passed.`);
})().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(2);
});
