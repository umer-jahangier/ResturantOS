/*
 * S8 step 6 — the same screen, twice: while the GRILL printer is off, and after it comes back.
 *
 * The second half matters as much as the first. A screen that shouts is easy; a screen that stops
 * shouting on its own, without anybody clicking anything, is what stops the warning being ignored.
 */
import { newBrowser, newPage, login, go, shot, apiGet, branchOf, PEOPLE, OUT } from "./lib.mjs";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";

const GRILL_PORT = Number(process.env.S8_GRILL_PORT ?? 9105);
const GRILL_CAPTURE = process.env.S8_GRILL_CAPTURE;

const evidence = {};
const browser = await newBrowser();
const owner = await newPage(browser);
await login(owner, PEOPLE.owner);
const branchId = await branchOf(owner);

async function readScreen(page) {
  return page.evaluate(() => {
    const failing = document.querySelector('[data-testid="printers-failing"]');
    const row = Array.from(document.querySelectorAll('[data-testid="printer-row"]')).find((r) =>
      /grill/i.test(r.getAttribute("data-printer-id") ?? ""),
    );
    return {
      failingRole: failing?.getAttribute("role") ?? null,
      failingText: failing ? failing.innerText.replace(/\s+/g, " ").trim() : null,
      grillRow: row
        ? {
            id: row.getAttribute("data-printer-id"),
            state: row.querySelector('[data-testid="printer-delivery"]')?.getAttribute("data-delivery-state"),
            badge: row.querySelector('[data-testid="printer-delivery"]')?.textContent?.trim(),
            detail: row.querySelector('[data-testid="printer-delivery"]')?.parentElement?.innerText
              ?.replace(/\s+/g, " ")
              .trim(),
          }
        : null,
    };
  });
}

// ── While it is off ─────────────────────────────────────────────────────────────────────────
await go(owner, "/app/settings/printers", { waitMs: 7000 });
await owner.waitForTimeout(2500);
evidence.whileDown = await readScreen(owner);
console.log("  while down:", JSON.stringify(evidence.whileDown, null, 2));
await shot(owner, "06a-grill-cannot-print");

// ── Switch the printer back on, and touch nothing else ──────────────────────────────────────
if (!GRILL_CAPTURE) throw new Error("set S8_GRILL_CAPTURE");
const child = spawn(
  process.execPath,
  ["e2e/fake-thermal-printer.mjs", String(GRILL_PORT), GRILL_CAPTURE],
  { detached: true, stdio: "ignore" },
);
child.unref();
console.log(`  GRILL printer restarted on ${GRILL_PORT} (pid ${child.pid})`);
evidence.restartedPid = child.pid;

// The agent's backoff is exponential from 5s; the held ticket drains on its own.
for (let i = 0; i < 40; i += 1) {
  const res = await apiGet(owner, `/api/v1/pos/printers/health?branchId=${branchId}`);
  const grill = (res.body?.data?.printers ?? []).find((p) => p.printerId === `grill-${GRILL_PORT}`);
  if (grill?.state === "PRINTING") {
    evidence.recoveredAfterSeconds = i * 3;
    break;
  }
  await owner.waitForTimeout(3000);
}
console.log("  recovered after ~", evidence.recoveredAfterSeconds, "s");

await owner.reload({ waitUntil: "domcontentloaded" });
await owner.waitForTimeout(6000);
evidence.afterRecovery = await readScreen(owner);
console.log("  after recovery:", JSON.stringify(evidence.afterRecovery, null, 2));
await shot(owner, "06b-grill-recovered");

writeFileSync(`${OUT}/06-recover.json`, JSON.stringify(evidence, null, 2));
await browser.close();
