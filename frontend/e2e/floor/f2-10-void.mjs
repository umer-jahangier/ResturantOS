/*
 * F2 audit, part 2 — void a check with a long reason and read the Voided row back.
 *
 * Split out of f2-09 because that run went to a BLANK page immediately after Confirm Void, and a
 * blank page is exactly the thing this project keeps mistaking for something else. Everything here
 * is instrumented: console errors, pageerror, the void request/response, and the DOM before and
 * after.
 */
import {
  PEOPLE,
  newBrowser,
  newPage,
  login,
  go,
  shot,
  openOrderManagement,
  readOrderTable,
  apiGet,
  tokenOf,
  log,
} from "./f2-lib.mjs";
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve(process.cwd(), "../.planning/audits/floor/F2");
const prior = JSON.parse(readFileSync(`${OUT}/_audit.json`, "utf8"));
const TARGET = process.env.TARGET ?? prior.rung.dineInNoTable;
const LONG_REASON = prior.longReason;

const report = { target: TARGET, longReason: LONG_REASON, verdicts: [] };
const record = (name, pass, detail) => {
  report.verdicts.push({ name, pass, detail });
  log(`  ${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
};

const browser = await newBrowser();
const page = await newPage(browser);
page.__pageErrors = [];
page.on("pageerror", (e) => page.__pageErrors.push(String(e).slice(0, 400)));

try {
  await login(page, PEOPLE.manager);

  // Where is the check now?
  const token = await tokenOf(page);
  await go(page, "/app/pos", { waitMs: 6000, allowTrouble: true });
  const listReq = page.__requests.find((r) => r.u.includes("/api/v1/pos/orders?"));
  const branchId = new URL(listReq.u).searchParams.get("branchId");
  const before = await apiGet(page, `/api/v1/pos/orders?branchId=${branchId}&size=50`, token);
  const beforeRow = (before.body?.data ?? []).find((r) => r.orderNo === TARGET);
  report.serverBefore = beforeRow
    ? { orderNo: beforeRow.orderNo, settlementStatus: beforeRow.settlementStatus, type: beforeRow.type }
    : "(not in the active list)";
  log("  server before:", JSON.stringify(report.serverBefore));

  const alreadyVoided = !beforeRow;
  if (!alreadyVoided) {
    await openOrderManagement(page);
    await page.waitForTimeout(2500);
    await page.locator(`button[aria-label^="Open order ${TARGET}"]`).first().click();
    await page.waitForTimeout(3000);
    await shot(page, "b1-drawer");
    const voidTrigger = page.locator('button[aria-label*="Void order" i]');
    log("  void trigger count:", await voidTrigger.count());
    await voidTrigger.first().click();
    await page.waitForTimeout(1500);
    await page.locator("textarea, input[placeholder*='reason' i]").first().fill(LONG_REASON);
    await shot(page, "b2-void-panel");

    const [resp] = await Promise.all([
      page
        .waitForResponse((r) => /\/void$/.test(new URL(r.url()).pathname), { timeout: 20000 })
        .catch(() => null),
      page.locator('button:has-text("Confirm Void")').first().click(),
    ]);
    report.voidResponse = resp
      ? { status: resp.status(), body: await resp.text().catch(() => null) }
      : "(no /void request observed)";
    log("  void response:", JSON.stringify(report.voidResponse).slice(0, 400));
    await page.waitForTimeout(4000);
    await shot(page, "b3-after-confirm");
    report.pageErrors = page.__pageErrors.slice(0, 6);
    report.consoleErrors = page.__console.slice(0, 8);
    report.bodyTextAfterConfirm = (
      await page.evaluate(() => (document.body.innerText || "").slice(0, 600))
    ).replace(/\n+/g, " | ");
    log("  body after confirm:", report.bodyTextAfterConfirm.slice(0, 300));
    log("  pageErrors:", JSON.stringify(report.pageErrors));
    log("  consoleErrors:", JSON.stringify(report.consoleErrors));
  }

  // Whatever the screen did, ask the SERVER whether the void landed with the whole reason.
  const t2 = await tokenOf(page);
  const voidedList = await apiGet(
    page,
    `/api/v1/pos/orders?branchId=${branchId}&status=VOIDED&size=50`,
    t2,
  );
  const vrow = (voidedList.body?.data ?? []).find((r) => r.orderNo === TARGET);
  report.serverVoidedRow = vrow
    ? {
        orderNo: vrow.orderNo,
        type: vrow.type,
        settlementStatus: vrow.settlementStatus,
        cashierName: vrow.cashierName,
        cashierId: vrow.cashierId,
        settlement: vrow.settlement,
      }
    : null;
  log("\n  server voided row:", JSON.stringify(report.serverVoidedRow, null, 2));
  record(
    "the void landed, with the whole reason intact",
    !!vrow && vrow.settlement?.reason === LONG_REASON,
    `${LONG_REASON.length} chars asked, ${vrow?.settlement?.reason?.length ?? 0} chars stored`,
  );

  // ── Now read the Voided chip as a user ─────────────────────────────────────────────────
  await go(page, "/app/pos", { waitMs: 6000, allowTrouble: true });
  await openOrderManagement(page);
  await page.waitForTimeout(2500);
  await page.locator('[data-testid="status-filter-VOIDED"]').click();
  await page.waitForTimeout(4000);
  await shot(page, "b4-voided-list");

  const voided = await readOrderTable(page);
  const vIdx = (re) => voided.headers.findIndex((h) => re.test(h));
  const cOrder = vIdx(/Order/i);
  const cCash = vIdx(/Server\/Cashier/i);
  const cSettle = vIdx(/Voided/i);
  report.voidedHeaders = voided.headers;
  const row = voided.rows.find((r) => (r.cells[cOrder]?.text ?? "").includes(TARGET));
  report.voidedRow = row
    ? {
        order: row.cells[cOrder].text.replace(/\n/g, " | "),
        cashier: row.cells[cCash].text.trim(),
        settlement: row.cells[cSettle].text.replace(/\n/g, " | "),
        actionButtons: row.cells[row.cells.length - 1].buttons.map((b) => b.text.trim()),
      }
    : null;
  log("\n  voided row on screen:", JSON.stringify(report.voidedRow, null, 2));

  record(
    "the voided row still reads Dine-in (not Takeaway)",
    !!row && /Dine-in/.test(report.voidedRow.order) && !/Takeaway/.test(report.voidedRow.order),
    `"${report.voidedRow?.order}"`,
  );
  record(
    "the voided row offers neither Cancel nor Continue",
    !!row &&
      !report.voidedRow.actionButtons.some((b) => /^(Cancel|Continue)$/i.test(b)) &&
      report.voidedRow.actionButtons.some((b) => /^Open$/i.test(b)),
    JSON.stringify(report.voidedRow?.actionButtons),
  );
  const byline = /by ([^·]+)·/.exec(report.voidedRow?.settlement ?? "")?.[1]?.trim();
  record(
    "Server/Cashier prints the same string the Voided column prints for that actor",
    !!byline && byline === report.voidedRow?.cashier,
    `Server/Cashier="${report.voidedRow?.cashier}"  Voided byline="${byline}"`,
  );

  // The reason: measured for clipping, then opened.
  const clip = await page.evaluate((no) => {
    const tr = Array.from(document.querySelectorAll("tbody tr")).find((r) =>
      (r.innerText || "").includes(no),
    );
    const btn = tr?.querySelector('button[data-testid^="settlement-reason-"]');
    if (!btn) return { noButton: true };
    return {
      text: btn.textContent.trim(),
      scrollWidth: btn.scrollWidth,
      clientWidth: btn.clientWidth,
      whiteSpace: getComputedStyle(btn).whiteSpace,
      title: btn.getAttribute("title"),
      ariaLabel: btn.getAttribute("aria-label"),
      testid: btn.getAttribute("data-testid"),
    };
  }, TARGET);
  report.reasonControl = clip;
  log("\n  reason control:", JSON.stringify(clip, null, 2));

  await page.locator(`button[data-testid="settlement-reason-${report.serverVoidedRow?.orderNo ? "" : ""}"]`).count();
  await page
    .locator(`tr:has-text("${TARGET}") button[data-testid^="settlement-reason-"]`)
    .first()
    .click();
  await page.waitForTimeout(1500);
  const popover = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return null;
    const p = d.querySelector("p");
    return {
      text: d.innerText.trim(),
      whiteSpace: p ? getComputedStyle(p).whiteSpace : null,
      clipped: p ? p.scrollHeight > p.clientHeight + 1 : null,
    };
  });
  report.reasonPopover = popover;
  await shot(page, "b5-reason-open");
  record(
    "the long void reason is readable in full by a press, wrapped, not clipped",
    !!popover && popover.text.includes(LONG_REASON) && popover.clipped === false,
    `popover carries the ${LONG_REASON.length}-char reason=${popover?.text?.includes(LONG_REASON)}, clipped=${popover?.clipped}, whiteSpace=${popover?.whiteSpace}`,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);

  // ── responsive + dark ───────────────────────────────────────────────────────────────────
  for (const [w, h, tag] of [
    [390, 844, "390"],
    [768, 1024, "768"],
    [1440, 950, "1440"],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(1500);
    report[`bodyScrollsHorizontally@${tag}`] = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    await shot(page, `b6-voided-${tag}`);
  }
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(1500);
  await shot(page, "b7-voided-1440-dark");
  await page
    .locator(`tr:has-text("${TARGET}") button[data-testid^="settlement-reason-"]`)
    .first()
    .click();
  await page.waitForTimeout(1200);
  await shot(page, "b8-reason-dark");
  await page.emulateMedia({ colorScheme: "light" });

  report.pageErrorsFinal = page.__pageErrors.slice(0, 6);
  report.consoleErrorsFinal = page.__console.slice(0, 8);
} catch (e) {
  log("  !! ", e.message);
  report.error = e.message;
  await shot(page, "b99-failure");
} finally {
  writeFileSync(`${OUT}/_audit-void.json`, JSON.stringify(report, null, 2));
  log("\n──────── SCORE ────────");
  for (const v of report.verdicts) log(`  ${v.pass ? "PASS" : "FAIL"}  ${v.name}`);
  log(`  ${report.verdicts.filter((v) => v.pass).length}/${report.verdicts.length} passed`);
  await page.context().close();
  await browser.close();
}
