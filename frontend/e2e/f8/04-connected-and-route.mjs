/*
 * Step 4 — with the agent running:
 *   a) the Printers screen must report it CONNECTED, not "polled before";
 *   b) bind a kitchen printer to the GRILL station on its own port, and save it through the UI.
 */
import { newBrowser, newPage, login, go, shot, PEOPLE } from "./lib.mjs";

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.owner);
  await go(page, "/app/settings/printers", { waitMs: 6000, allowTrouble: true });

  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="print-agent-row"]')).map((n) => ({
      liveness: n.getAttribute("data-agent-liveness"),
      text: (n.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
    })),
  );
  const connected = rows.filter((r) => r.liveness === "CONNECTED");
  console.log("CONNECTED rows:", JSON.stringify(connected, null, 2));
  console.log(`total agents ${rows.length}, connected ${connected.length}`);
  if (connected.length === 0) throw new Error("no agent reports CONNECTED");

  // Bring the live agent to the top of the viewport for the screenshot.
  await page.locator('[data-agent-liveness="CONNECTED"]').first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await shot(page, "04a-agent-connected");

  // ── bind GRILL ─────────────────────────────────────────────────────────────────────────────
  const before = await page.locator('[data-testid="printer-row"]').count();
  await page.locator('[data-testid="add-kitchen-printer"]').click();
  await page.waitForTimeout(800);
  const rowsNow = await page.locator('[data-testid="printer-row"]').count();
  console.log(`printer rows ${before} → ${rowsNow}`);

  const row = page.locator('[data-testid="printer-row"]').last();
  await row.getByLabel("Station").fill("GRILL");
  await row.getByLabel("Port").fill("9102");
  await row.getByLabel("Name").fill("grill-9102");
  await page.waitForTimeout(400);
  await shot(page, "04b-grill-printer-filled");

  await page.locator('[data-testid="save-printers"]').click();
  await page.waitForTimeout(4000);
  const toast = await page.evaluate(() =>
    Array.from(document.querySelectorAll("[data-sonner-toast], li")).map((n) =>
      (n.textContent || "").trim(),
    ).filter((t) => /Saved|Printers saved|Could not save/i.test(t)).slice(0, 3),
  );
  console.log("save toast:", JSON.stringify(toast));
  await shot(page, "04c-grill-saved");
} finally {
  await browser.close();
}
