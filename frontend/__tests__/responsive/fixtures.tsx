import * as React from "react";

import { AgingGrid } from "@/components/finance/AgingGrid";
import { DashboardShell, PortletRow } from "@/components/dashboard/dashboard-shell";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { KdsTicketCard } from "@/components/kds/kds-ticket-card";
import { MoneyDisplay } from "@/components/ui/money-display";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { PermissionMatrix } from "@/components/roles/permission-matrix";
import { ReportTable } from "@/components/reporting/ReportTable";
import { SectionTabs } from "@/components/shared/section-tabs";
import { SpendAnalyticsTable } from "@/components/purchasing/SpendAnalyticsTable";
import { StatTile } from "@/components/ui/stat-tile";
import { TenderSplit } from "@/components/finance/TenderSplit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { ImpersonationTable } from "@/components/platform/impersonation-log";
import { ThreeWayMatchTable } from "@/components/purchasing/ThreeWayMatchTable";
import { TillVariancePanel } from "@/components/finance/TillVariancePanel";

import type { ApAgingBucket } from "@/lib/models/finance.model";
import type { ImpersonationRecord } from "@/lib/models/platform.model";
import type { TillReconciliation } from "@/lib/models/takings.model";
import type { VendorInvoice } from "@/lib/adapters/purchasing.adapter";
import type { KdsTicket } from "@/lib/models/kds.model";
import type { PermissionModule } from "@/lib/models/role.model";
import type { AssignableRole } from "@/lib/models/user.model";
import type { ReportResult } from "@/lib/models/reporting.model";
import { DASHBOARD_PRESETS } from "@/components/dashboard/presets";

/**
 * The screens this phase is accountable for, as renderable trees.
 *
 * <h3>Why fixtures rather than routes</h3>
 *
 * A route in this product is a Next.js server boundary over a react-query tree over sixteen
 * Spring services. Measuring one needs all of them, which is precisely why plan 38-14's runtime
 * gate has never run. A fixture is the same component with the same props the route passes it,
 * and the thing being measured — how a laid-out box behaves at 390px — does not depend on where
 * the numbers came from.
 *
 * <p>Each entry names the MODULE it stands for, so a gap in coverage is visible as a missing
 * module rather than as a shorter list.
 */
export interface Fixture {
  /** Stable id, used in the failure message and in the coverage assertion. */
  id: string;
  /** The owner-facing module. Every module in the review must appear at least once. */
  module: string;
  /** Rendered inside the tenant `<main>` scaffold unless `bare`. */
  render: () => React.ReactElement;
  /**
   * Skip the back-office `<main>` gutter — for surfaces that own their viewport (POS, KDS) and
   * for the shell itself, which IS the scaffold.
   */
  bare?: boolean;
}

/* ── Shared sample data ──────────────────────────────────────────────────────────────────── */

interface StockRow {
  id: string;
  name: string;
  category: string;
  uom: string;
  onHand: number;
  reorder: number;
  vendor: string;
  valuePaisa: number;
}

/** The eight-column shape `/app/inventory/stock` renders — the audit's 100-element offender. */
const STOCK_ROWS: StockRow[] = Array.from({ length: 12 }, (_, i) => ({
  id: `row-${i}`,
  name: ["Chicken Boneless", "Basmati Rice (Super Kernel)", "Cooking Oil — Canola"][i % 3]!,
  category: ["Meat & Poultry", "Dry Goods", "Oils & Fats"][i % 3]!,
  uom: ["KG", "EACH", "LITRE"][i % 3]!,
  onHand: [90.5, 213.25, -2987][i % 3]!,
  reorder: 40,
  vendor: ["Karachi Fresh Foods (Pvt) Ltd", "Metro Cash & Carry", "Al-Noor Traders"][i % 3]!,
  valuePaisa: [21350000, 987650, 145000000][i % 3]!,
}));

const STOCK_COLUMNS: ColumnDef<StockRow, unknown>[] = [
  { accessorKey: "name", header: "Ingredient" },
  { accessorKey: "category", header: "Category", meta: { hideBelow: "md" } },
  { accessorKey: "uom", header: "UoM", meta: { hideBelow: "lg" } },
  { accessorKey: "onHand", header: "On hand", meta: { mono: true } },
  { accessorKey: "reorder", header: "Reorder point", meta: { mono: true, hideBelow: "lg" } },
  { accessorKey: "vendor", header: "Preferred vendor", meta: { hideBelow: "xl" } },
  {
    id: "value",
    header: "Value",
    meta: { mono: true },
    cell: ({ row }) => <MoneyDisplay paisa={row.original.valuePaisa} />,
  },
];

const AGING_BUCKETS: ApAgingBucket[] = [
  { label: "Current", minDays: 0, maxDays: 30, amountPaisa: 145000000 },
  { label: "31–60 days", minDays: 31, maxDays: 60, amountPaisa: 21350000 },
  { label: "61–90 days", minDays: 61, maxDays: 90, amountPaisa: 987650 },
  { label: "Over 90 days", minDays: 91, maxDays: 9999, amountPaisa: 4500000 },
];

const KDS_TICKET: KdsTicket = {
  id: "t-1",
  orderId: "o-1",
  orderNo: "ORD-20260812-0019",
  stationCode: "HOT",
  status: "COOKING",
  priority: true,
  receivedAt: new Date(Date.now() - 8 * 60_000),
  startedAt: new Date(Date.now() - 4 * 60_000),
  readyAt: null,
  clearedAt: null,
  orderNotes: null,
  tableNumber: "12",
  orderType: "DINE_IN",
  items: [
    {
      id: "i-1",
      orderItemId: "oi-1",
      name: "Chicken Karahi (Full)",
      qty: 2,
      modifiers: ["Extra spicy", "No coriander"],
      notes: "Allergy: peanuts",
      status: "COOKING",
      revisionNo: 1,
      firedAt: null,
    },
    {
      id: "i-2",
      orderItemId: "oi-2",
      name: "Seekh Kebab Platter with Naan",
      qty: 1,
      modifiers: [],
      notes: null,
      status: "PENDING",
      revisionNo: 1,
      firedAt: null,
    },
  ],
};

const ROLES: AssignableRole[] = [
  {
    code: "OWNER",
    name: "Owner",
    system: true,
    permissions: ["pos.order.create"],
    assignedUserCount: 1,
  },
  { code: "MANAGER", name: "Branch Manager", system: true, permissions: [], assignedUserCount: 3 },
  {
    code: "CASHIER",
    name: "Cashier",
    system: true,
    permissions: ["pos.order.create"],
    assignedUserCount: 9,
  },
  { code: "ACCOUNTANT", name: "Accountant", system: false, permissions: [], assignedUserCount: 2 },
];

const PERMISSION_MODULES: PermissionModule[] = [
  {
    module: "pos",
    permissions: [
      { code: "pos.order.create", module: "pos", description: "Create an order" },
      { code: "pos.till.open", module: "pos", description: "Open a till session" },
    ],
  },
  {
    module: "inventory",
    permissions: [
      { code: "inventory.item.view", module: "inventory", description: "View ingredients" },
    ],
  },
];

const REPORT: ReportResult = {
  code: "sales_by_item",
  title: "Sales by item",
  columns: ["item_name", "category", "qty_sold", "gross_paisa", "discount_paisa", "net_paisa"],
  rows: Array.from({ length: 6 }, (_, i) => ({
    item_name: "Chicken Karahi (Full)",
    category: "Main Course",
    qty_sold: 12 + i,
    gross_paisa: 145000000,
    discount_paisa: 987650,
    net_paisa: 144012350,
  })),
  rowCount: 6,
  durationMs: 42,
  dataNotes: [],
};

const SPEND_BUCKETS = [
  {
    id: "v-1",
    label: "Karachi Fresh Foods (Pvt) Ltd",
    spendPaisa: 145000000,
    priorSpendPaisa: 121000000,
    deltaPaisa: 24000000,
    deltaPct: 19.8,
  },
  {
    id: "v-2",
    label: "Metro Cash & Carry",
    spendPaisa: 21350000,
    priorSpendPaisa: 33000000,
    deltaPaisa: -11650000,
    deltaPct: -35.3,
  },
];

const TILLS: TillReconciliation[] = [
  {
    tillSessionId: "till-1",
    cashierId: "cashier-1",
    status: "CLOSED",
    openingFloatPaisa: 500000,
    expectedClosing: { state: "KNOWN", paisa: 14500000 },
    declaredClosing: { state: "KNOWN", paisa: 14487500 },
    variance: { state: "KNOWN", paisa: -12500 },
    openedAt: new Date("2026-08-20T09:00:00Z"),
    closedAt: new Date("2026-08-20T23:30:00Z"),
    reconciliationState: "SHORT",
  },
  {
    tillSessionId: "till-2",
    cashierId: null,
    status: "OPEN",
    openingFloatPaisa: 500000,
    expectedClosing: { state: "KNOWN", paisa: 2135000 },
    declaredClosing: {
      state: "UNKNOWN",
      figureKey: "counted cash",
      reason: "This till has not been counted yet.",
    },
    variance: {
      state: "UNKNOWN",
      figureKey: "cash variance",
      reason: "No count to compare the expected cash against.",
    },
    openedAt: new Date("2026-08-21T09:00:00Z"),
    closedAt: null,
    reconciliationState: "OPEN",
  },
];

const IMPERSONATIONS: ImpersonationRecord[] = [
  {
    id: "imp-1",
    tenantId: "11111111-1111-4111-8111-111111111111",
    tenantSlug: "floating-terrace",
    tenantBrandName: "Floating Terrace",
    adminUserId: "admin-1",
    adminEmail: "ops@restaurantos.example",
    targetUserId: "22222222-2222-4222-8222-222222222222",
    startedAt: new Date("2026-08-20T11:04:00Z"),
    expiresAt: new Date("2026-08-20T11:34:00Z"),
    status: "EXPIRED",
    reason: "Investigating a failed settlement reported by the branch manager",
  },
];

/** Only the fields `ThreeWayMatchTable` reads; the rest of the invoice is not its business. */
const INVOICE = {
  id: "inv-1",
  lines: [
    {
      id: "l-1",
      poQty: "12",
      poUnitPricePaisa: 145000,
      grnQty: "12",
      qty: "12",
      unitPricePaisa: 145000,
      matchStatus: "MATCHED",
    },
    {
      id: "l-2",
      poQty: "40",
      poUnitPricePaisa: 21350,
      grnQty: "38",
      qty: "40",
      unitPricePaisa: 22000,
      matchStatus: "PRICE_VARIANCE",
    },
  ],
} as unknown as VendorInvoice;

/* ── The fixtures ────────────────────────────────────────────────────────────────────────── */

export const FIXTURES: Fixture[] = [
  {
    id: "dashboard/kpi-row",
    module: "dashboard",
    render: () => (
      <PageBody>
        <DashboardShell preset={DASHBOARD_PRESETS.owner}>
          <PortletRow density="comfortable" columns={4}>
            <StatTile
              label="Net sales today"
              value={<MoneyDisplay paisa={145000000} />}
              accent="primary"
            />
            <StatTile label="Orders" value="184" accent="secondary" />
            <StatTile
              label="Average check"
              value={<MoneyDisplay paisa={78804} />}
              accent="secondary"
            />
            <StatTile label="Void rate" value="1.4%" accent="primary" />
          </PortletRow>
        </DashboardShell>
      </PageBody>
    ),
  },
  {
    id: "inventory/stock-list",
    module: "inventory",
    render: () => (
      <PageBody>
        <PageHeader
          title="Stock on hand"
          description="Every ingredient this branch holds, with its current valuation."
          actions={<Button>Record a count</Button>}
        />
        <div className="mt-(--space-lg)">
          <DataGrid
            columns={STOCK_COLUMNS}
            data={STOCK_ROWS}
            label="Stock on hand"
            card={{
              primary: (row: StockRow) => row.name,
              secondary: (row: StockRow) => `${row.category} · ${row.vendor}`,
              trailing: (row: StockRow) => <MoneyDisplay paisa={row.valuePaisa} />,
            }}
          />
        </div>
      </PageBody>
    ),
  },
  {
    id: "finance/ap-aging",
    module: "finance",
    render: () => (
      <PageBody>
        <PageHeader title="Accounts payable aging" />
        <div className="mt-(--space-lg)">
          <AgingGrid
            buckets={AGING_BUCKETS}
            totalPaisa={171837650}
            totalLabel="Total payable"
            totalNote="As stated by the ledger"
            label="Accounts payable aging"
          />
        </div>
      </PageBody>
    ),
  },
  {
    id: "finance/tender-split",
    module: "finance",
    render: () => (
      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle>Tender split</CardTitle>
          </CardHeader>
          <CardContent>
            <TenderSplit
              lines={[
                {
                  method: "CASH",
                  amountPaisa: 145000000,
                  tipPaisa: 18500,
                  paymentCount: 42,
                  unclosedAmountPaisa: 250000,
                  unclosedPaymentCount: 2,
                },
                {
                  method: "CARD",
                  amountPaisa: 21350000,
                  tipPaisa: 30000,
                  paymentCount: 11,
                  unclosedAmountPaisa: 0,
                  unclosedPaymentCount: 0,
                },
              ]}
            />
          </CardContent>
        </Card>
      </PageBody>
    ),
  },
  {
    id: "purchasing/spend-analytics",
    module: "purchasing",
    render: () => (
      <PageBody>
        <PageHeader title="Spend analytics" />
        <div className="mt-(--space-lg)">
          <SpendAnalyticsTable title="By vendor" buckets={SPEND_BUCKETS} />
        </div>
      </PageBody>
    ),
  },
  {
    id: "roles/permission-matrix",
    module: "roles",
    render: () => (
      <PageBody>
        <PageHeader title="Role matrix" />
        <div className="mt-(--space-lg)">
          <PermissionMatrix roles={ROLES} modules={PERMISSION_MODULES} />
        </div>
      </PageBody>
    ),
  },
  {
    id: "reports/report-table",
    module: "reports",
    render: () => (
      <PageBody>
        <PageHeader title="Sales by item" />
        <div className="mt-(--space-lg)">
          <ReportTable result={REPORT} isLoading={false} />
        </div>
      </PageBody>
    ),
  },
  {
    id: "shared/section-tabs",
    module: "settings",
    render: () => (
      <PageBody>
        <SectionTabs
          label="Finance sections"
          tabs={[
            { href: "/app/finance", label: "Overview" },
            { href: "/app/finance/gl", label: "General ledger" },
            { href: "/app/finance/journal-entries", label: "Journal entries" },
            { href: "/app/finance/accounts", label: "Chart of accounts" },
            { href: "/app/finance/periods", label: "Periods" },
            { href: "/app/finance/takings", label: "Daily takings" },
            { href: "/app/finance/expenses", label: "Expenses" },
            { href: "/app/finance/ar-aging", label: "AR aging" },
            { href: "/app/finance/ap-aging", label: "AP aging" },
            { href: "/app/finance/house-accounts", label: "House accounts" },
            { href: "/app/finance/transactions", label: "Transactions" },
          ]}
        />
      </PageBody>
    ),
  },
  {
    id: "shared/form-dialog",
    module: "menu",
    render: () => (
      <Dialog open>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New menu item</DialogTitle>
            <DialogDescription>
              Items appear on the POS as soon as they are published to a branch.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-(--space-md)">
            <div className="grid gap-(--space-xs)">
              <Label htmlFor="fx-name">Name</Label>
              <Input id="fx-name" defaultValue="Chicken Karahi (Full)" />
            </div>
            <div className="grid gap-(--space-xs)">
              <Label htmlFor="fx-price">Price</Label>
              <Input id="fx-price" defaultValue="1,450.00" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline">Cancel</Button>
            <Button>Save item</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    ),
    bare: true,
  },
  {
    id: "pos/till-variance",
    module: "pos",
    render: () => (
      <PageBody>
        <PageHeader title="Tills" description="Every till of the day, individually." />
        <div className="mt-(--space-lg)">
          <TillVariancePanel
            tills={TILLS}
            cashierNames={new Map([["cashier-1", "Ayesha Siddiqui"]])}
          />
        </div>
      </PageBody>
    ),
  },
  {
    id: "purchasing/three-way-match",
    module: "purchasing",
    render: () => (
      <PageBody>
        <PageHeader title="Vendor invoice" />
        <Card className="mt-(--space-lg)">
          <CardContent>
            <ThreeWayMatchTable invoice={INVOICE} />
          </CardContent>
        </Card>
      </PageBody>
    ),
  },
  {
    id: "platform/impersonations",
    module: "platform",
    render: () => (
      <PageBody>
        <PageHeader title="Impersonations" />
        <div className="mt-(--space-lg)">
          <ImpersonationTable records={IMPERSONATIONS} showTenant />
        </div>
      </PageBody>
    ),
  },
  {
    id: "kds/ticket-card",
    module: "kds",
    render: () => (
      <PageBody fullBleed>
        <div
          data-surface="kds"
          className="grid grid-cols-1 gap-(--space-md) md:grid-cols-2 xl:grid-cols-4"
        >
          <KdsTicketCard ticket={KDS_TICKET} positionNumber={1} />
          <KdsTicketCard
            ticket={{ ...KDS_TICKET, id: "t-2", priority: false }}
            positionNumber={2}
          />
        </div>
      </PageBody>
    ),
    bare: true,
  },
];
