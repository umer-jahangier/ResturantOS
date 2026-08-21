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
import { countLine, statLine } from "@/lib/format/stat-line";
import { FieldHelp } from "@/components/shared/field-help";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Button } from "@/components/ui/button";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { FilterBar } from "@/components/ui/filter-bar";
import { InsetRow } from "@/components/ui/inset-row";
import { Input } from "@/components/ui/input";
import { MoneyDisplay } from "@/components/ui/money-display";
import { Skeleton } from "@/components/ui/skeleton";

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
  const [search, setSearch] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");

  // Memoised because the `?? []` fallback allocates a fresh array on every render while the
  // query is still loading, which would make the `selectedLines` memo below recompute forever.
  const allGroups = useMemo(() => data?.vendorGroups ?? [], [data]);
  const allUnassigned = useMemo(() => data?.unassigned ?? [], [data]);

  // The filters narrow what is DISPLAYED. They deliberately do not narrow what is SELECTED: a
  // buyer who searches for "chicken", reviews it and presses Create must still get the drafts for
  // everything else they had already ticked. A filter that silently unselects is how a purchase
  // order arrives at a supplier missing half its lines.
  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allGroups
      .filter((group) => vendorFilter === "" || group.vendorId === vendorFilter)
      .map((group) =>
        needle === ""
          ? group
          : {
              ...group,
              lines: group.lines.filter((line) =>
                line.ingredientName.toLowerCase().includes(needle),
              ),
            },
      )
      .filter((group) => group.lines.length > 0);
  }, [allGroups, search, vendorFilter]);

  const unassigned = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (vendorFilter !== "") return [];
    return needle === ""
      ? allUnassigned
      : allUnassigned.filter((line) => line.ingredientName.toLowerCase().includes(needle));
  }, [allUnassigned, search, vendorFilter]);

  const selectedLines = useMemo(
    () =>
      allGroups
        .flatMap((group) => group.lines)
        .filter((line) => line.vendorItemId && !deselected.has(line.vendorItemId)),
    [allGroups, deselected],
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

  const nothingToOrder = allGroups.length === 0 && allUnassigned.length === 0;
  const isFiltered = search.trim() !== "" || vendorFilter !== "";
  const suggestedLineCount = allGroups.reduce((sum, group) => sum + group.lines.length, 0);
  const shownLineCount = groups.reduce((sum, group) => sum + group.lines.length, 0);

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Suggested orders"
        description="Everything that has dropped to its reorder point, with enough to bring it back up to its par level. Review the quantities, then create the orders."
        meta={statLine(
          countLine(suggestedLineCount, "item to order"),
          countLine(allGroups.length, "supplier"),
          allUnassigned.length > 0 ? `${allUnassigned.length} blocked` : null,
        )}
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
      ) : (
        <>
          <FilterBar
            title="Suggestions"
            search={{
              value: search,
              onChange: setSearch,
              label: "Search suggested items",
              placeholder: "Search by item…",
            }}
            filters={[
              {
                id: "vendor",
                label: "Supplier",
                value: vendorFilter,
                onChange: setVendorFilter,
                options: allGroups.map((group) => ({
                  value: group.vendorId,
                  label: group.vendorName ?? "Unnamed supplier",
                })),
              },
            ]}
          />

          {/* The three terms that need explaining, explained ONCE. They used to be column
              headers, each carrying its own popover — which meant three affordances per table and
              a fresh copy of each on every supplier. */}
          <p className="flex flex-wrap items-center gap-x-(--space-md) gap-y-1 text-small text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              On hand
              <FieldHelp label="On hand">
                What&apos;s left, against the reorder point that flagged it and the par level
                it&apos;s being topped up to.
              </FieldHelp>
            </span>
            <span className="inline-flex items-center gap-1.5">
              Short by
              <FieldHelp label="Short by">
                Par level minus what&apos;s on hand — how much the shelf is missing, in the unit you
                store it in.
              </FieldHelp>
            </span>
            <span className="inline-flex items-center gap-1.5">
              Order
              <FieldHelp label="Order">
                What to buy, in the supplier&apos;s own pack. Rounded up to whole packs and to their
                minimum order, so it may come to slightly more than you&apos;re short.
              </FieldHelp>
            </span>
          </p>

          {isFiltered && shownLineCount === 0 && unassigned.length === 0 ? (
            <EmptyState
              title="Nothing matches these filters."
              description="Try widening or clearing them to see more."
              action={{
                label: "Clear all",
                onClick: () => {
                  setSearch("");
                  setVendorFilter("");
                },
              }}
            />
          ) : null}
        </>
      )}

      {groups.map((group) => (
        <VendorGroupList
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

      {unassigned.length > 0 ? <UnassignedList lines={unassigned} /> : null}
    </PageBody>
  );
}

interface VendorGroupListProps {
  group: OrderSuggestionVendorGroup;
  deselected: Set<string>;
  overrides: Overrides;
  onToggle: (vendorItemId: string) => void;
  onQtyChange: (vendorItemId: string, value: string) => void;
}

/**
 * One list per supplier, because one purchase order goes to exactly one supplier — the grouping
 * on screen is the grouping that will be created.
 *
 * <h3>Why this is `InsetRow` and not `DataGrid` (a finding, not a shortcut)</h3>
 *
 * This screen is an editable worksheet, and it defeats the shared grid in two specific ways.
 * (1) `DataGrid`'s selection model starts EMPTY and owns its own state; here every orderable line
 * starts SELECTED, because the whole point of a suggestion list is that the common answer is
 * "yes, order this" — so the include box has to be a column the page controls, not the grid's.
 * (2) `DataGrid`'s mobile fallback is a card whose primary/secondary/trailing are read-only
 * projections of a row; a card that also had to carry the quantity editor would duplicate every
 * line's accessible name, which is worse for a screen-reader user than the table it replaced.
 *
 * <p>`InsetRow` is the right primitive instead: ONE representation that works at 390px and at
 * 1440px, no `<table>` at any width, and the editor sits in the row's own footer slot where it
 * has room. Recorded so the next reader does not "fix" this back to a grid.
 */
function VendorGroupList({
  group,
  deselected,
  overrides,
  onToggle,
  onQtyChange,
}: VendorGroupListProps) {
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

      <ul className="space-y-2">
        {group.lines.map((line) => {
          const vendorItemId = line.vendorItemId as string;
          const included = !deselected.has(vendorItemId);
          return (
            <InsetRow
              key={vendorItemId}
              as="li"
              className={included ? undefined : "opacity-50"}
              leading={
                <input
                  type="checkbox"
                  checked={included}
                  onChange={() => onToggle(vendorItemId)}
                  aria-label={`Include ${line.ingredientName}`}
                  className="size-5 rounded-sm border-input"
                />
              }
              primary={line.ingredientName}
              trailing={<MoneyDisplay paisa={lineTotalPaisa(line, overrides)} />}
              secondary={
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span>
                    {[line.vendorSku, line.packDescription].filter(Boolean).join(" · ") || "—"}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    On hand{" "}
                    <span className="text-foreground">
                      {line.qtyOnHand} {line.stockUom}
                    </span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Short by{" "}
                    <span className="font-medium text-foreground">
                      {line.shortfallQty} {line.stockUom}
                    </span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    reorder at {line.reorderPoint} · par {line.parLevel}
                  </span>
                </span>
              }
              footer={
                <span className="flex flex-wrap items-center gap-(--space-sm)">
                  <span className="flex items-center gap-2">
                    <Input
                      inputMode="decimal"
                      value={lineQty(line, overrides)}
                      onChange={(event) => onQtyChange(vendorItemId, event.target.value)}
                      aria-label={`Order quantity for ${line.ingredientName}`}
                      className="h-11 w-24"
                    />
                    <span className="text-small text-muted-foreground">{line.orderUom}</span>
                  </span>
                  <span className="text-small text-muted-foreground">
                    at{" "}
                    {line.unitPricePaisa != null ? (
                      <MoneyDisplay paisa={line.unitPricePaisa} />
                    ) : (
                      "—"
                    )}{" "}
                    each
                  </span>
                </span>
              }
            />
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Items that are low but cannot be ordered yet, each with the server's reason. Shown rather than
 * dropped: a list that silently omits what it can't solve reads as "everything else is covered",
 * which is exactly the wrong thing for a stockout to be hiding behind.
 */
function UnassignedList({ lines }: { lines: OrderSuggestion[] }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 text-warning" aria-hidden="true" />
        <h2 className="text-h2 font-semibold">Low, but needs setting up first ({lines.length})</h2>
      </div>

      <ul className="space-y-2">
        {lines.map((line) => (
          <InsetRow
            key={line.ingredientId}
            as="li"
            primary={line.ingredientName}
            secondary={
              <span className="flex flex-wrap items-center gap-x-1.5">
                {line.categoryName ? (
                  <>
                    <span>{line.categoryName}</span>
                    <span aria-hidden="true">·</span>
                  </>
                ) : null}
                <span>
                  On hand{" "}
                  <span className="text-foreground">
                    {line.qtyOnHand} {line.stockUom}
                  </span>
                </span>
              </span>
            }
            footer={<span className="text-warning">{line.blockedReason}</span>}
          />
        ))}
      </ul>

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
