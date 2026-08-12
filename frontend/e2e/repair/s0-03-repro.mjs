// S0-03 REPRODUCTION — "Editing a menu item's description silently erases its tax code".
//
// Drives the exact click path from the register as the manager persona, records the PUT body the
// browser actually sends, and then reads GET /pos/menu/items/{id} back with the SAME session's
// bearer. Run BEFORE the fix (expect taxRateCode to vanish) and AFTER (expect it to survive).
//
//   node e2e/repair/s0-03-repro.mjs before|after
import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";

import { BASE, SHOTS, captureBearer, login, openAndCheck, readItemOverHttp, shot } from "./s0-03-lib.mjs";

const LABEL = process.argv[2] ?? "run";
const ITEM_ID = "c496bf7b-e6e9-49ed-b08d-a45536520e90"; // Seekh Kebab, Floating Terrace
const ITEM_NAME = "Seekh Kebab";
const MANAGER = { email: "manager@terrace.local", password: "Terrace#Manager1" };

const log = [];
function say(line) {
  console.log(line);
  log.push(line);
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await captureBearer(context);
  const page = await context.newPage();

  const puts = [];
  page.on("request", (req) => {
    if (req.method() === "PUT" && /\/pos\/menu\/items\//.test(req.url())) {
      puts.push({ url: req.url(), body: req.postData() });
    }
  });

  say(`== S0-03 ${LABEL} ==`);
  say(`signed in at: ${await login(page, MANAGER)}`);

  const before = await readItemOverHttp(page, ITEM_ID);
  say(`GET before  : ${JSON.stringify(before).slice(0, 400)}`);

  const nav = await openAndCheck(page, "/app/menu/items");
  say(`menu page   : h1=${JSON.stringify(nav.h1)} denied=${nav.denied} failed=${nav.failed} alerts=${JSON.stringify(nav.alerts)}`);
  if (nav.denied || nav.failed || nav.missing) throw new Error("menu page did not render a real screen");
  await shot(page, `${LABEL}-01-menu-items`);

  // Row action -> Edit
  await page.getByRole("button", { name: `Actions for ${ITEM_NAME}` }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(600);
  await shot(page, `${LABEL}-02-edit-dialog-open`);

  const fieldLabels = await page.getByRole("dialog").locator("label").allInnerTexts();
  say(`dialog labels: ${JSON.stringify(fieldLabels)}`);

  // Change ONLY the description.
  const newDescription = `Seekh Kebab — typo fixed ${LABEL} ${Date.now() % 100000}`;
  const desc = page.getByRole("dialog").getByRole("textbox", { name: "Description" });
  await desc.fill(newDescription);
  say(`typed description: ${newDescription}`);
  await shot(page, `${LABEL}-03-description-typed`);

  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForTimeout(2500);
  await shot(page, `${LABEL}-04-after-save`);

  say(`PUT bodies  : ${JSON.stringify(puts)}`);

  // Reload, then reopen Edit — what the human would do.
  await openAndCheck(page, "/app/menu/items");
  await page.getByRole("button", { name: `Actions for ${ITEM_NAME}` }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.getByRole("dialog").waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(600);
  await shot(page, `${LABEL}-05-reopened-after-reload`);
  const dialogText = await page.getByRole("dialog").innerText();
  say(`reopened dialog text:\n${dialogText}`);

  const after = await readItemOverHttp(page, ITEM_ID);
  say(`GET after   : ${JSON.stringify(after).slice(0, 400)}`);

  const b = before.body?.data ?? {};
  const a = after.body?.data ?? {};
  say(`VERDICT     : description ${JSON.stringify(b.description)} -> ${JSON.stringify(a.description)}`);
  say(`VERDICT     : taxRatePct  ${JSON.stringify(b.taxRatePct)} -> ${JSON.stringify(a.taxRatePct)}`);
  say(`VERDICT     : taxRateCode ${JSON.stringify(b.taxRateCode)} -> ${JSON.stringify(a.taxRateCode)}`);
  say(
    a.taxRateCode === b.taxRateCode
      ? "RESULT      : tax code SURVIVED the description-only edit"
      : "RESULT      : tax code was DESTROYED by the description-only edit",
  );

  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${SHOTS}/${LABEL}-transcript.txt`, log.join("\n") + "\n");
  await browser.close();
}

main().catch(async (e) => {
  console.error("FAILED:", e);
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${SHOTS}/${LABEL}-transcript.txt`, log.join("\n") + `\nFAILED: ${e}\n`);
  process.exit(1);
});
