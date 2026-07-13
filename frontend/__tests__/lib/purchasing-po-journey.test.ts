import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";

import { server } from "@/mocks/server";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { PurchasingRepository } from "@/lib/repositories/purchasing.repository";
import { useApprovePurchaseOrder } from "@/lib/hooks/purchasing/use-purchasing";

const BRANCH = "b0000001-0000-4000-8000-000000000001";
const VENDOR_ID = "c0000001-0000-4000-8000-000000000001";
const ING_1 = "11111111-1111-4111-8111-111111110001";
const PO_ID = "d0000001-0000-4000-8000-000000000001";
const LINE_ID = "e0000001-0000-4000-8000-000000000001";
const LINE_ID_2 = "e0000001-0000-4000-8000-000000000002";

describe("PurchasingRepository PO journey (10-12 gap closure, MSW round-trip)", () => {
  it("lists purchase orders and adapts every row through apiPurchaseOrderSchema", async () => {
    const list = await PurchasingRepository.listPurchaseOrders(BRANCH);
    expect(list.length).toBeGreaterThan(0);
    expect(list.some((po) => po.id === PO_ID)).toBe(true);
    expect(list.every((po) => typeof po.status === "string" && typeof po.totalPaisa === "number")).toBe(
      true,
    );
  });

  it("drives DRAFT -> PENDING_APPROVAL -> APPROVED -> SENT through the repository fns", async () => {
    const created = await PurchasingRepository.createPurchaseOrder({
      vendorId: VENDOR_ID,
      branchId: BRANCH,
      lines: [{ ingredientId: ING_1, qty: "10", uom: "kg", unitPricePaisa: 1000 }],
    });
    expect(created.status).toBe("DRAFT");

    const submitted = await PurchasingRepository.submitPurchaseOrder(created.id);
    expect(submitted.status).toBe("PENDING_APPROVAL");

    const approved = await PurchasingRepository.approvePurchaseOrder(created.id);
    expect(approved.status).toBe("APPROVED");

    const sent = await PurchasingRepository.sendPurchaseOrder(created.id);
    expect(sent.status).toBe("SENT");

    // The list must reflect the new status too — a stale list after an action is exactly what
    // the plan calls out as something UAT will bounce.
    const list = await PurchasingRepository.listPurchaseOrders(BRANCH, ["SENT"]);
    expect(list.some((po) => po.id === created.id)).toBe(true);
  });

  it("withdraw returns a PENDING_APPROVAL PO to DRAFT, and reject requires a reason", async () => {
    const created = await PurchasingRepository.createPurchaseOrder({
      vendorId: VENDOR_ID,
      branchId: BRANCH,
      lines: [{ ingredientId: ING_1, qty: "5", uom: "kg", unitPricePaisa: 500 }],
    });
    await PurchasingRepository.submitPurchaseOrder(created.id);

    const withdrawn = await PurchasingRepository.withdrawPurchaseOrder(created.id);
    expect(withdrawn.status).toBe("DRAFT");

    await PurchasingRepository.submitPurchaseOrder(created.id);
    const rejected = await PurchasingRepository.rejectPurchaseOrder(created.id, "Price too high");
    expect(rejected.status).toBe("REJECTED");
  });

  it("mock-receive sends DISTINCT receivedQty per poLineId -- regression pin for the one-qty-for-all-lines bug", async () => {
    let capturedBody: { lines: { poLineId: string; receivedQty: string }[] } | undefined;
    server.use(
      http.post("*/api/v1/purchasing/purchase-orders/:poId/mock-receive", async ({ request }) => {
        capturedBody = (await request.json()) as typeof capturedBody;
        return HttpResponse.json({
          data: { poId: PO_ID, status: "PARTIALLY_RECEIVED", grnIds: [] },
          meta: null,
          warnings: [],
        });
      }),
    );

    await PurchasingRepository.mockReceive(PO_ID, [
      { poLineId: LINE_ID, receivedQty: "100" },
      { poLineId: LINE_ID_2, receivedQty: "20" },
    ]);

    expect(capturedBody?.lines).toHaveLength(2);
    const qtys = capturedBody?.lines.map((l) => l.receivedQty) ?? [];
    // Two DISTINCT values, not the old bug's single qty broadcast to every line.
    expect(new Set(qtys).size).toBe(2);
    expect(qtys).toContain("100");
    expect(qtys).toContain("20");
  });

  it("a genuine per-line partial receive (real handler) lands the PO in PARTIALLY_RECEIVED, not FULLY_RECEIVED", async () => {
    await PurchasingRepository.mockReceive(PO_ID, [
      { poLineId: LINE_ID, receivedQty: "100" }, // full: ordered 100
      { poLineId: LINE_ID_2, receivedQty: "20" }, // partial: ordered 50
    ]);
    const po = await PurchasingRepository.getPurchaseOrder(PO_ID);
    expect(po.status).toBe("PARTIALLY_RECEIVED");
  });

  it("a 403 APPROVAL_LIMIT_EXCEEDED from approve surfaces as an ApiError the hook layer exposes", async () => {
    server.use(
      http.post("*/api/v1/purchasing/purchase-orders/:id/approve", () =>
        HttpResponse.json(
          { error: { code: "APPROVAL_LIMIT_EXCEEDED", message: "over limit", details: [], traceId: "t" } },
          { status: 403 },
        ),
      ),
    );

    const wrapper = createQueryWrapper();
    const { result } = renderHook(() => useApprovePurchaseOrder(PO_ID), { wrapper });
    result.current.mutate();

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.code).toBe("APPROVAL_LIMIT_EXCEEDED");
    expect(result.current.error?.status).toBe(403);
  });
});
