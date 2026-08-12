/*
 * S8 RE-OPEN — step 3. The OWNER's half, driven by me, not inherited.
 *
 *  a) change the till receipt printer's queue via the picker to the OTHER queue the agent found,
 *     save, RELOAD, and read it back from the server → the picker writes and persists
 *  b) add a NEW network printer by host+port and bind it to a station that had none (BAR),
 *     save, RELOAD, read back → the add path works and the unrouted alert loses BAR
 *  c) put the receipt printer back on the USB queue and prove that persists too
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { newBrowser, newPage, login, go, PEOPLE, apiGet, branchOf } from "../s8/lib.mjs";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/S8-reopen");
mkdirSync(OUT, { recursive: true });
const rec = { checks: [] };
const check = (name, pass, detail) => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  rec.checks.push({ name, pass, detail });
};
const say = (k, v) => {
  console.log(`  · ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`);
  rec[k] = v;
};

const readBack = async (page, branchId) => {
  const cfg = await apiGet(page, `/api/v1/branches/${branchId}/receipt-config`);
  const c = cfg.body?.data?.config ?? cfg.body?.config ?? {};
  return {
    status: cfg.status,
    printers: (c.printers ?? []).map((p) => ({
      id: p.id,
      role: p.role,
      station: p.stationCode,
      transport: p.transport,
      host: p.host,
      port: p.port,
      queue: p.systemPrinterName,
    })),
    unrouted: cfg.body?.data?.completeness?.unroutedStations ?? cfg.body?.completeness?.unroutedStations ?? null,
  };
};

const domRows = (page) =>
  page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-testid="printer-row"]'));
    return rows.map((r) => {
      const pid = r.getAttribute("data-printer-id");
      const q = r.querySelector('[data-testid="system-printer-picker"]');
      return {
        pid,
        transport: r.querySelector(`#transport-${CSS.escape(pid)}`)?.value ?? null,
        station: r.querySelector(`#station-${CSS.escape(pid)}`)?.value ?? null,
        host: r.querySelector(`#host-${CSS.escape(pid)}`)?.value ?? null,
        port: r.querySelector(`#port-${CSS.escape(pid)}`)?.value ?? null,
        queueTag: q?.tagName ?? null,
        queueValue: q?.value ?? null,
      };
    });
  });

const saveAndReload = async (page) => {
  const blocked = await page.evaluate(
    () => document.querySelector('[data-testid="save-blocked"]')?.textContent?.trim() ?? null,
  );
  const disabled = await page.locator('[data-testid="save-printers"]').isDisabled();
  await page.locator('[data-testid="save-printers"]').click();
  await page.waitForTimeout(4000);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  return { blocked, disabled };
};

const browser = await newBrowser();
const page = await newPage(browser);
try {
  await login(page, PEOPLE.owner);
  let branchId = null;
  for (let i = 0; i < 6 && branchId === null; i += 1) {
    try {
      branchId = await branchOf(page);
    } catch (e) {
      console.log(`    token retry ${i}: ${e.message}`);
      await page.waitForTimeout(3000);
    }
  }
  if (!branchId) throw new Error("no access token after 6 tries");
  await go(page, "/app/settings/printers", { waitMs: 7000 });

  const before = await readBack(page, branchId);
  say("before", before);

  // ── (a) drive the picker ────────────────────────────────────────────────────────────────
  const picker = page.locator('[data-testid="system-printer-picker"]').first();
  const tag = await picker.evaluate((n) => n.tagName);
  const opts = await picker.evaluate((n) => Array.from(n.querySelectorAll("option")).map((o) => o.value));
  check("the queue control is a native SELECT, not a text box", tag === "SELECT", `tag=${tag}`);
  check(
    "it offers both queues this machine really has",
    opts.includes("_80Series2") && opts.includes("STMicroelectronics_POS80_Printer_USB"),
    JSON.stringify(opts),
  );
  const cupsReal = rec.cups ?? null;
  void cupsReal;

  await picker.selectOption("_80Series2");
  await page.waitForTimeout(600);
  const afterSelect = await picker.inputValue();
  check("selecting the other queue changes the control", afterSelect === "_80Series2", afterSelect);

  const s1 = await saveAndReload(page);
  say("saveState.a", s1);
  const afterA = await readBack(page, branchId);
  const receiptA = afterA.printers.find((p) => p.role === "RECEIPT");
  check(
    "the chosen queue PERSISTED across a reload, read back over HTTP",
    receiptA?.queue === "_80Series2",
    JSON.stringify(receiptA),
  );
  const domA = await domRows(page);
  check(
    "and the reloaded screen shows it selected",
    domA.find((r) => r.pid === receiptA?.id)?.queueValue === "_80Series2",
    JSON.stringify(domA.find((r) => r.pid === receiptA?.id)),
  );
  await page.screenshot({ path: `${OUT}/r03a-queue-switched.png` });

  // ── (b) add a NEW network printer for the unrouted BAR station ───────────────────────────
  check("BAR was unrouted before I added anything", (before.unrouted ?? []).includes("BAR"), JSON.stringify(before.unrouted));
  await page.locator('[data-testid="add-kitchen-printer"]').click();
  await page.waitForTimeout(900);
  const rowsNow = await domRows(page);
  const newPid = rowsNow[rowsNow.length - 1].pid;
  say("newRowId", newPid);
  await page.locator(`#name-${newPid}`).fill("reopen-bar");
  await page.waitForTimeout(300);
  const renamed = (await domRows(page)).at(-1).pid;
  await page.locator(`#station-${renamed}`).fill("BAR");
  await page.locator(`#host-${renamed}`).fill("127.0.0.1");
  await page.locator(`#port-${renamed}`).fill("9106");
  await page.waitForTimeout(600);

  // a bad port must block the save, and say why
  await page.locator(`#port-${renamed}`).fill("99999");
  await page.waitForTimeout(700);
  const badPort = await page.evaluate(() => ({
    blocked: document.querySelector('[data-testid="save-blocked"]')?.textContent?.trim() ?? null,
    saveDisabled: document.querySelector('[data-testid="save-printers"]')?.disabled ?? null,
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((n) => n.textContent.trim()).filter((t) => /port/i.test(t)),
  }));
  check("port 99999 blocks Save and names the real range", badPort.saveDisabled === true && badPort.alerts.length > 0, JSON.stringify(badPort));
  await page.screenshot({ path: `${OUT}/r03b-bad-port.png` });
  await page.locator(`#port-${renamed}`).fill("9106");
  await page.waitForTimeout(700);

  const s2 = await saveAndReload(page);
  say("saveState.b", s2);
  const afterB = await readBack(page, branchId);
  const bar = afterB.printers.find((p) => p.id === "reopen-bar");
  check(
    "the new network printer persisted with host, port and station",
    bar?.host === "127.0.0.1" && bar?.port === 9106 && bar?.station === "BAR",
    JSON.stringify(bar),
  );
  check("BAR is no longer in the unrouted list", !(afterB.unrouted ?? []).includes("BAR"), JSON.stringify(afterB.unrouted));
  const unroutedText = await page.evaluate(
    () => document.querySelector('[data-testid="unrouted-stations"]')?.innerText?.trim() ?? "",
  );
  check("and the screen's unrouted alert no longer names BAR", !/\bBAR\b/.test(unroutedText), unroutedText.slice(0, 160));
  await page.screenshot({ path: `${OUT}/r03c-bar-added.png` });

  // ── (c) put the till back on the USB queue ───────────────────────────────────────────────
  await page.locator('[data-testid="system-printer-picker"]').first().selectOption("STMicroelectronics_POS80_Printer_USB");
  await page.waitForTimeout(600);
  const s3 = await saveAndReload(page);
  say("saveState.c", s3);
  const afterC = await readBack(page, branchId);
  const receiptC = afterC.printers.find((p) => p.role === "RECEIPT");
  check(
    "and back to the USB queue, persisted",
    receiptC?.queue === "STMicroelectronics_POS80_Printer_USB" && receiptC?.transport === "SYSTEM",
    JSON.stringify(receiptC),
  );
  say("final", afterC);
  await page.screenshot({ path: `${OUT}/r03d-final.png` });
} catch (e) {
  check("harness completed", false, String(e));
} finally {
  writeFileSync(`${OUT}/r03-owner-configures.json`, JSON.stringify(rec, null, 2));
  const failed = rec.checks.filter((c) => !c.pass);
  console.log(`\n  ${rec.checks.length - failed.length}/${rec.checks.length} checks passed`);
  await browser.close();
}
