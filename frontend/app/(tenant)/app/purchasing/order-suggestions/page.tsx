"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";

import {
  useCreateDraftsFromSuggestions,
  useOrderSuggestions,
} from "@/lib/hooks/purchasing/use-purchasing";
import type {
  OrderSuggestion,
  OrderSuggestionVendorGroup,
} from "@/lib/adapters/purchasing.adapter";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { FieldHelp } from "@/components/shared/field-help";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Button } from "@/components/ui/button";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { Input } from "@/components/ui/input";
import { MoneyDisplay } from "@/components/ui/money-display";
import { Skeleton } from "@/components/ui/skeleton";

const cellClass = "px-3 py-2 text-small";
const headClass =
  "px-3 py-2 text-left text-label uppercase tracking-[0.04em] text-muted-foreground";

/** Keyed by vendorItemId — the only stable identifier a line carries all the way to a PO. */
type Overrides = Record<string, string>;

function lineQty(line: OrderSuggestion, overrides: Overrides): string {
  const override = overrides[line.vendorItemId ?? ""];
  return override !== undefined ? override : (line.orderQty ?? "");
}

function lineTotalPaisa(line: OrderSuggestion, overrides: Overrides): number {
  const qty = Number(lineQty(line, overrides));
  if (!Number.isFinite(qty) || line.unitPricePaisa == null) return 0;
  return Math.round(qty * line.unitPricePaisa);
}

// URL: /app/purchasing/order-suggestions — the first screen anywhere to read
// `ingredients.par_level`. Reorder point already drove low-stock alerts, so the system could say
// "something is low" but never "buy this much"; par level answers the second half and had no
// reader at all until now.
export default function OrderSuggestionsPage() {
  const { branchId } = useCurrentUser();
  const suggestionsQuery = useOrderSuggestions();
  const { data, isLoading } = suggestionsQuery;
  const createDrafts = useCreateDraftsFromSuggestions();

  // Everything orderable starts selected: the point of a suggestion list is that the common case
  // is "yes, order this". Deselecting is the exception, so it is the thing that takes a click.
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [overrides, setOverrides] = useState<Overrides>({});

  // Memoised because the `?? []` fallback allocates a fresh array on every render while the
  // query is still loading, which would make the `selectedLines` memo below recompute forever.
  const groups = useMemo(() => data?.vendorGroups ?? [], [data]);
  const unassigned = data?.unassigned ?? [];

  const selectedLines = useMemo(
    () =>
      groups
        .flatMap((group) => group.lines)
        .filter((line) => line.vendorItemId && !deselected.has(line.vendorItemId)),
    [groups, deselected],
  );

  const selectedTotalPaisa = selectedLines.reduce(
    (sum, line) => sum + lineTotalPaisa(line, overrides),
    0,
  );

  function toggle(vendorItemId: string) {
    setDeselected((current) => {
      const next = new Set(current);
      if (next.has(vendorItemId)) next.delete(vendorItemId);
      else next.add(vendorItemId);
      return next;
    });
  }

  function handleCreate() {
    const lines = selectedLines
      .map((line) => ({ vendorItemId: line.vendorItemId as string, qty: lineQty(line, overrides) }))
      .filter((line) => Number(line.qty) > 0);

    if (lines.length === 0) {
      toast.error("Select at least one line to order.");
      return;
    }

    createDrafts.mutate(
      { branchId, lines },
      {
        onSuccess: (drafts) => {
          toast.success(
            drafts.length === 1
              ? "Created 1 draft purchase order."
              : `Created ${drafts.length} draft purchase orders.`,
          );
          setDeselected(new Set());
          setOverrides({});
        },
        onError: (error) => {
          toast.error(error.message || "Could not create the drafts. Please try again.");
        },
      },
    );
  }

  // GA-001: with no `isError` read, a failed suggestion run rendered "Nothing needs ordering —
  // every item is above its reorder point." That is a purchasing all-clear issued by an outage,
  // and acting on it is how a kitchen runs out of stock mid-service.
  if (suggestionsQuery.isError) {
    return (
      <QueryErrorNotice
        what="order suggestions"
        error={suggestionsQuery.error}
        onRetry={() => void suggestionsQuery.refetch()}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="grid gap-2">
        <Skeleton className="h-10" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  const nothingToOrder = groups.length === 0 && unassigned.length === 0;

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Suggested orders"
        description="Everything that has dropped to its reorder point, with enough to bring it back up to its par level. Review the quantities, then create the orders."
        actions={
          selectedLines.length > 0 ? (
            <PermissionGuard require="vendor.po.create">
              <div className="flex items-center gap-(--space-md)">
                {/* UI-SPEC §7.4 — the selected count is always visible while a selection exists. */}
                <span className="text-small text-muted-foreground">
                  {selectedLines.length} line{selectedLines.length === 1 ? "" : "s"} ·{" "}
                  <MoneyDisplay
                    paisa={selectedTotalPaisa}
                    className="font-medium text-foreground"
                  />
                </span>
                <Button type="button" onClick={handleCreate} disabled={createDrafts.isPending}>
                  {createDrafts.isPending ? "Creating…" : "Create draft orders"}
                </Button>
              </div>
            </PermissionGuard>
          ) : null
        }
      />

      {nothingToOrder ? (
        <EmptyState
          title="Nothing needs ordering"
          description="Every item is above its reorder point at this branch."
        />
      ) : null}

      {groups.map((group) => (
        <VendorGroupTable
          key={group.vendorId}
          group={group}
          deselected={deselected}
          overrides={overrides}
          onToggle={toggle}
          onQtyChange={(vendorItemId, value) =>
            setOverrides((current) => ({ ...current, [vendorItemId]: value }))
          }
        />
      ))}

      {unassigned.length > 0 ? <UnassignedTable lines={unassigned} /> : null}
    </PageBody>
  );
}

interface VendorGroupTableProps {
  group: OrderSuggestionVendorGroup;
  deselected: Set<string>;
  overrides: Overrides;
  onToggle: (vendorItemId: string) => void;
  onQtyChange: (vendorItemId: string, value: string) => void;
}

/** One table per supplier, because one purchase order goes to exactly one supplier — the grouping
 * on screen is the grouping that will be created. */
function VendorGroupTable({
  group,
  deselected,
  overrides,
  onToggle,
  onQtyChange,
}: VendorGroupTableProps) {
  const selectedTotal = group.lines
    .filter((line) => line.vendorItemId && !deselected.has(line.vendorItemId))
    .reduce((sum, line) => sum + lineTotalPaisa(line, overrides), 0);

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h2 font-semibold">{group.vendorName ?? "Unnamed supplier"}</h2>
        <span className="text-small text-muted-foreground">
          {group.leadTimeDays != null ? `Arrives in about ${group.leadTimeDays} days · ` : ""}
          <MoneyDisplay paisa={selectedTotal} className="font-medium text-foreground" />
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[56rem]">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className={headClass}>
                <span className="sr-only">Include</span>
              </th>
              <th className={headClass}>Item</th>
              <th className={headClass}>
                <span className="inline-flex items-center gap-1.5">
                  On hand
                  <FieldHelp label="On hand">
                    What&apos;s left, against the reorder point that flagged it and the par level
                    it&apos;s being topped up to.
                  </FieldHelp>
                </span>
              </th>
              <th className={headClass}>
                <span className="inline-flex items-center gap-1.5">
                  Short by
                  <FieldHelp label="Short by">
                    Par level minus what&apos;s on hand — how much the shelf is missing, in the unit
                    you store it in.
                  </FieldHelp>
                </span>
              </th>
              <th className={headClass}>
                <span className="inline-flex items-center gap-1.5">
                  Order
                  <FieldHelp label="Order">
                    What to buy, in the supplier&apos;s own pack. Rounded up to whole packs and to
                    their minimum order, so it may come to slightly more than you&apos;re short.
                  </FieldHelp>
                </span>
              </th>
              <th className={headClass}>Unit price</th>
              <th className={headClass}>Line total</th>
            </tr>
          </thead>
          <tbody>
            {group.lines.map((line) => {
              const vendorItemId = line.vendorItemId as string;
              const included = !deselected.has(vendorItemId);
              return (
                <tr
                  key={vendorItemId}
                  className={`border-b last:border-b-0 ${included ? "" : "opacity-50"}`}
                >
                  <td className={cellClass}>
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={() => onToggle(vendorItemId)}
                      aria-label={`Include ${line.ingredientName}`}
                      className="size-4 rounded-sm border-input"
                    />
                  </td>
                  <td className={cellClass}>
                    <div className="font-medium">{line.ingredientName}</div>
                    <div className="text-small text-muted-foreground">
                      {[line.vendorSku, line.packDescription].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </td>
                  <td className={`${cellClass} text-muted-foreground`}>
                    {line.qtyOnHand} {line.stockUom}
                    <div className="text-small">
                      reorder at {line.reorderPoint} · par {line.parLevel}
                    </div>
                  </td>
                  <td className={cellClass}>
                    {line.shortfallQty} {line.stockUom}
                  </td>
                  <td className={cellClass}>
                    <div className="flex items-center gap-2">
                      <Input
                        inputMode="decimal"
                        value={lineQty(line, overrides)}
                        onChange={(event) => onQtyChange(vendorItemId, event.target.value)}
                        aria-label={`Order quantity for ${line.ingredientName}`}
                        className="h-8 w-24"
                      />
                      <span className="text-small text-muted-foreground">{line.orderUom}</span>
                    </div>
                  </td>
                  <td className={cellClass}>
                    {line.unitPricePaisa != null ? (
                      <MoneyDisplay paisa={line.unitPricePaisa} />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={cellClass}>
                    <MoneyDisplay paisa={lineTotalPaisa(line, overrides)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Items that are low but cannot be ordered yet, each with the server's reason. Shown rather than
 * dropped: a list that silently omits what it can't solve reads as "everything else is covered",
 * which is exactly the wrong thing for a stockout to be hiding behind.
 */
function UnassignedTable({ lines }: { lines: OrderSuggestion[] }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
        <h2 className="text-h2 font-semibold">Low, but needs setting up first ({lines.length})</h2>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[40rem]">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className={headClass}>Item</th>
              <th className={headClass}>On hand</th>
              <th className={headClass}>What&apos;s missing</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.ingredientId} className="border-b last:border-b-0">
                <td className={`${cellClass} font-medium`}>
                  {line.ingredientName}
                  {line.categoryName ? (
                    <div className="text-small font-normal text-muted-foreground">
                      {line.categoryName}
                    </div>
                  ) : null}
                </td>
                <td className={`${cellClass} text-muted-foreground`}>
                  {line.qtyOnHand} {line.stockUom}
                </td>
                <td className={cellClass}>{line.blockedReason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-small text-muted-foreground">
        Par levels are set on each item under{" "}
        <Link href="/app/inventory/ingredients" className="underline">
          Inventory → Ingredients
        </Link>
        . Suppliers and their pack sizes live on each vendor&apos;s catalogue.
      </p>
    </section>
  );
}
