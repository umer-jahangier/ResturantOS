/*
 * S8 step 8 — the same journey again, framed so a reader can see it.
 *
 * The earlier steps proved the behaviour; their screenshots were of the top of the page, and the
 * printer registry sits below a nineteen-row agent list. This re-drives the two moments that
 * matter and scrolls each one into the viewport first.
 */
import { newBrowser, newPage, login, go, shot, apiGet, branchOf, PEOPLE, OUT } from "./lib.mjs";
import { spawn } from "node:child_process";
import { statSync, writeFileSync } from "node:fs";

const GRILL_PORT = Number(process.env.S8_GRILL_PORT ?? 9105);
const GRILL_CAPTURE = process.env.S8_GRILL_CAPTURE;
if (!GRILL_CAPTURE) throw new Error("set S8_GRILL_CAPTURE");
const size = () => {
  try {
    return statSync(GRILL_CAPTURE).size;
  } catch {
    return 0;
  }
};

const evidence = {};
const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
const branchId = await branchOf(owner);

async function scrollToRegistry(page) {
  await page.evaluate(() => {
    const list = document.querySelector('[data-testid="printer-list"]');
    (list ?? document.querySelector('[data-testid="save-printers"]'))?.scrollIntoView({
      block: "center",
    });
  });
  await page.waitForTimeout(900);
}

// ── A. The device picker, in frame ──────────────────────────────────────────────────────────
await go(owner, "/app/settings/printers", { waitMs: 7000 });
await owner.evaluate(() => {
  document.querySelector('[data-testid="system-printer-picker"]')?.scrollIntoView({ block: "center" });
});
await owner.waitForTimeout(900);
evidence.picker = await owner.evaluate(() => {
  const el = document.querySelector('[data-testid="system-printer-picker"]');
  return el
    ? {
        tag: el.tagName,
        value: el.value,
        options: Array.from(el.options).map((o) => o.textContent.trim()),
      }
    : null;
});
console.log("  picker:", JSON.stringify(evidence.picker, null, 2));
await shot(owner, "08a-device-picker");

// ── B. The GRILL printer goes down mid-service ──────────────────────────────────────────────
const down = spawn("bash", ["-lc", `lsof -ti :${GRILL_PORT} | xargs -r kill -TERM`], { stdio: "ignore" });
await new Promise((r) => down.on("exit", r));
console.log(`  GRILL printer on ${GRILL_PORT} stopped`);

const cash = await newPage(browser);
await login(cash, PEOPLE.cashier);
await go(cash, "/app/pos", { waitMs: 9000, allowTrouble: true });
await cash.locator("[data-testid=order-type-takeaway]").click();
await cash.waitForTimeout(700);
const search = cash.getByLabel(/search menu/i);
if (await search.count()) {
  await search.first().fill("Butter Naan");
  await cash.waitForTimeout(2200);
}
const tiles = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles.first().waitFor({ timeout: 30_000 });
const names = await tiles.allTextContents();
await tiles.nth(names.findIndex((n) => /Butter Naan/i.test(n))).click();
await cash.waitForTimeout(900);
await cash.locator("[data-testid=send-to-kitchen-button]").click();
await cash.waitForTimeout(9000);
evidence.orderDown = (
  await cash.evaluate(() =>
    Array.from(new Set(Array.from(document.body.innerText.matchAll(/ORD-\d{8}-\d+/g)).map((m) => m[0]))),
  )
)[0];
console.log("  fired with GRILL down:", evidence.orderDown);

for (let i = 0; i < 20; i += 1) {
  const res = await apiGet(owner, `/api/v1/pos/printers/health?branchId=${branchId}`);
  const grill = (res.body?.data?.printers ?? []).find((p) => p.printerId === `grill-${GRILL_PORT}`);
  if (grill?.state === "FAILING") break;
  await owner.waitForTimeout(3000);
}
await go(owner, "/app/settings/printers", { waitMs: 7000 });
await owner.evaluate(() => {
  document.querySelector('[data-testid="printers-failing"]')?.scrollIntoView({ block: "center" });
});
await owner.waitForTimeout(1200);
evidence.failingAlert = await owner.evaluate(() => {
  const a = document.querySelector('[data-testid="printers-failing"]');
  return a ? { role: a.getAttribute("role"), text: a.innerText.replace(/\s+/g, " ").trim() } : null;
});
console.log("  alert:", JSON.stringify(evidence.failingAlert));
await shot(owner, "08b-grill-cannot-print");
await scrollToRegistry(owner);
await shot(owner, "08c-registry-rows");

// ── C. Back on, and the next ticket clears it ───────────────────────────────────────────────
const child = spawn(process.execPath, ["e2e/fake-thermal-printer.mjs", String(GRILL_PORT), GRILL_CAPTURE], {
  detached: true,
  stdio: "ignore",
});
child.unref();
await owner.waitForTimeout(2000);
const before = size();

await go(cash, "/app/pos", { waitMs: 9000, allowTrouble: true });
await cash.locator("[data-testid=order-type-takeaway]").click();
await cash.waitForTimeout(700);
const search2 = cash.getByLabel(/search menu/i);
if (await search2.count()) {
  await search2.first().fill("Butter Naan");
  await cash.waitForTimeout(2200);
}
const tiles2 = cash.locator('[data-testid="menu-grid"] button[aria-pressed]');
await tiles2.first().waitFor({ timeout: 30_000 });
const names2 = await tiles2.allTextContents();
await tiles2.nth(names2.findIndex((n) => /Butter Naan/i.test(n))).click();
await cash.waitForTimeout(900);
await cash.locator("[data-testid=send-to-kitchen-button]").click();
await cash.waitForTimeout(9000);
for (let i = 0; i < 15; i += 1) {
  if (size() > before) break;
  await cash.waitForTimeout(1500);
}
evidence.grillBytesOnRecovery = size() - before;
console.log("  bytes at the restarted GRILL printer:", evidence.grillBytesOnRecovery);

for (let i = 0; i < 15; i += 1) {
  const res = await apiGet(owner, `/api/v1/pos/printers/health?branchId=${branchId}`);
  const grill = (res.body?.data?.printers ?? []).find((p) => p.printerId === `grill-${GRILL_PORT}`);
  if (grill?.state === "PRINTING") break;
  await owner.waitForTimeout(2000);
}
await go(owner, "/app/settings/printers", { waitMs: 7000 });
await scrollToRegistry(owner);
evidence.afterRecovery = await owner.evaluate(() => {
  const a = document.querySelector('[data-testid="printers-failing"]');
  const row = Array.from(document.querySelectorAll('[data-testid="printer-row"]')).find((r) =>
    /grill/i.test(r.getAttribute("data-printer-id") ?? ""),
  );
  return {
    stillAccusing: a ? a.innerText.replace(/\s+/g, " ").trim() : null,
    grillState: row?.querySelector('[data-testid="printer-delivery"]')?.getAttribute("data-delivery-state") ?? null,
  };
});
console.log("  after recovery:", JSON.stringify(evidence.afterRecovery));
await shot(owner, "08d-grill-printing-again");

writeFileSync(`${OUT}/08-evidence-shots.json`, JSON.stringify(evidence, null, 2));
await browser.close();
