/* Re-verify the settings screen after the useWatch change: the preview must still move live. */
import { PEOPLE, newBrowser, newPage, login, go, log } from "../shift/lib.mjs";
import { resolve } from "node:path";
const OUT = resolve(process.cwd(), "../.planning/audits/floor/F20");

const browser = await newBrowser();
const own = await newPage(browser);
for (let i = 1; ; i += 1) {
  try {
    await login(own, PEOPLE.owner);
    break;
  } catch (e) {
    if (i >= 3) throw e;
    await own.waitForTimeout(4000);
  }
}
await go(own, "/app/settings/service-charge", { waitMs: 3000, allowTrouble: true });
await own.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((n) => n.remove()));
await own.locator("[data-testid=service-charge-enabled]").waitFor({ timeout: 30000 });

const read = async () => ({
  enabled: await own.locator("[data-testid=service-charge-enabled]").isChecked(),
  rate: await own.locator("[data-testid=service-charge-rate]").inputValue(),
  preview: await own.locator("[data-testid=service-charge-preview]").getAttribute("data-paisa"),
});
log("as loaded:", JSON.stringify(await read()));

await own.locator("[data-testid=service-charge-rate]").fill("12.5");
await own.waitForTimeout(700);
log("after typing 12.5:", JSON.stringify(await read()));

// The two refusals, at the UI, as the user types.
await own.locator("[data-testid=service-charge-rate]").fill("0");
await own.locator("[data-testid=service-charge-save]").click();
await own.waitForTimeout(1200);
log(
  "enabled at 0% ->",
  JSON.stringify(
    await own.evaluate(() =>
      Array.from(document.querySelectorAll("p, [role=alert]"))
        .map((n) => n.textContent.trim())
        .filter((t) => /percentage above 0|between 0% and 100%|Enter a percentage/i.test(t)),
    ),
  ),
);
await own.screenshot({ path: `${OUT}/p16-validation-refuses-zero.png` });

await own.locator("[data-testid=service-charge-rate]").fill("abc");
await own.waitForTimeout(400);
await own.locator("[data-testid=service-charge-save]").click();
await own.waitForTimeout(1000);
log(
  "unparseable ->",
  JSON.stringify(
    await own.evaluate(() =>
      Array.from(document.querySelectorAll("p"))
        .map((n) => n.textContent.trim())
        .filter((t) => /Enter a percentage, like/i.test(t)),
    ),
  ),
);
await own.screenshot({ path: `${OUT}/p17-validation-unparseable.png` });

// Leave the branch configured at 5% dine-in, which is the state DONE MEANS describes.
await own.locator("[data-testid=service-charge-rate]").fill("5");
await own.locator("[data-testid=service-charge-enabled]").check();
await own.locator("[data-testid=service-charge-save]").click();
await own.waitForTimeout(3000);
log("final:", JSON.stringify(await read()));
await own.screenshot({ path: `${OUT}/p18-final-state.png` });
await browser.close();
