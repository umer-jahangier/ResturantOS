import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api-client/errors";
import { PurchasingRepository } from "@/lib/repositories/purchasing.repository";

const PO_ID = "d0000001-0000-4000-8000-000000000001";
const LINE_ID = "e0000001-0000-4000-8000-000000000001";

describe("PurchasingRepository.closePurchaseOrder (PUR-02 gap closure, MSW round-trip)", () => {
  it("rejects closing a PO that has not been received (SENT)", async () => {
    await expect(PurchasingRepository.closePurchaseOrder(PO_ID)).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects a short-close with no reason once the PO is PARTIALLY_RECEIVED", async () => {
    await PurchasingRepository.mockReceive(PO_ID, [{ poLineId: LINE_ID, receivedQty: "50" }]);
    const po = await PurchasingRepository.getPurchaseOrder(PO_ID);
    expect(po.status).toBe("PARTIALLY_RECEIVED");

    await expect(PurchasingRepository.closePurchaseOrder(PO_ID)).rejects.toBeInstanceOf(ApiError);
  });

  it("short-closes a PARTIALLY_RECEIVED PO with a reason", async () => {
    const closed = await PurchasingRepository.closePurchaseOrder(PO_ID, "Vendor cannot fulfil remainder");
    expect(closed.status).toBe("CLOSED");
    expect(closed.closeReason).toBe("Vendor cannot fulfil remainder");
    expect(closed.closedAt).not.toBeNull();
  });
});
