// Real-browser proof for phase 28: an admin creates a station and binds an account to it,
// entirely from screens. Run: node station-proof.mjs
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";

const REPO = "/Users/muhammadumer/Documents/Projects/ResturantOS";
const SHOTS = `${REPO}/.planning/phases/28-station-pos-profiles/screenshots`;
const BASE = "http://localhost:3000";

function totp(email) {
  const out = execFileSync("python3", [`${REPO}/scripts/generate_totp.py`, email], {
    cwd: REPO,
    encoding: "utf8",
  });
  return out.match(/TOTP code:\s*(\d{6})/)[1];
}

const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.log("  console.error:", m.text().slice(0, 200));
});

try {
  step(1, "Sign in as the tenant admin");
  await page.goto(`${BASE}/login?tenant=floating-terrace`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500); // the tenant brand resolves and re-renders the form
  const totpField = page.getByTestId("totp-code");
  for (let attempt = 0; attempt < 6 && !/\/app\//.test(page.url()); attempt += 1) {
    // Refilled every attempt: the form re-renders when the brand resolves and clears them.
    await page.getByLabel("Email").fill("admin@terrace.local");
    await page.getByLabel("Password").fill("Terrace#Admin1");
    if (await totpField.isVisible().catch(() => false)) {
      console.log(`  attempt ${attempt}: step-up challenged — supplying a TOTP code`);
      await totpField.fill(totp("admin@terrace.local"));
    }
    await page.getByTestId("login-submit").click();
    await Promise.race([
      page.waitForURL(/\/app\//, { timeout: 8000 }).catch(() => {}),
      totpField.waitFor({ state: "visible", timeout: 8000 }).catch(() => {}),
    ]);
    await page.waitForTimeout(1200);
  }
  if (!/\/app\//.test(page.url())) {
    console.log("  page text:", (await page.locator("body").innerText()).slice(0, 600));
    await page.screenshot({ path: `${SHOTS}/99-login.png`, fullPage: true });
  }
  await page.waitForURL(/\/app\//, { timeout: 20000 });
  console.log("  signed in ->", page.url());

  step(2, "Open the Stations screen from the navigation");
  await page.goto(`${BASE}/app/stations`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/01-stations-empty.png`, fullPage: true });
  console.log("  heading:", await page.locator("h1").first().innerText());

  step(3, "Create a BAR station");
  const existing = await page.getByTestId("station-row").count();
  if (existing === 0 || !(await page.getByText("Main bar").first().isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Add station" }).first().click();
    await page.getByLabel(/^Code/).fill("bar");           // lower case on purpose
    await page.getByLabel(/^Name/).fill("Main bar");
    await page.getByTestId("station-type-select").selectOption("BAR");
    await page.screenshot({ path: `${SHOTS}/02-station-form.png` });
    await page.getByRole("button", { name: "Add station" }).last().click();
    await page.waitForTimeout(2500);
  }
  // And a kitchen station, so the scope has something to exclude.
  if (!(await page.getByText("Hot line").first().isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Add station" }).first().click();
    await page.getByLabel(/^Code/).fill("grill");
    await page.getByLabel(/^Name/).fill("Hot line");
    await page.getByTestId("station-type-select").selectOption("KITCHEN");
    await page.getByRole("button", { name: "Add station" }).last().click();
    await page.waitForTimeout(2500);
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/03-stations-created.png`, fullPage: true });
  console.log("  rows now:", await page.getByTestId("station-row").count());
  console.log("  body has BAR:", (await page.content()).includes(">BAR<"));

  step(4, "Open Users and create an account bound to the BAR station");
  await page.goto(`${BASE}/app/users`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const addUser = page.getByRole("button", { name: /add user/i }).first();
  await addUser.click();
  const email = `bartender+${Date.now()}@terrace.local`;
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Full name").fill("Asha the bartender");
  const branchSelect = page.getByLabel("Branch");
  await page.waitForTimeout(1200);
  const branchValues = await branchSelect.locator("option").evaluateAll((os) =>
    os.map((o) => ({ v: o.value, t: o.textContent })),
  );
  console.log("  branches offered:", JSON.stringify(branchValues));
  const mainBranch = branchValues.find((b) => b.v && b.t.includes("HQ")) ?? branchValues.find((b) => b.v);
  await branchSelect.selectOption(mainBranch.v);
  await page.getByLabel("Role").selectOption("KITCHEN_STAFF").catch(async () => {
    const roles = await page.getByTestId("role-select").locator("option").evaluateAll((os) =>
      os.map((o) => o.value),
    );
    console.log("  roles offered:", JSON.stringify(roles));
    throw new Error("KITCHEN_STAFF not offered");
  });
  await page.waitForTimeout(1500);

  const field = page.getByTestId("station-assignment-field");
  console.log("  station field present:", await field.isVisible());
  console.log("  summary BEFORE:", await page.getByTestId("station-assignment-summary").innerText());
  console.log("  delay notice:", await page.getByTestId("station-assignment-delay-notice").innerText());
  await page.screenshot({ path: `${SHOTS}/04-user-form-station-picker.png` });

  await field.getByLabel(/Main bar/).check();
  await page.waitForTimeout(300);
  console.log("  summary AFTER :", await page.getByTestId("station-assignment-summary").innerText());
  await page.screenshot({ path: `${SHOTS}/05-user-form-bar-selected.png` });

  await page.getByRole("button", { name: "Create user" }).click();
  await page.waitForTimeout(3000);
  const tempPw = await page
    .getByTestId("temp-password")
    .innerText()
    .catch(async () => {
      const body = await page.locator("body").innerText();
      const m = body.match(/[A-Za-z0-9!@#$%^&*_-]{10,}/g);
      return m ? m.join("\n") : "";
    });
  await page.screenshot({ path: `${SHOTS}/06-account-created.png` });
  console.log("  created:", email);
  console.log("  temp password candidates:", tempPw.slice(0, 300));

  await page.getByRole("button", { name: "Done" }).click().catch(() => {});
  await page.waitForTimeout(1500);

  step(5, "Confirm the assignment is readable on the detail panel");
  await page.goto(`${BASE}/app/users`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.getByText(email).first().click().catch(() => {});
  await page.waitForTimeout(2500);
  const scope = page.getByTestId("user-station-scope");
  console.log("  detail panel stations:", await scope.innerText().catch(() => "NOT FOUND"));
  await page.screenshot({ path: `${SHOTS}/07-user-detail-stations.png`, fullPage: true });

  console.log("\nRESULT_EMAIL=" + email);
} catch (err) {
  console.error("\nFAILED:", err.message);
  await page.screenshot({ path: `${SHOTS}/99-failure.png`, fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
