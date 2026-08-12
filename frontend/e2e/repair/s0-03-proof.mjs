// S0-03 PROOF — the DONE MEANS click path, driven end to end as the manager persona.
//
//   1. Edit the item, change ONLY the Description, Save changes.
//   2. Reload, reopen Edit, and independently GET /pos/menu/items/{id} in the same session.
//      taxRateCode MUST still be 'SR-STD-17' and taxRatePct still 17.
//   3. Deliberately clear the Tax code field and save — removal must STILL work.
//   4. Put it back, so the fix is not proved by leaving the data broken.
//
//   node e2e/repair/s0-03-proof.mjs
import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";

import { SHOTS, captureBearer, login, openAndCheck, readItemOverHttp, shot } from "./s0-03-lib.mjs";

const ITEM_ID = "c496bf7b-e6e9-49ed-b08d-a45536520e90"; // Seekh Kebab, Floating Terrace
const ITEM_NAME = "Seekh Kebab";
const MANAGER = { email: "manager@terrace.local", password: "Terrace#Manager1" };

const log = [];
let failures = 0;
function say(line) {
  console.log(line);
  log.push(line);
}
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  say(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

async function openEdit(page) {
  await page.getByRole("button", { name: `Actions for ${ITEM_NAME}` }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(700);
  return dialog;
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await captureBearer(context);
  const page = await context.newPage();

  const puts = [];
  page.on("request", (req) => {
    if (req.method() === "PUT" && /\/pos\/menu\/items\//.test(req.url())) {
      puts.push(req.postData());
    }
  });

  say("== S0-03 PROOF — manager@terrace.local, Floating Terrace ==");
  say(`signed in at: ${await login(page, MANAGER)}`);

  const seeded = (await readItemOverHttp(page, ITEM_ID)).body?.data ?? {};
  say(`seed state  : taxRatePct=${seeded.taxRatePct} taxRateCode=${JSON.stringify(seeded.taxRateCode)}`);
  check("seed taxRateCode", seeded.taxRateCode, "SR-STD-17");
  check("seed taxRatePct", seeded.taxRatePct, 17);

  const nav = await openAndCheck(page, "/app/menu/items");
  say(`menu page   : h1=${JSON.stringify(nav.h1)} denied=${nav.denied} failed=${nav.failed}`);
  if (nav.denied || nav.failed || nav.missing) throw new Error("menu page did not render a real screen");

  // ── STEP 1: the dialog now SHOWS the classification it is about to round-trip ──────────────
  let dialog = await openEdit(page);
  const labels = await dialog.locator("label").allInnerTexts();
  say(`dialog labels: ${JSON.stringify(labels)}`);
  check(
    "tax rate field value",
    await dialog.getByRole("textbox", { name: "Tax rate (%)" }).inputValue(),
    "17",
  );
  check(
    "tax code field value",
    await dialog.getByRole("textbox", { name: "Tax code" }).inputValue(),
    "SR-STD-17",
  );
  await shot(page, "proof-01-edit-dialog-shows-tax");

  // ── STEP 2: change ONLY the Description ───────────────────────────────────────────────────
  const newDescription = `Seekh Kebab — typo fixed ${Date.now() % 1000000}`;
  const desc = dialog.getByRole("textbox", { name: "Description" });
  await desc.fill(newDescription);
  say(`typed description: ${newDescription}`);
  await shot(page, "proof-02-description-only-change");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForTimeout(2500);
  say(`PUT #1 body : ${puts[0]}`);
  await shot(page, "proof-03-after-save");

  // ── STEP 3: reload, reopen Edit, AND read the API independently ───────────────────────────
  await openAndCheck(page, "/app/menu/items");
  dialog = await openEdit(page);
  await shot(page, "proof-04-reopened-after-reload");
  check(
    "after reload, description",
    await dialog.getByRole("textbox", { name: "Description" }).inputValue(),
    newDescription,
  );
  check(
    "after reload, tax code field",
    await dialog.getByRole("textbox", { name: "Tax code" }).inputValue(),
    "SR-STD-17",
  );
  check(
    "after reload, tax rate field",
    await dialog.getByRole("textbox", { name: "Tax rate (%)" }).inputValue(),
    "17",
  );

  const afterEdit = (await readItemOverHttp(page, ITEM_ID)).body?.data ?? {};
  say(`GET after edit: taxRatePct=${afterEdit.taxRatePct} taxRateCode=${JSON.stringify(afterEdit.taxRateCode)} description=${JSON.stringify(afterEdit.description)}`);
  check("GET taxRateCode survived", afterEdit.taxRateCode, "SR-STD-17");
  check("GET taxRatePct survived", afterEdit.taxRatePct, 17);
  check("GET description changed", afterEdit.description, newDescription);

  // ── STEP 4: removal on purpose must STILL work ────────────────────────────────────────────
  await dialog.getByRole("textbox", { name: "Tax code" }).fill("");
  await shot(page, "proof-05-tax-code-cleared-deliberately");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForTimeout(2500);
  say(`PUT #2 body : ${puts[1]}`);

  const afterClear = (await readItemOverHttp(page, ITEM_ID)).body?.data ?? {};
  say(`GET after clear: taxRatePct=${afterClear.taxRatePct} taxRateCode=${JSON.stringify(afterClear.taxRateCode)}`);
  check("deliberate removal cleared the code", afterClear.taxRateCode, null);
  check("deliberate removal left the rate alone", afterClear.taxRatePct, 17);

  await openAndCheck(page, "/app/menu/items");
  dialog = await openEdit(page);
  check(
    "cleared code reads back empty in the dialog",
    await dialog.getByRole("textbox", { name: "Tax code" }).inputValue(),
    "",
  );
  await shot(page, "proof-06-cleared-reads-back-empty");

  // ── STEP 5: set it back, through the UI, and leave the tenant's data correct ──────────────
  await dialog.getByRole("textbox", { name: "Tax code" }).fill("SR-STD-17");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForTimeout(2500);
  const restored = (await readItemOverHttp(page, ITEM_ID)).body?.data ?? {};
  say(`GET after restore: taxRatePct=${restored.taxRatePct} taxRateCode=${JSON.stringify(restored.taxRateCode)}`);
  check("re-classified through the UI", restored.taxRateCode, "SR-STD-17");
  await openAndCheck(page, "/app/menu/items");
  dialog = await openEdit(page);
  await shot(page, "proof-07-reclassified");

  say(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${SHOTS}/proof-transcript.txt`, log.join("\n") + "\n");
  await browser.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", e);
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(`${SHOTS}/proof-transcript.txt`, log.join("\n") + `\nFAILED: ${e}\n`);
  process.exit(1);
});
