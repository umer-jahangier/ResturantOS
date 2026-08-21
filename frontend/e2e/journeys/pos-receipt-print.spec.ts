import { expect, test } from "../fixtures/auth.fixture";
import { persona, personaBranchId } from "../fixtures/personas";
import { DEFECTS, tolerate } from "../fixtures/known-defects";

/**
 * JOURNEY — a CASHIER settles an order and gets a correctly totalled printed bill in a real
 * browser, with no thermal printer attached.
 *
 * This is definition-of-done item 1 of phase 26, and it is the one item that cannot be closed by
 * any unit test: every other assertion in plan 26-05 checks the DOM of a component rendered from a
 * fixture. This one drives a real Chromium against the real gateway, the real pos-service and the
 * real database, and then asserts four things a jsdom test structurally cannot reach.
 *
 * WHAT MAKES IT A REAL ASSERTION RATHER THAN A SCREENSHOT
 *   · the `@page` rule is read from `document.styleSheets` at runtime, NOT from the source file —
 *     so a stylesheet that failed to load, or was tree-shaken out of the bundle, fails here;
 *   · the shell-is-hidden check runs with print media EMULATED, which is the only way to observe
 *     what the `@media print` block actually does;
 *   · every currency token on the page is compared against the SERVER's own response for the same
 *     order, captured off the wire — so a browser-side rendering difference cannot hide a wrong
 *     total, and neither can a hard-coded expectation drifting from the seed data;
 *   · `window.print` is stubbed BEFORE navigation, so the count is of real invocations rather than
 *     of a render that happened to look right.
 *
 * TENANT: zaitoon, matching pos-waiter-to-kitchen, so a seed problem shows up in both rather than
 * in one confusing place.
 */

const CASHIER = persona("terrace", "cashier");

/** Matches the rendered amounts `ReceiptMoneyFormatter` produces: `Rs 1,234.56`, `-Rs 100.00`. */
const CURRENCY_TOKEN = /-?Rs\s[\d,]+\.\d{2}/g;

interface IssuedDocumentResponse {
  data: {
    printJobId: string;
    targetPrinterId: string;
    document: Record<string, unknown>;
  };
}

/**
 * The text of a rendered PDF, via poppler's `pdftotext`.
 *
 * <p>An external dependency in a test, deliberately. Chrome outlines the receipt's monospace font
 * into glyph paths, so the literal strings are NOT recoverable from the content stream with
 * `zlib` alone — that was tried. And every in-browser proxy for "what got printed" was tried too
 * and each one PASSED against the known-broken stylesheet: reading the `@page` rule's text,
 * measuring the PDF page width, and narrowing the viewport to check containment (which fails to
 * reproduce the bug because a 302px viewport collapses the sidebar that causes it).
 *
 * <p>If `pdftotext` is missing this FAILS rather than skipping. A print assertion that quietly
 * disables itself on a machine without poppler is worse than none: it is the shape of test that
 * lets a bill ship with no amounts on it.
 */
async function extractPdfText(pdf: Buffer): Promise<string> {
  const { execFileSync } = await import("node:child_process");
  const { writeFileSync, mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  const dir = mkdtempSync(join(tmpdir(), "receipt-print-"));
  const file = join(dir, "receipt.pdf");
  writeFileSync(file, pdf);
  try {
    return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
  } catch (err) {
    throw new Error(
      "could not run `pdftotext` to read the printed output. Install poppler " +
        "(`brew install poppler` / `apt-get install poppler-utils`). This assertion is NOT " +
        `optional — it is the only one that can see what actually reached the paper. ${String(err)}`,
    );
  }
}

/** Every `formatted` string anywhere in the server's document. */
function formattedAmounts(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    node.forEach((child) => formattedAmounts(child, out));
  } else if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (typeof record.formatted === "string" && typeof record.paisa === "number") {
      out.add(record.formatted);
    }
    Object.values(record).forEach((child) => formattedAmounts(child, out));
  }
  return out;
}

test.describe.configure({ mode: "serial" });

test.describe("a cashier settles an order and prints the bill", () => {
  test("the receipt route, in a real browser, with no printer attached", async ({
    as,
    token,
    gateway,
    obs,
  }) => {
    test.setTimeout(180_000);

    // E2E-D4: the POS live-orders socket is refused by the gateway for every user and reconnects
    // in a loop, one console error per attempt. Pinned in known-defects.spec; tolerated here so
    // this journey reports on PRINTING.
    tolerate(obs, DEFECTS.POS_ORDERS_WEBSOCKET_REJECTED_AT_GATEWAY);

    const branchId = personaBranchId(CASHIER.id);
    const auth = { Authorization: `Bearer ${await token(CASHIER)}` };

    // ── 1. Settle an order through the REAL API ──────────────────────────────────────
    //
    // Deliberately not through the menu grid. The subject of this test is the receipt page, and
    // every call below goes through the same gateway, the same permissions and the same service
    // the UI would hit — it is the real path, just driven directly, so a flake in the ordering
    // grid cannot be mistaken for a printing defect. The waiter-to-kitchen journey already
    // exercises the grid.

    const menuResponse = await gateway.get(`/api/v1/pos/menu/items?branchId=${branchId}`, {
      headers: auth,
    });
    expect(
      menuResponse.status(),
      "the cashier could not read the menu — check FEATURE_POS for zaitoon and the seed",
    ).toBe(200);
    const menuItems = ((await menuResponse.json()) as { data: { id: string; active: boolean }[] })
      .data;
    const item = menuItems.find((m) => m.active);
    expect(
      item,
      "zaitoon has no ACTIVE menu item, so nothing can be ordered. Run the seed.",
    ).toBeTruthy();

    // A cash tender requires the paying cashier to hold an OPEN till (13-16 / D-30). Already-open
    // is the normal state on a stack that has been used, so a refusal here is tolerated and only
    // the payment below is allowed to be decisive.
    await gateway.post("/api/v1/pos/tills", {
      headers: auth,
      data: { branchId, openingFloatPaisa: 0 },
    });

    const orderResponse = await gateway.post("/api/v1/pos/orders", {
      headers: auth,
      data: { branchId, clientOrderId: crypto.randomUUID(), coverCount: 1 },
    });
    expect(orderResponse.status(), await orderResponse.text()).toBe(201);
    const orderId = ((await orderResponse.json()) as { data: { id: string } }).data.id;

    const addResponse = await gateway.post(`/api/v1/pos/orders/${orderId}/items`, {
      headers: auth,
      data: { menuItemId: item!.id, branchId, quantity: 2 },
    });
    expect(addResponse.status(), await addResponse.text()).toBe(200);
    const totalPaisa = ((await addResponse.json()) as { data: { totalPaisa: number } }).data
      .totalPaisa;
    expect(
      totalPaisa,
      "the order totalled zero paisa — the seed item has no price",
    ).toBeGreaterThan(0);

    // Over-tender by a round Rs 500 so the receipt has to print a real change figure.
    const paymentResponse = await gateway.post(`/api/v1/pos/orders/${orderId}/payments`, {
      headers: auth,
      data: { method: "CASH", amountPaisa: totalPaisa, tenderedPaisa: totalPaisa + 50_000 },
    });
    expect(
      paymentResponse.status(),
      "recording a cash payment failed. The most likely cause is that this cashier holds no OPEN " +
        `till — PaymentServiceImpl refuses a cash tender without one. Body: ${await paymentResponse.text()}`,
    ).toBe(200);

    // ── 2. Open the receipt route in a real browser ──────────────────────────────────

    const page = await as(CASHIER);

    // Stub BEFORE navigation, so the count is of real invocations. jsdom cannot do this; a unit
    // test that "asserts printing" is asserting a mock it installed itself.
    await page.addInitScript(() => {
      const w = window as unknown as { __printCalls: number };
      w.__printCalls = 0;
      window.print = () => {
        w.__printCalls += 1;
      };
    });

    // Capture the server's own answer off the wire. This is what the page's amounts are compared
    // against — not a hard-coded string, and not a recomputation.
    const issuePromise = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/pos/orders/${orderId}/print-jobs`) &&
        r.request().method() === "POST",
      { timeout: 60_000 },
    );

    await page.goto(`/app/pos/orders/${orderId}/receipt`, { waitUntil: "domcontentloaded" });

    const issueResponse = await issuePromise;
    expect(
      issueResponse.status(),
      `issuing the print document failed: ${await issueResponse.text()}`,
    ).toBe(201);
    const issued = (await issueResponse.json()) as IssuedDocumentResponse;

    const receipt = page.getByTestId("receipt-root");
    await expect(
      receipt,
      "the bill never rendered. If the page shows an error instead, the issue request failed — " +
        "which QueryBoundary is correctly reporting rather than showing an empty bill.",
    ).toBeVisible({ timeout: 30_000 });

    // ── 3. The `@page` rule, read from the LIVE stylesheet ───────────────────────────
    //
    // From `document.styleSheets`, never from the source file. A stylesheet that failed to load,
    // or that a bundler dropped, produces a page that looks fine on screen and prints as an A4
    // block — and reading the file from disk would report success for exactly that.
    const pageRule = await page.evaluate(() => {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue; // cross-origin sheet; not ours
        }
        for (const rule of Array.from(rules)) {
          if (rule.cssText.startsWith("@page")) return rule.cssText;
        }
      }
      return null;
    });

    expect(
      pageRule,
      "no @page rule is present in any loaded stylesheet. receipt-print.css did not reach the " +
        "browser, so this page would print as a centred block on A4 rather than an 80mm strip.",
    ).not.toBeNull();
    expect(pageRule, `@page rule found but no size descriptor: ${pageRule}`).toContain("80mm");

    // ── 3b. …and the page GEOMETRY that rule actually produces ───────────────────────
    //
    // The text of the rule is not enough, and this assertion exists because the check above
    // PASSED while the bill printed on US Letter. `size: 80mm auto` is invalid CSS — `auto` is a
    // standalone keyword and cannot follow a length — so Chromium dropped the declaration, left
    // `@page { margin: 0px; }` behind, and fell back to the default page size. A rule was present
    // the whole time.
    //
    // `size: 80mm` would also satisfy a "contains 80mm" text check, and would paginate the
    // receipt into 80mm SQUARES. So what is asserted is the MediaBox of a real print, in
    // millimetres.
    let mediaBox: string | null = null;
    try {
      const pdf = await page.pdf({ preferCSSPageSize: true });
      mediaBox =
        Buffer.from(pdf)
          .toString("latin1")
          .match(/MediaBox\s*\[([^\]]+)\]/)?.[1] ?? null;
    } catch (err) {
      throw new Error(
        "could not render a PDF to measure the printed page size. page.pdf() requires HEADLESS " +
          `Chromium — re-run without --headed. Original: ${String(err)}`,
      );
    }

    expect(mediaBox, "the rendered PDF carried no MediaBox").not.toBeNull();
    const [x0, , x1] = mediaBox!.trim().split(/\s+/).map(Number) as [number, number, number];
    const widthMm = ((x1! - x0!) / 72) * 25.4;
    expect(
      widthMm,
      `the printed page is ${widthMm.toFixed(2)}mm wide, not 80mm. The @page size descriptor is ` +
        "not being applied — check it is two lengths (`80mm 297mm`), because `80mm auto` is " +
        "invalid CSS and is dropped silently, leaving the browser default (215.90mm, US Letter).",
    ).toBeGreaterThan(79.5);
    expect(widthMm, `the printed page is ${widthMm.toFixed(2)}mm wide, not 80mm`).toBeLessThan(
      80.5,
    );

    // ── 3c. WHAT IS ACTUALLY ON THE PAPER ────────────────────────────────────────────
    //
    // Everything above this point passed while the printed bill was unusable. The @page width was
    // right, the DOM was right, the screen was right — and the real print output was the app
    // SIDEBAR followed by a clipped receipt:
    //
    //     Zaitoon Kitchen        Orde
    //     OVERVIEW
    //       Dashboard
    //     ORDERS                  Or
    //       POS                   Is
    //
    // Cause: `body * { visibility: hidden }` has specificity (0,0,1) and lost to Tailwind utility
    // classes, so the shell never stopped painting — and with it still on the page the receipt was
    // pushed and cut. Confirmed by simulating the failure (injecting `visibility: visible`) and
    // reading the PDF: "Dashboard" reappears on the customer's bill.
    //
    // This assertion reads the TEXT of a real print because NO in-browser proxy reproduced it.
    // Each of these was tried and each PASSED against the known-broken page: reading the @page
    // rule's text, measuring the PDF page width, narrowing the viewport to check containment, and
    // checking the element's bounding box under `emulateMedia({ media: "print" })`. An assertion
    // that cannot fail on the known-bad input is not an assertion.
    const printedText = await extractPdfText(await page.pdf({ preferCSSPageSize: true }));

    const grandTotal = (issued.data.document.totals as { grandTotal: { formatted: string } } | null)
      ?.grandTotal.formatted;
    expect(
      printedText,
      `the grand total ${grandTotal} is not on the printed page. The bill rendered but did not ` +
        "PRINT — check `.receipt-root` is `position: fixed` under print media, because `absolute` " +
        "anchors it to the shell's content area and pushes every amount off an 80mm page.",
    ).toContain(grandTotal!);

    for (const shellWord of ["OVERVIEW", "Dashboard"]) {
      expect(
        printedText,
        `"${shellWord}" is on the paper. The application shell printed onto the customer's bill — ` +
          "the print-media visibility rules need `!important` to beat utility-class specificity.",
      ).not.toContain(shellWord);
    }

    // ── 4. With print media emulated, the shell is gone and the bill is not ──────────
    await page.emulateMedia({ media: "print" });

    await expect(
      receipt,
      "the receipt is not visible under print media — the @media print block is hiding the very " +
        "thing it exists to keep.",
    ).toBeVisible();

    for (const [what, locator] of [
      ["navigation", page.getByRole("navigation")],
      ["banner", page.getByRole("banner")],
      ["the Print button", page.getByTestId("print-again-button")],
    ] as const) {
      const count = await locator.count();
      for (let i = 0; i < count; i++) {
        await expect(
          locator.nth(i),
          `${what} is still visible under print media. If it reaches the paper, the bill is not a bill.`,
        ).not.toBeVisible();
      }
    }

    await page.emulateMedia({ media: "screen" });

    // ── 5. Every amount on the page is one the SERVER produced ───────────────────────
    const allowed = formattedAmounts(issued.data.document);
    expect(
      allowed.size,
      "the server's document carried no rendered amounts at all — the assembler produced an " +
        "empty bill and something upstream is wrong",
    ).toBeGreaterThan(5);

    const pageText = (await receipt.innerText()) ?? "";
    const tokens = pageText.match(CURRENCY_TOKEN) ?? [];
    expect(tokens.length, "no currency amounts rendered on the bill at all").toBeGreaterThan(4);

    for (const token of tokens) {
      expect(
        Array.from(allowed),
        `the page rendered "${token}", which is NOT an amount the server's document contains. ` +
          "The component computed a number instead of printing the string it was given — this is " +
          "the hundredfold-error shape GA-007 recorded.",
      ).toContain(token);
    }

    // And the grand total specifically, against the order the payment settled.
    const totals = issued.data.document.totals as { grandTotal: { paisa: number } } | null;
    expect(totals?.grandTotal.paisa, "the printed total disagrees with the order").toBe(totalPaisa);

    // ── 6. The print dialog opened exactly once ──────────────────────────────────────
    const printCalls = await page.evaluate(
      () => (window as unknown as { __printCalls: number }).__printCalls,
    );
    expect(
      printCalls,
      "window.print was not invoked exactly once. Zero means the automatic print never fired; " +
        "more than one means the effect guard failed and a cashier gets a dialog they cannot " +
        "escape.",
    ).toBe(1);

    // ── 7. Reload — the second issue is a REPRINT ────────────────────────────────────
    //
    // The frontend half of definition-of-done item 3. The server half (byte-identical bodies) is
    // proven in PrintJobIssuanceIT; what is proven here is that the paper SAYS so.
    const reprintPromise = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/pos/orders/${orderId}/print-jobs`) &&
        r.request().method() === "POST",
      { timeout: 60_000 },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    const reprintResponse = await reprintPromise;
    const reprinted = (await reprintResponse.json()) as IssuedDocumentResponse;

    const issue = reprinted.data.document.issue as {
      sequenceNumber: number;
      reprint: boolean;
      originalIssuedAt: string | null;
    };
    expect(issue.sequenceNumber, "the second issue did not take sequence 2").toBe(2);
    expect(issue.reprint, "the second issue is not flagged as a reprint").toBe(true);
    expect(
      issue.originalIssuedAt,
      "a reprint with no original timestamp is indistinguishable from an original",
    ).toBeTruthy();

    await expect(
      page.getByTestId("reprint-band"),
      "the reprint band is not on the paper. The server marked it a reprint and the bill does " +
        "not say so, which is exactly the distinction definition-of-done item 3 requires.",
    ).toBeVisible({ timeout: 30_000 });
  });
});
