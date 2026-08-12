/*
 * S4 — "the branch address only saves if the user types literal quote marks".
 *
 * Drives the exact path in DONE MEANS as the OWNER (the persona who edits branch settings):
 * open /app/settings, type a real Islamabad street address with NO quote marks, save, reload,
 * and save the same value a second time. Every assertion is on what the human sees — the toast
 * text and the value the input holds after a reload — not on a response body.
 *
 * Run:  node e2e/branch-address.mjs before|after
 */
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const LABEL = process.argv[2] ?? "run";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/S4", LABEL);
const BASE = "http://localhost:3000";

const OWNER = {
  slug: "floating-terrace",
  email: "owner@terrace.local",
  password: "Terrace#Owner1",
};

const ADDRESS = "12 Khayaban-e-Iqbal, F-7 Markaz, Islamabad";
/** A second real address, so one save writes plain text OVER stored plain text. */
const SECOND_ADDRESS = "Plot 5, Jinnah Super, F-7 Markaz, Islamabad";

/**
 * The live code, from the ONE generator that reads the enrolled secret out of auth_db.
 *
 * <p>A hard-coded base32 secret is what made the first run of this harness fail: the constant
 * copied from `shots-owner.mjs` no longer matches what the account is enrolled with, and the
 * failure surfaced as "login failed" with no hint that the second factor was the reason.
 */
function totpNow(email) {
  const out = execFileSync("python3", [resolve(process.cwd(), "../scripts/generate_totp.py"), email], {
    encoding: "utf8",
  });
  const match = out.match(/TOTP code:\s*(\d{6})/);
  if (!match) throw new Error(`generate_totp.py printed no code:\n${out}`);
  return match[1];
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const slugField = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (await slugField.count()) await slugField.first().fill(OWNER.slug);
  await page.locator('input[name="email"], input#email').first().fill(OWNER.email);
  await page.locator('input[name="password"], input#password').first().fill(OWNER.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(2500);
  const totpField = page.locator('input[name="totpCode"], input#totpCode, input[autocomplete="one-time-code"]');
  if (await totpField.count()) {
    await totpField.first().fill(totpNow(OWNER.email));
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(4000);
  }
  if (page.url().includes("/login")) {
    const shown = await page.locator("body").innerText();
    throw new Error(`login failed — still at ${page.url()}\n${shown.slice(0, 400)}`);
  }
}

async function shot(page, name) {
  const file = `${OUT}/${name}.png`;
  mkdirSync(dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: false });
  console.log("  shot →", `${name}.png`);
}

function addressInput(page) {
  // The label is the user's handle on the field; a name= selector would pass on a renamed field.
  return page.getByLabel("Address", { exact: true });
}

async function openSettings(page) {
  await page.goto(`${BASE}/app/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  const body = await page.locator("body").innerText();
  if (/Access denied|You do not have permission/i.test(body)) {
    throw new Error("settings is a refusal page for this persona — the shot would be a lie");
  }
  if (/Couldn't load|Something went wrong/i.test(body)) {
    throw new Error(`settings rendered an ERROR state, not an empty one: ${body.slice(0, 200)}`);
  }
  await addressInput(page).waitFor({ state: "visible", timeout: 15000 });
}

/** Types `value` into Address, saves, and returns what the user was told. */
async function saveAddress(page, value) {
  const field = addressInput(page);
  await field.fill(value);
  const responses = [];
  const listener = (res) => {
    if (/\/api\/v1\/branches\//.test(res.url()) && res.request().method() === "PUT") {
      responses.push(res);
    }
  };
  page.on("response", listener);
  await page.getByRole("button", { name: /Save changes/i }).click();
  await page.waitForTimeout(4000);
  page.off("response", listener);

  const toast = await page.locator("[data-sonner-toast]").allInnerTexts();
  const status = responses.length ? responses[responses.length - 1].status() : null;
  let bodyText = null;
  if (responses.length) {
    bodyText = await responses[responses.length - 1].text().catch(() => null);
  }
  return { toast: toast.join(" | "), status, bodyText };
}

async function run(page, problems) {
  await login(page);
  console.log("  signed in as owner@terrace.local");

  await openSettings(page);
  const onArrival = await addressInput(page).inputValue();
  console.log(`  address field on arrival: ${JSON.stringify(onArrival)}`);
  await shot(page, "01-settings-on-arrival");
  if (onArrival.includes('"')) {
    problems.push(`arrival: the field shows literal quote marks — ${JSON.stringify(onArrival)}`);
  }

  // The form sends only what CHANGED, so if a previous run already stored the DONE MEANS address
  // the headline save below would be a "Nothing to save" no-op and would prove nothing. Park a
  // different value first so save #1 is a genuine write every time this harness runs.
  if (onArrival === ADDRESS) {
    console.log("  field already holds the target address — parking a different one first");
    const parked = await saveAddress(page, SECOND_ADDRESS);
    if (parked.status !== 200) {
      problems.push(`could not park a starting value: HTTP ${parked.status}`);
    }
    await openSettings(page);
  }

  // 1. Save the plain address the owner would actually type.
  const first = await saveAddress(page, ADDRESS);
  console.log(`  save #1 → HTTP ${first.status} · toast: ${first.toast}`);
  await shot(page, "02-after-first-save");
  if (first.status !== 200) {
    problems.push(`save #1 answered HTTP ${first.status}: ${String(first.bodyText).slice(0, 200)}`);
  }
  if (!/saved/i.test(first.toast)) {
    problems.push(`save #1 did not tell the user it saved — toast was "${first.toast}"`);
  }

  // 2. Reload. The stored value must come back byte-for-byte.
  await openSettings(page);
  const reloaded = await addressInput(page).inputValue();
  console.log(`  after reload: ${JSON.stringify(reloaded)}`);
  await shot(page, "03-after-reload");
  if (reloaded !== ADDRESS) {
    problems.push(`after reload the field holds ${JSON.stringify(reloaded)}, not ${JSON.stringify(ADDRESS)}`);
  }

  // 3. Write plain text OVER plain text. The form sends only what changed, so an identical value
  //    would be a no-op toast and would prove nothing; a second real address does prove it.
  const second = await saveAddress(page, SECOND_ADDRESS);
  console.log(`  save #2 (${SECOND_ADDRESS}) → HTTP ${second.status} · toast: ${second.toast}`);
  await shot(page, "04-after-second-save");
  if (second.status !== 200 || !/saved/i.test(second.toast)) {
    problems.push(`save #2 over a stored plain address: HTTP ${second.status}, toast "${second.toast}"`);
  }

  // 4. Back to the address in DONE MEANS, and it must survive a reload unchanged.
  const third = await saveAddress(page, ADDRESS);
  console.log(`  save #3 (back to the original) → HTTP ${third.status} · toast: ${third.toast}`);
  if (third.status !== 200 || !/saved/i.test(third.toast)) {
    problems.push(`save #3 back to the original: HTTP ${third.status}, toast "${third.toast}"`);
  }

  await openSettings(page);
  const finalValue = await addressInput(page).inputValue();
  console.log(`  final stored value: ${JSON.stringify(finalValue)}`);
  await shot(page, "05-final");
  if (finalValue !== ADDRESS) {
    problems.push(`final value is ${JSON.stringify(finalValue)}, not ${JSON.stringify(ADDRESS)}`);
  }
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("    ! page error:", String(e).slice(0, 160)));

  const problems = [];
  try {
    await run(page, problems);
  } catch (e) {
    problems.push(`HARNESS ERROR: ${e && e.message ? e.message : String(e)}`);
    await shot(page, "99-harness-error").catch(() => {});
  } finally {
    // Always. A leaked browser keeps node's event loop alive and the run never ends — which is
    // how the first attempt at this file appeared to hang for six minutes after it had already
    // thrown.
    await ctx.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  console.log("\nevidence →", OUT);
  if (problems.length) {
    console.log("\nPROBLEMS:");
    for (const p of problems) console.log("  ·", p);
    process.exitCode = 1;
  } else {
    console.log("\nAll checks passed: a plain address saves, round-trips and re-saves.");
  }
}

main();
