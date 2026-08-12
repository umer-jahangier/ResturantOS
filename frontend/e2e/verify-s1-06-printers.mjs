// S1-06 — "No printer configuration screen exists".
// Drives real Chromium through the whole DONE-MEANS click path, starting a REAL print agent
// with the credential the UI issued, and reading bytes off two captured thermal printers.
//
//   node e2e/fake-thermal-printer.mjs 9100 /tmp/receipt-printer.bin &
//   node e2e/fake-thermal-printer.mjs 9101 /tmp/kitchen-printer.bin &
//   S1_06_SCRATCH=/tmp node e2e/verify-s1-06-printers.mjs after
//
// The two capture servers are REQUIRED: the assertions read bytes off them, and without them the
// agent has nowhere to deliver. `before` re-runs the reproduction (expects 404s).
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const LABEL = process.argv[2] ?? "after";
const OUT = resolve(process.cwd(), "../.planning/audits/repair/S1-06", LABEL);
const BASE = "http://localhost:3000";
const SCRATCH = process.env.S1_06_SCRATCH ?? "/tmp";
mkdirSync(OUT, { recursive: true });

const MANAGER = {
  slug: "floating-terrace",
  email: "manager@terrace.local",
  password: "Terrace#Manager1",
};
const CASHIER = {
  slug: "floating-terrace",
  email: "cashier@terrace.local",
  password: "Terrace#Cashier1",
};

const log = (...a) => console.log(...a);
let failures = 0;
function check(name, ok, detail = "") {
  log(`${ok ? "  PASS" : "  FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failures += 1;
}

/** Waits for a captured printer file to grow. Byte counts are the evidence; timing is not. */
async function waitForGrowth(path, before, ms = 25000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const now = existsSync(path) ? readFileSync(path).length : 0;
    if (now > before) return now;
    await new Promise((r) => setTimeout(r, 500));
  }
  return existsSync(path) ? readFileSync(path).length : 0;
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  log("   shot", name);
}

async function login(page, p) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(900);
  const slug = page.locator('input[name="tenantSlug"], input#tenantSlug');
  if (p.slug && (await slug.count())) await slug.first().fill(p.slug);
  await page.locator('input[name="email"], input#email').first().fill(p.email);
  await page.locator('input[name="password"], input#password').first().fill(p.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForTimeout(4500);
  return !page.url().includes("/login");
}

/** Instruments window.print so an opened browser dialog is a countable fact, not an impression. */
async function instrumentPrint(page, sink) {
  await page.exposeFunction("__recordPrint", (where) => sink.push(where));
  await page.addInitScript(() => {
    const original = window.print.bind(window);
    window.print = function (...args) {
      window.__recordPrint?.(location.pathname);
      return original(...args);
    };
  });
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  const printCalls = [];
  const agentCalls = [];
  await instrumentPrint(page, printCalls);
  page.on("request", (r) => {
    if (r.url().includes(":7654")) agentCalls.push(`${r.method()} ${r.url()}`);
  });
  page.on("console", (m) => {
    if (m.type() === "error") log("    ! console:", m.text().slice(0, 160));
  });
  page.on("response", async (r) => {
    if (r.url().includes("print-agents") || r.url().includes("receipt-config")) {
      const body = await r.text().catch(() => "");
      log(`    < ${r.request().method()} ${r.status()} ${r.url().split("/api/v1")[1]} ${body.slice(0, 160)}`);
    }
  });

  log("\n=== 1. Manager signs in ===");
  check("manager login", await login(page, MANAGER));

  log("\n=== 2. Printers is reachable FROM THE SIDEBAR ===");
  const navLink = page.locator('nav a[href="/app/settings/printers"], aside a[href="/app/settings/printers"]');
  const navCount = await navLink.count();
  check("sidebar has a Printers entry", navCount > 0, `count=${navCount}`);
  await shot(page, "01-sidebar");
  if (navCount > 0) {
    await navLink.first().click();
    await page.waitForURL(/settings\/printers/, { timeout: 20000 }).catch(() => {});
  }
  if (!page.url().includes("/settings/printers")) {
    log("   (sidebar click did not navigate; going direct)");
    await page.goto(`${BASE}/app/settings/printers`, { waitUntil: "domcontentloaded" });
  }
  await page.waitForTimeout(4000);
  const h1 = await page.locator("h1").first().innerText().catch(() => "(none)");
  check("Printers screen renders (not 404, not Access denied)", h1 === "Printers", `h1="${h1}"`);
  await shot(page, "02-printers-screen");
  if (h1 !== "Printers") {
    log("\nSTOPPING: the screen did not render.");
    await browser.close();
    process.exit(1);
  }

  log("\n=== 3. Enrol an agent; the secret is shown ONCE and says so ===");
  await page.getByTestId("enrol-agent-button").click();
  await page.waitForTimeout(900);
  await page.locator("#agent-label").fill("S1-06 verification agent");
  await page.getByRole("button", { name: "Enrol", exact: true }).click();
  await page.getByTestId("agent-secret-dialog").waitFor({ timeout: 20000 }).catch(() => {});
  const secretDialog = page.getByTestId("agent-secret-dialog");
  const dialogAppeared = (await secretDialog.count()) > 0;
  if (!dialogAppeared) {
    await shot(page, "03-ENROL-FAILED");
    log("   page text:", (await page.locator("body").innerText()).slice(0, 500).replace(/\n+/g, " | "));
  }
  check("one-time secret dialog appeared", dialogAppeared);
  if (!dialogAppeared) {
    await browser.close();
    process.exit(1);
  }
  const dialogText = await secretDialog.innerText();
  check(
    "the dialog STATES it is shown once",
    /shown once/i.test(dialogText) && /cannot be shown again|never exist|only time/i.test(dialogText),
  );
  const secret = await page.getByTestId("agent-secret-value").inputValue();
  check("secret has the rosprt shape", secret.startsWith("rosprt."), secret.slice(0, 12) + "…");
  await shot(page, "03-agent-secret-once");
  await page.getByTestId("agent-secret-ack").check();
  await page.getByTestId("agent-secret-done").click();
  await page.waitForTimeout(1200);
  writeFileSync(`${SCRATCH}/s1-06-agent-secret.txt`, secret);

  log("\n=== 4. Start the REAL print agent with that credential ===");
  const agent = spawn(
    "node",
    ["dist/main.js"],
    {
      cwd: resolve(process.cwd(), "../print-agent"),
      env: {
        ...process.env,
        PRINT_AGENT_CONFIG: "/nonexistent-so-the-registry-must-come-from-the-server.json",
        PRINT_AGENT_CLOUD_URL: "http://localhost:8080",
        PRINT_AGENT_CREDENTIAL: secret,
        PRINT_AGENT_JOURNAL: `${SCRATCH}/s1-06-agent-queue.jsonl`,
        PRINT_AGENT_ORIGINS: "http://localhost:3000",
        PRINT_AGENT_POLL_MS: "2000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const agentLog = [];
  agent.stdout.on("data", (b) => {
    const s = b.toString();
    agentLog.push(s);
    process.stdout.write("    agent> " + s);
  });
  agent.stderr.on("data", (b) => {
    agentLog.push(b.toString());
    process.stdout.write("    agent! " + b.toString());
  });
  await page.waitForTimeout(6000);

  log("\n=== 5. The agent shows as Connected on the page ===");
  // The panel re-reads on its own timer; give it up to 40s and reload once in the middle, because
  // a first poll that lands a moment after the render is a timing artefact, not a defect.
  let mine = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    const liveness = await page.getByTestId("print-agent-row").evaluateAll((els) =>
      els.map((e) => ({
        label: e.querySelector("p")?.textContent ?? "",
        state: e.getAttribute("data-agent-liveness"),
      })),
    );
    mine = liveness.find((r) => r.label.includes("S1-06 verification agent")) ?? null;
    if (mine?.state === "CONNECTED") break;
  }
  check("the enrolled agent is CONNECTED", mine?.state === "CONNECTED", JSON.stringify(mine));
  await shot(page, "04-agent-connected");

  log("\n=== 6. Add a RECEIPT and a KITCHEN printer, save, reload, confirm persisted ===");
  // Remove whatever was there so the assertion is about what THIS run configured.
  let removeButtons = page.getByRole("button", { name: "Remove" });
  for (let n = await removeButtons.count(); n > 0; n = await removeButtons.count()) {
    await removeButtons.first().click();
    await page.waitForTimeout(200);
  }
  // The station codes this branch actually uses, read off the screen's own suggestion list — the
  // list a real manager reads before deciding how many kitchen printers to bind. DEFAULT is added
  // because the DONE-MEANS names it; UNASSIGNED because an unrouted menu item's ticket carries it.
  const suggested = await page
    .locator("#kitchen-station-codes option")
    .evaluateAll((els) => els.map((e) => e.getAttribute("value")).filter(Boolean));
  const stationCodes = [...new Set(["DEFAULT", "UNASSIGNED", ...suggested])];
  log("   station codes offered by the screen:", stationCodes.join(", "));

  await page.getByTestId("add-receipt-printer").click();
  await page.waitForTimeout(300);
  for (let i = 0; i < stationCodes.length; i += 1) {
    await page.getByTestId("add-kitchen-printer").click();
    await page.waitForTimeout(250);
  }

  const printerRows = page.getByTestId("printer-row");
  check(
    "one receipt printer and one kitchen printer per station",
    (await printerRows.count()) === stationCodes.length + 1,
    `${await printerRows.count()} rows for ${stationCodes.length} stations`,
  );

  const receiptRow = printerRows.nth(0);
  await receiptRow.locator('input[id^="name-"]').fill("front-counter-receipt");
  await receiptRow.locator('input[id^="host-"]').fill("127.0.0.1");
  await receiptRow.locator('input[id^="port-"]').fill("9100");

  for (let i = 0; i < stationCodes.length; i += 1) {
    const row = printerRows.nth(i + 1);
    await row.locator('input[id^="name-"]').fill(`kitchen-${stationCodes[i].toLowerCase()}`);
    await row.locator('input[id^="station-"]').fill(stationCodes[i]);
    await row.locator('input[id^="host-"]').fill("127.0.0.1");
    await row.locator('input[id^="port-"]').fill("9101");
  }
  await shot(page, "05-printers-filled");

  await page.getByTestId("save-printers").click();
  await page.waitForTimeout(3000);
  await shot(page, "06-printers-saved");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  const persisted = await page.getByTestId("printer-row").evaluateAll((els) =>
    els.map((e) => ({
      role: e.getAttribute("data-printer-role"),
      name: e.querySelector('input[id^="name-"]')?.value,
      station: e.querySelector('input[id^="station-"]')?.value ?? null,
      host: e.querySelector('input[id^="host-"]')?.value ?? null,
      port: e.querySelector('input[id^="port-"]')?.value ?? null,
    })),
  );
  log("   persisted:", JSON.stringify(persisted));
  check(
    "RECEIPT printer survived the reload",
    persisted.some((p) => p.role === "RECEIPT" && p.name === "front-counter-receipt" && p.port === "9100"),
  );
  check(
    "KITCHEN printer bound to station DEFAULT survived the reload",
    persisted.some((p) => p.role === "KITCHEN" && p.station === "DEFAULT" && p.port === "9101"),
  );
  check(
    "every station the screen offered now has a kitchen printer",
    stationCodes.every((code) => persisted.some((p) => p.role === "KITCHEN" && p.station === code)),
    persisted.filter((p) => p.role === "KITCHEN").map((p) => p.station).join(","),
  );
  await shot(page, "07-printers-persisted");

  log("\n=== 7. Calibration / test print produces captured output ===");
  const before9100 = existsSync(`${SCRATCH}/receipt-printer.bin`)
    ? readFileSync(`${SCRATCH}/receipt-printer.bin`).length
    : 0;
  // Wait for the agent to have pulled the new registry (its poll is 2s here).
  await page.waitForTimeout(5000);
  await page.getByTestId("test-print-RECEIPT").first().click();
  await page.waitForTimeout(4000);
  await shot(page, "08-test-print");
  const after9100 = readFileSync(`${SCRATCH}/receipt-printer.bin`).length;
  const testBytes = readFileSync(`${SCRATCH}/receipt-printer.bin`).toString("latin1");
  check(
    "the calibration page reached the receipt printer",
    after9100 > before9100 && testBytes.includes("PRINT AGENT TEST PAGE"),
    `${before9100} -> ${after9100} bytes`,
  );
  check(
    "it carries the column ruler that makes the column count measurable",
    /\.{9}1\.{9}2/.test(testBytes),
  );
  check("browser made agent calls for the test print only", agentCalls.length > 0, `${agentCalls.length}`);

  log("\n=== 8. Cashier rings and settles: the bill prints via the agent, no dialog ===");
  const cashCtx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const cash = await cashCtx.newPage();
  const cashPrintCalls = [];
  await instrumentPrint(cash, cashPrintCalls);
  check("cashier login", await login(cash, CASHIER));

  const receiptBefore = readFileSync(`${SCRATCH}/receipt-printer.bin`).length;
  const kitchenBefore = existsSync(`${SCRATCH}/kitchen-printer.bin`)
    ? readFileSync(`${SCRATCH}/kitchen-printer.bin`).length
    : 0;

  await cash.goto(`${BASE}/app/pos`, { waitUntil: "domcontentloaded" });
  await cash.waitForTimeout(5000);
  await shot(cash, "09-till");

  // Ring one item. `menu-item-first` is the till's own testid for the first tile.
  const tiles = cash.locator('[data-testid="menu-grid"] > div > button[aria-pressed]');
  const tileCount = await tiles.count();
  log("   menu tiles:", tileCount);
  if (tileCount === 0) {
    check("the till rendered a menu grid", false, "no tiles — cannot ring an order");
  } else {
    await tiles.first().click();
  }
  await cash.waitForTimeout(2000);
  await shot(cash, "10-cart");

  // Snapshot the kitchen capture IMMEDIATELY before the fire, so a backlog drained earlier in the
  // run cannot be mistaken for this order's ticket.
  const kitchenBeforeFire = existsSync(`${SCRATCH}/kitchen-printer.bin`)
    ? readFileSync(`${SCRATCH}/kitchen-printer.bin`).length
    : 0;

  // Fire it.
  const send = cash.getByTestId("send-to-kitchen-button");
  const sendEnabled = (await send.count()) > 0 && (await send.first().isEnabled());
  check("Send to Kitchen became enabled after ringing an item", sendEnabled);
  if (sendEnabled) {
    await send.first().click();
    // Fired means the order left DRAFT, which is exactly when the reprint control appears.
    await cash.getByTestId("reprint-kot-button").first().waitFor({ timeout: 30000 }).catch(() => {});
  }
  await shot(cash, "11-fired");
  const kitchenAfterFire = await waitForGrowth(`${SCRATCH}/kitchen-printer.bin`, kitchenBeforeFire);
  check(
    "firing the order printed a KOT at the kitchen printer",
    kitchenAfterFire > kitchenBefore,
    `${kitchenBeforeFire} -> ${kitchenAfterFire} bytes`,
  );

  // Reprint kitchen ticket control.
  const reprint = cash.getByTestId("reprint-kot-button");
  const hasReprint = (await reprint.count()) > 0;
  check("a Reprint kitchen ticket control exists", hasReprint);
  if (hasReprint) {
    const beforeReprint = readFileSync(`${SCRATCH}/kitchen-printer.bin`).length;
    await reprint.first().click();
    const afterReprint = await waitForGrowth(`${SCRATCH}/kitchen-printer.bin`, beforeReprint);
    check(
      "Reprint kitchen ticket actually produced a second ticket",
      afterReprint > beforeReprint,
      `${beforeReprint} -> ${afterReprint} bytes`,
    );
    await shot(cash, "12-kot-reprinted");
  }

  // Settle it.
  const charge = cash.getByTestId("charge-now-button");
  if (await charge.count()) {
    await charge.first().click();
    await cash.waitForTimeout(4000);
    await shot(cash, "13-charge");
    const full = cash.getByRole("button", { name: /full amount/i });
    if (await full.count()) await full.first().click();
    await cash.waitForTimeout(600);
    const take = cash.getByRole("button", { name: /take payment|record payment|pay/i });
    if (await take.count()) await take.first().click();
    await cash.waitForTimeout(6000);
    await shot(cash, "14-paid");

    // The order is PAID but still open; pos-service dispatches the customer receipt on CLOSE, not
    // on tender (OrderServiceImpl:1000). "Mark served & close order" is how a cashier completes a
    // settlement in this product, so that is what the journey drives.
    const close = cash.getByRole("button", { name: /mark served & close order/i });
    if (await close.count()) {
      await close.first().click();
      await cash.waitForTimeout(9000);
    }
    await shot(cash, "15-closed");
  }

  const receiptAfter = await waitForGrowth(`${SCRATCH}/receipt-printer.bin`, receiptBefore);
  check(
    "settling printed the bill on the receipt printer",
    receiptAfter > receiptBefore,
    `${receiptBefore} -> ${receiptAfter} bytes`,
  );
  check("NO browser print dialog was opened during the cashier journey", cashPrintCalls.length === 0,
    JSON.stringify(cashPrintCalls));

  const receiptText = readFileSync(`${SCRATCH}/receipt-printer.bin`).toString("latin1");
  check(
    'the printed bill no longer says "No printer configured for this branch"',
    !receiptText.includes("No printer configured"),
  );

  writeFileSync(`${OUT}/agent-stdout.log`, agentLog.join(""));
  writeFileSync(`${OUT}/receipt-printer.txt`, receiptText);
  writeFileSync(
    `${OUT}/kitchen-printer.txt`,
    readFileSync(`${SCRATCH}/kitchen-printer.bin`).toString("latin1"),
  );

  agent.kill("SIGTERM");
  await browser.close();
  log(`\n=== ${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("HARNESS ERROR", e);
  process.exit(2);
});
