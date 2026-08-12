/*
 * Step 3 — enrol a real print agent through the UI as owner, and capture the one-time credential.
 * Written to the path given in argv[2].
 */
import { writeFileSync } from "node:fs";
import { newBrowser, newPage, login, go, shot, PEOPLE } from "./lib.mjs";

const out = process.argv[2];
if (!out) throw new Error("usage: node 03-enrol.mjs <credential-file>");

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.owner);
  await go(page, "/app/settings/printers", { waitMs: 5000, allowTrouble: true });

  await page.locator('[data-testid="enrol-agent-button"]').click();
  await page.waitForTimeout(800);
  await page.locator("#agent-label").fill("F8 live agent");
  await shot(page, "03a-enrol-dialog");
  await page.getByRole("button", { name: /^Enrol$/ }).click();
  await page.waitForTimeout(3000);

  const secret = await page.locator('[data-testid="agent-secret-value"]').inputValue();
  if (!secret.startsWith("rosprt.")) throw new Error(`unexpected credential shape: ${secret}`);
  writeFileSync(out, secret);
  console.log(`  ✓ credential captured (${secret.slice(0, 20)}…) → ${out}`);
  await shot(page, "03b-credential-shown");

  await page.locator('[data-testid="agent-secret-ack"]').check();
  await page.locator('[data-testid="agent-secret-done"]').click();
  await page.waitForTimeout(1500);
} finally {
  await browser.close();
}
