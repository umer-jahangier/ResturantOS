import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";

import { server } from "@/mocks/server";
import { seedSession, clearSession } from "@/__tests__/utils/auth-fixtures";
import { createQueryWrapper } from "@/__tests__/utils/query-wrapper";
import { isUuid } from "@/components/ui/data-grid/columns";
import { poReference } from "@/components/purchasing/po-reference";
import PurchaseOrdersPage from "@/app/(tenant)/app/purchasing/purchase-orders/page";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * purchasing-identifiers.test.tsx — plan 38-07 task 2, and the "Identifier column" verification
 * row: *no UUID-shaped PO number renders*.
 *
 * <p>The measured defect: `/app/purchasing/purchase-orders` printed `ca6ed037…` under a heading
 * reading "PO number", on all 84 rows, and the invoice and payables screens each printed their
 * own `vendorId.slice(0, 8)` under a heading reading "Vendor". None of those is an identifier a
 * human can match against a supplier's paperwork.
 */

const PO_ID = "ca6ed037-1111-4111-8111-111111110001";
const PO_ID_2 = "9958faba-2222-4222-8222-222222220002";
const VENDOR_ID = "b1000001-0000-4000-8000-000000000001";

const rawPurchaseOrders = [
  {
    id: PO_ID,
    vendorId: VENDOR_ID,
    branchId: "00000000-0000-4000-8000-000000000001",
    status: "PENDING_APPROVAL",
    // Empty on every row, exactly as measured — `dropEmptyColumns` must remove the column.
    expectedDeliveryDate: null,
    totalPaisa: 1250000,
    notes: null,
    requesterId: null,
    submittedAt: "2026-08-09T09:00:00Z",
    requiredTiers: 1,
    tiersApproved: 0,
    closedAt: null,
    closeReason: null,
    lines: [],
  },
  {
    id: PO_ID_2,
    vendorId: VENDOR_ID,
    branchId: "00000000-0000-4000-8000-000000000001",
    status: "DRAFT",
    expectedDeliveryDate: null,
    totalPaisa: 480000,
    notes: null,
    requesterId: null,
    submittedAt: null,
    requiredTiers: 1,
    tiersApproved: 0,
    closedAt: null,
    closeReason: null,
    lines: [],
  },
];

const rawVendors = [
  {
    id: VENDOR_ID,
    name: "Fresh Foods Ltd",
    contactPerson: "Bilal",
    phone: null,
    email: null,
    address: null,
    paymentTerms: "NET_30",
    ntn: null,
    strn: null,
    leadTimeDays: 3,
    bankAccountLast4: "4321",
    notes: null,
    active: true,
  },
];

function renderPage() {
  seedSession({ permissions: ["vendor.po.create", "vendor.po.view"] });
  server.use(
    http.get("*/api/v1/purchasing/purchase-orders", () =>
      HttpResponse.json({ data: rawPurchaseOrders, meta: null, warnings: [] }),
    ),
    http.get("*/api/v1/purchasing/vendors", () =>
      HttpResponse.json({ data: rawVendors, meta: null, warnings: [] }),
    ),
  );
  const Wrapper = createQueryWrapper();
  return render(
    <Wrapper>
      <PurchaseOrdersPage />
    </Wrapper>,
  );
}

describe("purchase-order identifiers", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => clearSession());

  it("theReferenceIsShortStableAndUpperCaseAndTheHeadingDoesNotPromiseAPoNumber", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Purchase orders" });

    expect(within(table).getByText("CA6ED037")).toBeInTheDocument();
    // The heading is "Reference", never "PO number": the endpoint carries no such field, and a
    // heading that promises one is the part that misleads a buyer.
    expect(within(table).getByRole("columnheader", { name: /Reference/i })).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: /PO number/i })).toBeNull();
  });

  it("noUuidShapedIdentifierReachesTheScreen", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Purchase orders" });

    const text = table.textContent ?? "";
    // The whole string, not just whole cells: a truncated UUID (`ca6ed037…`) is the exact defect.
    expect(text).not.toContain(PO_ID);
    expect(text).not.toContain(PO_ID.slice(0, 8) + "…");
    expect(text).not.toContain(VENDOR_ID);
    for (const cell of within(table).getAllByRole("cell")) {
      expect(isUuid((cell.textContent ?? "").trim())).toBe(false);
    }
  });

  it("theVendorColumnNamesTheSupplierRatherThanItsId", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Purchase orders" });
    expect(within(table).getAllByText("Fresh Foods Ltd").length).toBe(2);
  });

  it("theAllEmptyExpectedDateColumnIsNotInTheDom", async () => {
    renderPage();
    const table = await screen.findByRole("table", { name: "Purchase orders" });
    // UI-SPEC §7.2 — a column with no data on ANY row is not rendered. Measured: an em-dash on
    // 83 of 84 rows; here, on all of them.
    expect(within(table).queryByRole("columnheader", { name: /Expected date/i })).toBeNull();
  });

  it("poReferenceIsOneSpellingSharedByEveryScreenThatNamesAnOrder", () => {
    // Three screens name a purchase order. Two of them used to hand-roll `id.slice(0, 8)` in
    // lower case with a trailing ellipsis, so one order appeared as two.
    expect(poReference({ id: PO_ID })).toBe("CA6ED037");
    expect(poReference({ id: PO_ID_2 })).toBe("9958FABA");
    expect(isUuid(poReference({ id: PO_ID }))).toBe(false);
  });
});
