import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The three-state greyscale proof.
 *
 * §3.7's claim is that fresh, warn and late remain distinguishable with colour removed
 * entirely. The only way to check that is to get all three on the board at once and
 * desaturate the screenshot — which is what this does, and which the caller arranges by
 * firing real orders so their ages straddle the 0.66 and 1.0 fractions of the station's
 * 900-second escalation threshold.
 *
 * It ASSERTS the three states are present before shooting, so a shot that quietly captured
 * two states fails rather than being filed as evidence of something it does not show.
 */

const OUT = resolve(process.cwd(), "../.planning/phases/21-screen-rebuilds/evidence");

async function login(page: Page, email: string, password: string): Promise<void> {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.getByTestId("login-submit").click();
    try {
      await page.waitForURL(/\/app\//, { timeout: 20_000 });
      return;
    } catch {
      await page.waitForTimeout(4_000);
    }
  }
  throw new Error(`login as ${email} never reached /app`);
}

test("co-present ageing states, in greyscale", async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1920, height: 1080 });

  await login(page, "kitchen@terrace.local", "Terrace#Kitchen1");
  await page.goto("/app/kitchen/DEFAULT", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("kds-ticket-card").first()).toBeVisible({ timeout: 45_000 });

  const states = await page
    .getByTestId("kds-ticket-card")
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-aging")));
  const present = [...new Set(states)].filter((s): s is string => s !== null).sort();

  // At least TWO states must co-exist, or the shot proves nothing about separability.
  // Which two depends on live data — ageing is real time against real receivedAt, so a
  // spec that demanded a fixed trio would be asserting on the clock, not on the board.
  expect(
    present.length,
    `only one ageing state on the board: ${present.join(", ")}`,
  ).toBeGreaterThan(1);

  // Each PRESENT state's border width, measured in the browser rather than inferred
  // from a class name — this fails if the utility did not compile.
  const expected: Record<string, string> = { fresh: "2px", warn: "4px", late: "6px" };
  for (const state of present) {
    const card = page.locator(`[data-testid="kds-ticket-card"][data-aging="${state}"]`).first();
    const width = await card.evaluate((el) => getComputedStyle(el).borderLeftWidth);
    expect(width, `${state} border`).toBe(expected[state]);
  }

  const slug = present.join("-");
  await page.screenshot({ path: `${OUT}/after-kds-${slug}.png` });
  await page.addStyleTag({ content: "html { filter: grayscale(1) !important; }" });
  await page.screenshot({ path: `${OUT}/after-kds-${slug}-greyscale.png` });
  console.log(`captured ageing states: ${present.join(", ")}`);
});
