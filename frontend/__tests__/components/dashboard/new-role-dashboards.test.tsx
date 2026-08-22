import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountantDashboard } from "@/components/dashboard/accountant-dashboard";
import { FinanceDashboard } from "@/components/dashboard/finance-dashboard";
import { InventoryDashboard } from "@/components/dashboard/inventory-dashboard";
import { WaiterDashboard } from "@/components/dashboard/waiter-dashboard";

/**
 * The four new role dashboards render REAL FIGURES, from data this system actually returns.
 *
 * <h3>Why this file exists rather than trusting the preset test</h3>
 *
 * `role-dashboards.test.tsx` proves the routing and the layout: nine roles, nine presets, every
 * portlet the table declares. It cannot prove the thing that actually matters here — that the
 * figures ARRIVE. A dashboard of seven portlets each rendering "—" satisfies every assertion in
 * that file and is not better than the blank page it replaced. The brief for this work says so
 * in as many words: *"a role with a dashboard of four unavailable tiles is not better than
 * today."*
 *
 * <p>So these tests mount the real components against fixtures shaped like the real responses,
 * and assert on the NUMBERS. Where a tile is deliberately unavailable (D-38-16) that is asserted
 * too, by its reason — an absence with a stated cause is a different thing from a tile that
 * failed to find its data, and only one of them is acceptable.
 *
 * <h3>The hooks are mocked; the components are not</h3>
 *
 * Each dashboard is rendered exactly as `TenantDashboard` renders it. Nothing is stubbed below
 * the hook boundary — `PortletGrid`, `QueryBoundary`, `KpiTile`, `MoneyDisplay` and the preset
 * table are all the real thing, so a portlet dropped by the permission filter, a model bound to
 * the wrong `type`, or a money figure that never reaches `MoneyDisplay` all show up here.
 *
 * <h3>Negative controls performed, each OBSERVED red then restored</h3>
 *
 * <ol>
 *   <li>`draftCount` taken from `drafts.length` instead of `meta.totalCount` — the plausible
 *       simplification — → the server-total assertion failed `expected '2' to be '7'`, and so
 *       did the cross-role agreement assertion.</li>
 *   <li>The payables bars re-based on the largest bucket instead of the ageing total — the same
 *       `count / max` formula the station-load ranking correctly uses — → the bar-width
 *       assertion failed. `60% / 40%` is a share of the payables; `100% / 67%` is a share of
 *       nothing the reader was shown.</li>
 * </ol>
 */

const q = <T,>(data: T) => ({
  data,
  isError: false,
  error: undefined,
  isPending: false,
  isLoading: false,
  isFetching: false,
  refetch: () => undefined,
});

const fixtures = vi.hoisted(() => {
  const BRANCH = "b1000001-0000-4000-8000-000000000001";

  const stock = [
    {
      ingredientId: "i-1",
      ingredientName: "Beef mince",
      sku: "BEEF-01",
      baseUomCode: "kg",
      categoryId: null,
      categoryName: "Meat",
      qtyOnHand: "2.5",
      reorderPoint: "10",
      avgCostPaisa: 120,
      stockValuePaisa: 30000,
      lastCountedAt: "2026-08-19T10:00:00Z",
      belowReorderPoint: true,
      nonPositive: false,
      varianceCapPct: null,
    },
    {
      ingredientId: "i-2",
      ingredientName: "Mozzarella",
      sku: "CHZ-02",
      baseUomCode: "kg",
      categoryId: null,
      categoryName: "Dairy",
      qtyOnHand: "0",
      reorderPoint: "4",
      avgCostPaisa: 900,
      stockValuePaisa: 0,
      lastCountedAt: null,
      belowReorderPoint: true,
      nonPositive: true,
      varianceCapPct: null,
    },
    {
      ingredientId: "i-3",
      ingredientName: "Flour",
      sku: "FLR-03",
      baseUomCode: "kg",
      categoryId: null,
      categoryName: "Dry",
      qtyOnHand: "40",
      reorderPoint: "10",
      avgCostPaisa: 60,
      stockValuePaisa: 240000,
      lastCountedAt: "2026-08-20T10:00:00Z",
      belowReorderPoint: false,
      nonPositive: false,
      varianceCapPct: null,
    },
  ];

  return {
    BRANCH,
    stockLevels: { branchId: BRANCH, items: stock, totalStockValuePaisa: 270000 },
    purchaseOrders: [
      {
        id: "po-1",
        vendorId: "v-1",
        branchId: BRANCH,
        status: "SENT",
        expectedDeliveryDate: "2026-08-25",
        totalPaisa: 450000,
        notes: null,
        requesterId: null,
        submittedAt: null,
        requiredTiers: null,
        tiersApproved: null,
        closedAt: null,
        closeReason: null,
        lines: [],
      },
    ],
    vendors: [
      {
        id: "v-1",
        name: "Karachi Cold Store",
        contactPerson: null,
        phone: null,
        email: null,
        address: null,
        paymentTerms: "NET_30",
        ntn: null,
        strn: null,
        leadTimeDays: 2,
        bankAccountLast4: null,
        notes: null,
        active: true,
      },
    ],
    journalEntries: {
      data: [
        {
          id: "je-1",
          entryNo: "JE-0001",
          entryDate: "2026-08-01",
          description: "Accrual",
          status: "DRAFT" as const,
          totalDebitPaisa: 500000,
          totalCreditPaisa: 500000,
          lines: [],
        },
        {
          id: "je-2",
          entryNo: "JE-0002",
          entryDate: "2026-08-10",
          description: "Rent",
          status: "DRAFT" as const,
          totalDebitPaisa: 300000,
          totalCreditPaisa: 250000,
          lines: [],
        },
      ],
      meta: { page: { cursor: "0", nextCursor: null, limit: 50 }, totalCount: 7 },
    },
    periods: [
      {
        id: "p-1",
        fiscalYear: 2026,
        periodNo: 1,
        startDate: "2025-07-01",
        endDate: "2025-07-31",
        status: "OPEN" as const,
        lockedBy: null,
        lockedAt: null,
      },
    ],
    payrollRuns: [
      {
        id: "pr-1",
        periodMonth: 7,
        periodYear: 2026,
        status: "CALCULATED" as const,
        totalGrossPaisa: 2240000,
        totalNetPaisa: 2000000,
        branchId: BRANCH,
        runBy: null,
        approvedBy: null,
        paidAt: null,
      },
    ],
    apAging: {
      totalApPaisa: 1000000,
      buckets: [
        { label: "0-30", minDays: 0, maxDays: 30, amountPaisa: 600000 },
        { label: "31-60", minDays: 31, maxDays: 60, amountPaisa: 400000 },
      ],
    },
    arAging: {
      totalArPaisa: 250000,
      buckets: [{ label: "0-30", minDays: 0, maxDays: 30, amountPaisa: 250000 }],
    },
    invoices: [
      {
        id: "inv-1",
        vendorId: "v-1",
        purchaseOrderId: "po-1",
        branchId: BRANCH,
        invoiceNo: "V-9001",
        invoiceDate: "2026-08-12",
        status: "MISMATCHED",
        totalPaisa: 460000,
        inputTaxPaisa: 0,
        matchOverrideReason: null,
        lines: [],
      },
    ],
    orders: {
      data: [
        {
          orderId: "o-1",
          orderNo: "ORD-0001",
          tableId: "t-1",
          tableName: "T1",
          type: "DINE_IN" as const,
          derivedStatus: "IN_PROGRESS" as const,
          cashierId: null,
          cashierName: null,
          coverCount: 2,
          totalPaisa: 180000,
          openedAt: "2026-08-21T12:00:00Z",
          settlementStatus: "OPEN" as const,
          paymentStatus: "UNPAID" as const,
          amountPaidPaisa: 0,
          itemQuantity: 4,
          distinctItemCount: 3,
          settlement: null,
        },
      ],
      meta: { page: { cursor: "0", nextCursor: null, limit: 20 }, totalCount: 1 },
    },
    tables: [
      {
        id: "t-1",
        branchId: BRANCH,
        tableName: "T1",
        capacity: 4,
        section: null,
        active: true,
        status: "OCCUPIED" as const,
        floorPlanX: null,
        floorPlanY: null,
        floorPlanShape: null,
      },
      {
        id: "t-2",
        branchId: BRANCH,
        tableName: "T2",
        capacity: 2,
        section: null,
        active: true,
        status: "NEEDS_BUSSING" as const,
        floorPlanX: null,
        floorPlanY: null,
        floorPlanShape: null,
      },
    ],
    tickets: [
      {
        id: "k-1",
        orderId: "o-1",
        orderNo: "ORD-0001",
        stationCode: "GRILL",
        status: "READY" as const,
        priority: false,
        receivedAt: new Date("2026-08-21T12:05:00Z"),
        startedAt: null,
        readyAt: null,
        clearedAt: null,
        orderNotes: null,
        tableNumber: "T1",
        orderType: "DINE_IN",
        items: [],
      },
    ],
    stations: [
      {
        id: "s-1",
        branchId: BRANCH,
        code: "GRILL",
        name: "Grill",
        type: "HOT" as const,
        active: true,
        escalationThresholdSeconds: 900,
        sortOrder: 1,
      },
    ],
  };
});

vi.mock("@/lib/hooks/auth/use-current-user", () => ({
  useCurrentUser: () => ({
    isAuthenticated: true,
    userId: "u-1",
    branchId: fixtures.BRANCH,
    roles: [],
    // Every permission any of the four presets names, so nothing is dropped by the filter and a
    // missing tile below is a missing MODEL rather than a missing grant.
    permissions: [
      "inventory.item.view",
      "vendor.view",
      "vendor.invoice.book",
      "finance.journal.view",
      "finance.ar.view",
      "hr.payroll.view",
      "pos.order.view",
      "pos.order.create",
      "pos.kds.view",
      "pos.tables.manage",
    ],
    attributes: {},
  }),
}));

vi.mock("@/lib/hooks/inventory/use-inventory", () => ({
  useStockLevels: () => q(fixtures.stockLevels),
}));

vi.mock("@/lib/hooks/purchasing/use-purchasing", () => ({
  usePurchaseOrders: () => q(fixtures.purchaseOrders),
  useVendors: () => q(fixtures.vendors),
  useVendorInvoices: () => q(fixtures.invoices),
}));

vi.mock("@/lib/hooks/finance/use-journal-entries", () => ({
  useJournalEntries: () => q(fixtures.journalEntries),
}));

vi.mock("@/lib/hooks/finance/use-periods", () => ({
  useOpenPeriods: () => q(fixtures.periods),
}));

vi.mock("@/lib/hooks/finance/use-finance", () => ({
  useApAging: () => q(fixtures.apAging),
  useArAging: () => q(fixtures.arAging),
}));

vi.mock("@/lib/hooks/hr/use-payroll", () => ({
  usePayrollRuns: () => q(fixtures.payrollRuns),
}));

vi.mock("@/lib/hooks/pos/use-orders", () => ({
  useOrderSummaries: () => q(fixtures.orders),
  useTables: () => q(fixtures.tables),
}));

vi.mock("@/lib/hooks/kds/use-kds-tickets", () => ({
  useKdsTickets: () => q(fixtures.tickets),
  useKdsStations: () => q(fixtures.stations),
}));

afterEach(cleanup);

function figure(id: string): string {
  return screen.getByTestId(`kpi-value-${id}`).textContent ?? "";
}

describe("INVENTORY_MANAGER — 'What am I about to run out of?'", () => {
  it("answers the question with counted figures, not dashes", () => {
    render(<InventoryDashboard />);

    expect(screen.getByTestId("dashboard")).toHaveAttribute("data-preset", "inventory");
    expect(figure("inventory-below-reorder")).toBe("2");
    expect(figure("inventory-out-of-stock")).toBe("1");
    // The envelope's own total, formatted by the one money path.
    expect(figure("inventory-stock-value")).toContain("2,700.00");
    expect(figure("inventory-incoming")).toBe("1");
  });

  it("ranks the emptiest shelf first and shows the reorder point it is measured against", () => {
    render(<InventoryDashboard />);

    const ranked = screen.getByTestId("portlet-inventory-shortfalls");
    const rows = [...ranked.querySelectorAll("li")].map((li) => li.textContent ?? "");
    expect(rows[0]).toContain("Mozzarella");
    expect(rows[0]).toContain("0 of 4 kg");
    expect(rows[1]).toContain("Beef mince");
  });

  it("names the out-of-stock ingredient and the ingredient nobody has ever counted", () => {
    render(<InventoryDashboard />);

    const list = screen.getByTestId("portlet-inventory-exceptions");
    expect(list).toHaveTextContent("Mozzarella is out of stock");
    expect(list).toHaveTextContent("1 ingredient has never been counted");
  });

  it("resolves the purchase order to a vendor NAME, not a uuid", () => {
    render(<InventoryDashboard />);

    expect(screen.getByTestId("portlet-inventory-open-orders")).toHaveTextContent(
      "Karachi Cold Store",
    );
  });

  it("renders no tile at all with no figure — every portlet on this page is computable", () => {
    const { container } = render(<InventoryDashboard />);
    expect(container.querySelectorAll("[data-portlet]")).toHaveLength(7);
    expect(container.textContent).not.toContain("cannot be computed");
  });
});

describe("FINANCE_VIEWER — 'What still needs reconciling?'", () => {
  it("counts the ledger's unfinished work from the SERVER's total, not the page length", () => {
    render(<FinanceDashboard />);

    expect(screen.getByTestId("dashboard")).toHaveAttribute("data-preset", "finance");
    // 7 drafts exist; 2 were returned on the page. The tile must report 7.
    expect(figure("finance-unposted-journals")).toBe("7");
    expect(figure("finance-unbalanced-journals")).toBe("1");
    expect(figure("finance-open-periods")).toBe("1");
    expect(figure("finance-payroll-unpaid")).toBe("1");
  });

  it("says what the unbalanced count was measured over, because it is not the server total", () => {
    render(<FinanceDashboard />);

    expect(screen.getByTestId("portlet-finance-unbalanced-journals")).toHaveTextContent(
      "Among the 2 most recent drafts",
    );
  });

  it("puts the entry that cannot be posted, and the period nobody closed, in the exception list", () => {
    render(<FinanceDashboard />);

    const list = screen.getByTestId("portlet-finance-exceptions");
    expect(list).toHaveTextContent("JE-0002 does not balance");
    expect(list).toHaveTextContent("Period 1 of FY2026 is still open");
  });
});

describe("ACCOUNTANT — 'What needs posting or reconciling?'", () => {
  it("no longer opens with the owner's question", () => {
    render(<AccountantDashboard />);

    const shell = screen.getByTestId("dashboard");
    expect(shell).toHaveAttribute("data-preset", "accountant");
    expect(shell).toHaveTextContent("What needs posting or reconciling?");
    expect(shell).not.toHaveTextContent("Is the business healthy?");
  });

  it("shows payables and receivables as money, from the ageing endpoints' own totals", () => {
    render(<AccountantDashboard />);

    expect(figure("accountant-payables-outstanding")).toContain("10,000.00");
    expect(figure("accountant-receivables-outstanding")).toContain("2,500.00");
  });

  it("draws the payables bars against the ageing TOTAL — a real denominator", () => {
    const { container } = render(<AccountantDashboard />);

    const bars = container.querySelectorAll(
      '[data-testid="portlet-accountant-payables-ageing"] li div > div',
    );
    expect([...bars].map((b) => (b as HTMLElement).style.width)).toEqual(["60%", "40%"]);
  });

  it("refuses net income with a stated reason and no figure beside it (D-38-16)", () => {
    render(<AccountantDashboard />);

    expect(figure("accountant-net-income")).toBe("—");
    const tile = screen.getByTestId("portlet-accountant-net-income");
    expect(tile).toHaveTextContent("Cost of goods is not posted per sale");
    expect(tile).toHaveTextContent("Showing nothing rather than a wrong number");
    // Not a zero, not a percentage, and no delta stacked on top of a withheld number.
    expect(tile.textContent).not.toMatch(/\b0(\.0+)?%/);
    expect(screen.queryByTestId("kpi-delta-accountant-net-income")).toBeNull();
  });

  it("is the ONLY unavailable tile — the other seven carry figures", () => {
    const { container } = render(<AccountantDashboard />);

    const dashes = [...container.querySelectorAll('[data-testid^="kpi-value-"]')].filter(
      (el) => el.textContent === "—",
    );
    expect(dashes.map((el) => el.getAttribute("data-testid"))).toEqual([
      "kpi-value-accountant-net-income",
    ]);
    expect(container.querySelectorAll("[data-portlet]")).toHaveLength(8);
  });

  it("puts the invoice that failed its three-way match at the head of the exception list", () => {
    render(<AccountantDashboard />);

    const list = screen.getByTestId("portlet-accountant-exceptions");
    expect(list.querySelector("li")).toHaveTextContent("Invoice V-9001 failed its three-way match");
  });

  it("reads the same unposted count a FINANCE_VIEWER reads", () => {
    render(<AccountantDashboard />);
    const accountant = figure("accountant-unposted-journals");
    cleanup();
    render(<FinanceDashboard />);

    expect(
      figure("finance-unposted-journals"),
      "two roles reading two different counts of the same ledger on the same afternoon is what " +
        "`ledger-shared.tsx` exists to prevent",
    ).toBe(accountant);
  });
});

describe("WAITER — 'What are my tables doing?'", () => {
  it("opens on the floor, not on a till it cannot open", () => {
    render(<WaiterDashboard />);

    const shell = screen.getByTestId("dashboard");
    expect(shell).toHaveAttribute("data-preset", "waiter");
    expect(shell).not.toHaveTextContent("Where is my till");
    expect(figure("waiter-tables-occupied")).toBe("1 / 2");
    expect(figure("waiter-open-checks")).toBe("1");
    expect(figure("waiter-ready-to-run")).toBe("1");
  });

  it("prefers the bussing count to the free count when a table is waiting to be cleared", () => {
    render(<WaiterDashboard />);

    expect(screen.getByTestId("portlet-waiter-tables-occupied")).toHaveTextContent(
      "1 waiting to be bussed",
    );
  });

  it("does not claim any tile is filtered to the reader — there is no server-side 'mine'", () => {
    render(<WaiterDashboard />);

    expect(screen.getByTestId("portlet-waiter-open-checks")).toHaveTextContent(
      "Across the whole branch, not just your section",
    );
  });

  it("keeps the 72px primary action, now gated by `pos.order.create`", () => {
    render(<WaiterDashboard />);

    const action = screen.getByTestId("dashboard-primary-action");
    expect(action).toHaveTextContent("Open POS");
    expect(action).toHaveAttribute("href", "/app/pos");
  });
});
