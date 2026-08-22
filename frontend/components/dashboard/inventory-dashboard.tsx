"use client";

import { useMemo } from "react";
import { PackageSearch, PackageX, Truck, Warehouse } from "lucide-react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PortletGrid, type PortletModels } from "@/components/dashboard/portlets/portlet-renderer";
import type { ExceptionRow, RankedRow } from "@/components/dashboard/portlets/portlet";
import { DASHBOARD_PRESETS, type InventoryPortlets } from "@/components/dashboard/presets";
import { MoneyDisplay } from "@/components/ui/money-display";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { formatDateTime, formatNumber } from "@/lib/format/locale";
import { useStockLevels } from "@/lib/hooks/inventory/use-inventory";
import { usePurchaseOrders, useVendors } from "@/lib/hooks/purchasing/use-purchasing";
import type { StockLevel } from "@/lib/adapters/inventory.adapter";
import type { PoStatus } from "@/lib/models/purchasing-status";

const PRESET = DASHBOARD_PRESETS.inventory;

/** Ordered, not yet on the shelf. `CLOSED`/`FULLY_RECEIVED`/`REJECTED` are all finished. */
const OUTSTANDING_PO_STATUSES: PoStatus[] = ["APPROVED", "SENT", "PARTIALLY_RECEIVED"];

/**
 * A BigDecimal that arrived as a string, as a number — or `null` when it did not arrive.
 *
 * <p>`qtyOnHand` and `reorderPoint` are `NUMERIC` server-side and reach the browser as either a
 * JSON string or a JSON number (`inventory.schema.ts:8` coerces both to string). `Number("")`
 * is `0` and `Number(undefined)` is `NaN`, and both would render as a confident quantity, so
 * this returns null instead and every caller states the absence rather than a zero (D-38-16).
 */
function qty(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * How much of its reorder point an ingredient still has, 0..1.
 *
 * <p>This is the ONE ranking on this page that draws a bar, and it draws one because it has a
 * real denominator: "3 kg left against a 10 kg reorder point" is 0.3 of the way to the line the
 * business itself drew. `null` where either number is missing — a bar of unknown length is the
 * `manager-86d` defect (`fraction: 1` on every row, encoding nothing) in a new place.
 */
function coverage(item: StockLevel): number | null {
  const onHand = qty(item.qtyOnHand);
  const reorder = qty(item.reorderPoint);
  if (onHand === null || reorder === null || reorder <= 0) return null;
  return Math.max(0, Math.min(1, onHand / reorder));
}

/**
 * INVENTORY_MANAGER dashboard — "What am I about to run out of?" (PROVISIONAL question; see
 * `presets.ts`, which is where to change it).
 *
 * <h3>What this role saw before phase 38</h3>
 *
 * Nothing. `resolveDashboardPreset` had no INVENTORY_MANAGER branch, so the role fell through to
 * the final `return "cashier"` — and every tile of the cashier preset needs `pos.till.open` or
 * `pos.order.view`, neither of which this role holds. `visiblePortlets` therefore returned
 * exactly one portlet, the ungated `Shortcuts` slot, and an inventory manager signing in landed
 * on a page headed *"Where is my till, and what is still open?"* with **zero numbers** and a
 * 72px **Open POS** button for a POS they hold no `pos.order.create` for.
 *
 * <h3>Every figure here has a named source, and none of them is a cost</h3>
 *
 * `belowReorderPoint` and `nonPositive` are computed SERVER-side and returned on each stock row
 * (`StockLevelDtos.StockLevelDto`), so this page's counts and the stock screen's row wash cannot
 * drift apart; `totalStockValuePaisa` is the response envelope's own total, not a browser-side
 * sum of a per-unit rate. The purchase-order figures are the branch's own PO list filtered to
 * the three statuses that mean "ordered, not yet received".
 *
 * <p><b>Deliberately absent: Food Cost %.</b> The demo puts it on the inventory screen and
 * D-38-16 names it first among the seventeen figures this system cannot compute — there is no
 * aggregate food-cost figure anywhere, only a per-recipe preview
 * (`RecipeCostPreviewService.java:158-167`) that is null whenever the item has no price. It is
 * not rendered as an unavailable tile here either, because it is not a question an inventory
 * manager can act on: the honest place for that absence is the accountant's page, where a P&L
 * figure belongs, and it is on that page.
 */
export function InventoryDashboard() {
  const { branchId, permissions } = useCurrentUser();

  const stockQuery = useStockLevels();
  const posQuery = usePurchaseOrders(branchId, OUTSTANDING_PO_STATUSES);
  const vendorsQuery = useVendors();

  const stock = useMemo(() => stockQuery.data?.items ?? [], [stockQuery.data]);
  const purchaseOrders = useMemo(() => posQuery.data ?? [], [posQuery.data]);
  const vendors = useMemo(() => vendorsQuery.data ?? [], [vendorsQuery.data]);

  const vendorName = useMemo(() => {
    const byId = new Map(vendors.map((v) => [v.id, v.name]));
    return (id: string) => byId.get(id) ?? "Unnamed vendor";
  }, [vendors]);

  const belowReorder = useMemo(() => stock.filter((i) => i.belowReorderPoint), [stock]);
  const outOfStock = useMemo(() => stock.filter((i) => i.nonPositive), [stock]);
  // No `?? 0`: the accountant dashboard argues in prose that "a `paisa={total ?? 0}` left in the
  // source is a fabricated zero waiting for the day somebody removes the boundary", and two
  // sibling dashboards should not disagree about that. Unreachable today (the schema types the
  // field as required and QueryBoundary resolves before children render) — which is precisely
  // when it is cheap to remove.
  const totalStockValuePaisa = stockQuery.data?.totalStockValuePaisa ?? null;

  /** Ranked by how little of the reorder point is left — the emptiest shelf first. */
  const shortfalls = useMemo<RankedRow[]>(
    () =>
      belowReorder
        .map((item) => ({ item, fraction: coverage(item) }))
        .sort((a, b) => (a.fraction ?? 0) - (b.fraction ?? 0))
        .slice(0, 6)
        .map(({ item, fraction }) => ({
          key: item.ingredientId,
          label: item.ingredientName,
          value: `${formatNumber(qty(item.qtyOnHand))} of ${formatNumber(
            qty(item.reorderPoint),
          )} ${item.baseUomCode}`,
          // Omitted rather than defaulted when either quantity is missing — see `coverage`.
          ...(fraction === null ? {} : { fraction }),
        })),
    [belowReorder],
  );

  const poRows = useMemo(
    () =>
      purchaseOrders.slice(0, 6).map((po) => ({
        key: po.id,
        primary: vendorName(po.vendorId),
        secondary: `${po.status.replace(/_/g, " ").toLowerCase()} · ${
          po.expectedDeliveryDate
            ? `due ${formatDateTime(po.expectedDeliveryDate, {
                day: "2-digit",
                month: "short",
              })}`
            : "no delivery date"
        }`,
        trailing: <MoneyDisplay paisa={po.totalPaisa} />,
      })),
    [purchaseOrders, vendorName],
  );

  const exceptions = useMemo<ExceptionRow[]>(() => {
    const rows: ExceptionRow[] = outOfStock.slice(0, 4).map((item) => ({
      key: `out-${item.ingredientId}`,
      label: `${item.ingredientName} is out of stock`,
      detail: `Nothing on hand against a ${formatNumber(qty(item.reorderPoint))} ${
        item.baseUomCode
      } reorder point`,
      severity: "danger" as const,
      icon: <PackageX />,
    }));
    // Never counted is a different problem from "counted and low": the on-hand figure for such
    // an ingredient is an opening balance nobody has ever verified, so every number above that
    // depends on it is provisional. Said once, as a CHECK, rather than folded into the count.
    const neverCounted = stock.filter((i) => !i.lastCountedAt);
    if (neverCounted.length > 0) {
      rows.push({
        key: "never-counted",
        label: `${neverCounted.length} ingredient${neverCounted.length === 1 ? " has" : "s have"} never been counted`,
        detail: "On-hand for these is the opening balance, unverified by a physical count",
        severity: "warning" as const,
        icon: <PackageSearch />,
      });
    }
    return rows.slice(0, 6);
  }, [outOfStock, stock]);

  const models: PortletModels<InventoryPortlets> = {
    "inventory-below-reorder": {
      kind: "KpiTile",
      accent: "warning",
      icon: PackageSearch,
      value: formatNumber(belowReorder.length),
      caption: `Of ${formatNumber(stock.length)} ingredient${stock.length === 1 ? "" : "s"} stocked`,
      tone: belowReorder.length > 0 ? "warning" : "neutral",
      boundary: { query: stockQuery, what: "stock levels" },
    },
    "inventory-out-of-stock": {
      kind: "KpiTile",
      accent: "danger",
      icon: PackageX,
      value: formatNumber(outOfStock.length),
      caption: "Nothing on hand at all",
      tone: outOfStock.length > 0 ? "danger" : "neutral",
      boundary: { query: stockQuery, what: "stock levels" },
    },
    "inventory-stock-value":
      totalStockValuePaisa === null
        ? {
            kind: "KpiTile",
            accent: "primary",
            icon: Warehouse,
            caption: "Valued at weighted average cost",
            unavailableReason: "Stock valuation has not been returned for this branch.",
            boundary: { query: stockQuery, what: "stock levels" },
          }
        : {
            kind: "KpiTile",
            accent: "primary",
            icon: Warehouse,
            value: <MoneyDisplay paisa={totalStockValuePaisa} />,
            caption: "Valued at weighted average cost",
            boundary: { query: stockQuery, what: "stock levels" },
          },
    "inventory-incoming": {
      kind: "KpiTile",
      accent: "info",
      icon: Truck,
      value: formatNumber(purchaseOrders.length),
      caption: "Ordered and not yet fully received",
      boundary: {
        query: posQuery,
        what: "purchase orders",
        stillWorks: "Stock levels are still live.",
      },
    },
    "inventory-shortfalls": {
      kind: "RankedList",
      accent: "warning",
      rows: shortfalls,
      emptyLabel: "Nothing is below its reorder point.",
      boundary: { query: stockQuery, what: "stock levels" },
    },
    "inventory-open-orders": {
      kind: "RecordList",
      rows: poRows,
      emptyLabel: "No purchase order is outstanding.",
      // Both, as a unit: a PO list rendered without its vendor names would show six rows all
      // reading "Unnamed vendor", which is a worse answer than saying the list is unavailable.
      boundary: { query: [posQuery, vendorsQuery], what: "purchase orders" },
    },
    "inventory-exceptions": {
      kind: "ExceptionList",
      rows: exceptions,
      emptyLabel: "Nothing needs you right now.",
      boundary: { query: stockQuery, what: "the exception list" },
    },
  };

  return (
    <DashboardShell preset={PRESET}>
      <PortletGrid preset={PRESET} permissions={permissions} models={models} />
    </DashboardShell>
  );
}
