import { describe, it, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import { PosRepository } from "@/lib/repositories/pos.repository";
import { apiMenuItemSchema, apiOrderSchema } from "@/lib/api-client/schemas/pos.schema";
import { adaptMenuItem, adaptOrder } from "@/lib/adapters/pos.adapter";

const BASE_ITEM_ID = "a1000001-0000-4000-8000-000000000001";
const BASE_ORDER_ID = "a2000001-0000-4000-8000-000000000001";
const BRANCH_ID = "b0000001-0000-4000-8000-000000000001";
const CLIENT_ORDER_ID = "c0000001-0000-4000-8000-000000000001";

const rawMenuItem = {
  id: BASE_ITEM_ID,
  categoryId: null,
  name: "Chicken Karahi",
  description: "Classic",
  basePricePaisa: 85000,
  taxRatePct: "5.00",
  kdsStation: "HOT",
  active: true,
};

const rawOrder = {
  id: BASE_ORDER_ID,
  branchId: BRANCH_ID,
  orderNo: "ORD-20260630-0001",
  type: "DINE_IN",
  status: "OPEN",
  derivedStatus: "DRAFT",
  tableId: null,
  coverCount: 2,
  cashierId: null,
  customerId: null,
  subtotalPaisa: 85000,
  taxPaisa: 4250,
  discountPaisa: 0,
  serviceChargePaisa: 0,
  totalPaisa: 89250,
  notes: null,
  openedAt: "2026-06-30T00:00:00Z",
  sentToKdsAt: null,
  clientOrderId: CLIENT_ORDER_ID,
  version: 0,
  items: [
    {
      id: "a3000001-0000-4000-8000-000000000001",
      menuItemId: BASE_ITEM_ID,
      itemNameSnapshot: "Chicken Karahi",
      unitPriceSnapshot: 85000,
      quantity: 1,
      kdsStation: "HOT",
      kdsStatus: "PENDING",
      revisionNo: 0,
      firedAt: null,
      discountPaisa: 0,
      taxPaisa: 4250,
      lineTotalPaisa: 89250,
      notes: null,
      modifiers: [],
    },
  ],
};

describe("PosRepository — Zod parse + adapter contract", () => {
  describe("apiMenuItemSchema", () => {
    it("parses a valid raw menu item", () => {
      const parsed = apiMenuItemSchema.parse(rawMenuItem);
      expect(parsed.id).toBe(BASE_ITEM_ID);
      expect(parsed.basePricePaisa).toBe(85000);
      // taxRatePct is transformed from string "5.00" to number 5
      expect(typeof parsed.taxRatePct).toBe("number");
      expect(parsed.taxRatePct).toBe(5);
    });

    it("rejects a menu item with a negative price", () => {
      expect(() =>
        apiMenuItemSchema.parse({ ...rawMenuItem, basePricePaisa: -1 })
      ).toThrow();
    });

    it("rejects a menu item missing the 'name' field", () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { name, ...without } = rawMenuItem;
      expect(() => apiMenuItemSchema.parse(without)).toThrow();
    });
  });

  describe("apiOrderSchema", () => {
    it("parses a valid raw order", () => {
      const parsed = apiOrderSchema.parse(rawOrder);
      expect(parsed.id).toBe(BASE_ORDER_ID);
      expect(parsed.status).toBe("OPEN");
      expect(parsed.items).toHaveLength(1);
      expect(parsed.items[0]!.lineTotalPaisa).toBe(89250);
    });

    it("rejects an order with an invalid status", () => {
      expect(() =>
        apiOrderSchema.parse({ ...rawOrder, status: "INVALID_STATUS" })
      ).toThrow();
    });
  });

  describe("adaptMenuItem", () => {
    it("adapts parsed API shape to domain MenuItem", () => {
      const parsed = apiMenuItemSchema.parse(rawMenuItem);
      const adapted = adaptMenuItem(parsed);
      expect(adapted.id).toBe(BASE_ITEM_ID);
      expect(adapted.name).toBe("Chicken Karahi");
      expect(adapted.taxRatePct).toBe(5);
      expect(adapted.kdsStation).toBe("HOT");
    });
  });

  describe("adaptOrder", () => {
    it("adapts parsed raw order to domain Order", () => {
      const parsed = apiOrderSchema.parse(rawOrder);
      const adapted = adaptOrder(parsed);
      expect(adapted.id).toBe(BASE_ORDER_ID);
      expect(adapted.status).toBe("OPEN");
      expect(adapted.items[0]!.lineTotalPaisa).toBe(89250);
      expect(adapted.clientOrderId).toBe(CLIENT_ORDER_ID);
    });
  });

  describe("PosRepository.createOrder", () => {
    it("sends Idempotency-Key header equal to clientOrderId", async () => {
      let capturedIdempotencyKey: string | null = null;

      server.use(
        http.post("*/api/v1/pos/orders", async ({ request }) => {
          capturedIdempotencyKey = request.headers.get("Idempotency-Key");
          return HttpResponse.json({ data: rawOrder });
        })
      );

      await PosRepository.createOrder({
        branchId: BRANCH_ID,
        clientOrderId: CLIENT_ORDER_ID,
        type: "DINE_IN",
        coverCount: 2,
      });

      expect(capturedIdempotencyKey).toBe(CLIENT_ORDER_ID);
    });
  });
});
