import { describe, expect, it } from "vitest";

import { PurchasingRepository } from "@/lib/repositories/purchasing.repository";
import {
  createApPaymentInputSchema,
  overrideMatchInputSchema,
} from "@/lib/api-client/schemas/purchasing.schema";

const PO_ID = "d0000001-0000-4000-8000-000000000001";
const LINE_ID = "e0000001-0000-4000-8000-000000000001";
const LINE_ID_2 = "e0000001-0000-4000-8000-000000000002";

/**
 * MSW round-trip through the REAL repository/hook code (mirrors purchasing-close.test.ts /
 * purchasing-po-journey.test.ts), against the real backend contract read from source (10-13
 * gap closure). Both PO lines are fully received first so booking an exact-match invoice
 * produces MATCHED — the mock's matchLineStatus mirrors ThreeWayMatchService's real 2%/5%/10%
 * tolerance, so this is not a lie the mock teaches the test.
 */
describe("PurchasingRepository invoice + payment journey (10-13 gap closure, MSW round-trip)", () => {
  it("fully receives the fixture PO so a subsequent exact-match invoice books MATCHED", async () => {
    await PurchasingRepository.mockReceive(PO_ID, [
      { poLineId: LINE_ID, receivedQty: "100" },
      { poLineId: LINE_ID_2, receivedQty: "50" },
    ]);
    const po = await PurchasingRepository.getPurchaseOrder(PO_ID);
    expect(po.status).toBe("FULLY_RECEIVED");
  });

  it("books an exactly-matching invoice -> MATCHED", async () => {
    const invoice = await PurchasingRepository.createInvoice({
      purchaseOrderId: PO_ID,
      invoiceNo: "INV-MATCH-1",
      invoiceDate: "2026-07-13",
      lines: [
        { poLineId: LINE_ID, qty: "100", unitPricePaisa: 1000 },
        { poLineId: LINE_ID_2, qty: "50", unitPricePaisa: 1000 },
      ],
    });
    expect(invoice.status).toBe("MATCHED");
    expect(invoice.lines.every((l) => l.matchStatus === "OK")).toBe(true);
  });

  it("books a >2% price-drift invoice -> MISMATCHED with a PRICE_OVER line, then overrides it", async () => {
    const invoice = await PurchasingRepository.createInvoice({
      purchaseOrderId: PO_ID,
      invoiceNo: "INV-MISMATCH-1",
      invoiceDate: "2026-07-13",
      lines: [
        // 1051/1000 = 5.1% over the PO's unit price -- exceeds the real 2% priceOverPct tolerance.
        { poLineId: LINE_ID, qty: "100", unitPricePaisa: 1051 },
        { poLineId: LINE_ID_2, qty: "50", unitPricePaisa: 1000 },
      ],
    });
    expect(invoice.status).toBe("MISMATCHED");
    const priceLine = invoice.lines.find((l) => l.poLineId === LINE_ID);
    expect(priceLine?.matchStatus).toBe("PRICE_OVER");

    // Overriding with a 3-char justification is rejected client-side by the Zod schema -- the
    // justification requirement is a contract, not a placeholder.
    expect(() => overrideMatchInputSchema.parse({ justification: "no" })).toThrow();

    const overridden = await PurchasingRepository.overrideMatch(
      invoice.id,
      "Vendor price increase approved by manager verbally",
    );
    expect(overridden.status).toBe("APPROVED_FOR_PAYMENT");
    expect(overridden.matchOverrideReason).toBe("Vendor price increase approved by manager verbally");
  });

  it("createApPayment -> PAID, and the request body carries amountPaisa as a paisa integer (not a float rupee value)", async () => {
    const invoice = await PurchasingRepository.createInvoice({
      purchaseOrderId: PO_ID,
      invoiceNo: "INV-PAY-1",
      invoiceDate: "2026-07-13",
      lines: [
        { poLineId: LINE_ID, qty: "100", unitPricePaisa: 1000 },
        { poLineId: LINE_ID_2, qty: "50", unitPricePaisa: 1000 },
      ],
    });
    expect(invoice.status).toBe("MATCHED");

    // The classic money bug this codebase deliberately avoids: the write-payload schema requires
    // amountPaisa to be a whole-paisa INTEGER, not `1500.00` (a float rupee value smuggled into
    // the paisa field) -- `.int()` rejects it before the request is ever sent.
    expect(() => createApPaymentInputSchema.parse({ invoiceId: invoice.id, paymentDate: "2026-07-13", amountPaisa: 1500.5 })).toThrow();
    const parsed = createApPaymentInputSchema.parse({
      invoiceId: invoice.id,
      paymentDate: "2026-07-13",
      amountPaisa: 150_000,
    });
    expect(Number.isInteger(parsed.amountPaisa)).toBe(true);

    const payment = await PurchasingRepository.createApPayment({
      invoiceId: invoice.id,
      paymentDate: "2026-07-13",
      amountPaisa: 150_000,
    });
    expect(payment.allocations[0]?.amountPaisa).toBe(150_000);
    expect(Number.isInteger(payment.allocations[0]?.amountPaisa)).toBe(true);

    const paidInvoice = await PurchasingRepository.getInvoice(invoice.id);
    expect(paidInvoice.status).toBe("PAID");
  });
});
