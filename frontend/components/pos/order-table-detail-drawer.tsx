"use client";

import { useMemo, useState } from "react";
import { ArrowRight, MessageSquare, Search } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { MoneyDisplay } from "@/components/ui/money-display";
import { Input } from "@/components/ui/input";
import { RevisionBadge, RevisionCountChip, deriveRevisionLog } from "@/components/pos/revision-chip";
import { SettlementActions } from "@/components/pos/settlement-actions";
import { useOrder, useMarkServed, useUpdateInstructions, useAddItem } from "@/lib/hooks/pos/use-orders";
import { useTableDetail } from "@/lib/hooks/pos/use-tables";
import { useMenuItems } from "@/lib/hooks/pos/use-menu";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { getOrderDisplayStatus, type MenuItem, type Order } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

/**
 * The ONE shared Order/Table Detail drawer (UI-SPEC §1/§2, POS-09/POS-10) — resolves
 * either an `orderId` (Order Management row-click) or a `tableId` (Table Floor View
 * OCCUPIED/NEEDS_BUSSING tap) into the same order-detail rendering. Never fork a second
 * "detail" UI — Table Floor View (plan 10) reuses this component verbatim.
 */
interface OrderTableDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Order-centric open (Order Management). Mutually exclusive with `tableId`. */
  orderId?: string | null;
  /** Table-centric open (Table Floor View). Mutually exclusive with `orderId`. */
  tableId?: string | null;
  /**
   * Optional caller-supplied table name (e.g. from an Order Management row's
   * `OrderSummary.tableName`) so the header can show a table name immediately in
   * order-centric mode, without waiting on a second `useTableDetail` fetch.
   */
  tableName?: string | null;
  /**
   * "Full Menu →" escape hatch (UI-SPEC §2 Assumption 5): switches the page to the
   * Terminal tab, optionally preloaded with a tableId. Table-centric callers get a real
   * tableId; order-centric callers pass the order's own `tableId` if it has one
   * (TAKEAWAY/DELIVERY orders have none — Full Menu still switches tabs, just unbound).
   */
  onFullMenu?: (tableId: string | null) => void;
}

const SETTLED_STATUSES: ReadonlySet<Order["status"]> = new Set(["CLOSED", "VOIDED", "REFUNDED"]);

export function OrderTableDetailDrawer({
  open,
  onOpenChange,
  orderId,
  tableId,
  tableName,
  onFullMenu,
}: OrderTableDetailDrawerProps) {
  const { branchId } = useCurrentUser();
  const isTableMode = !orderId && !!tableId;

  const orderQuery = useOrder(orderId ?? "");
  const tableQuery = useTableDetail(isTableMode ? (tableId ?? "") : "");

  const order: Order | null = isTableMode ? (tableQuery.data?.activeOrder ?? null) : (orderQuery.data ?? null);
  const isLoading = isTableMode ? tableQuery.isLoading : orderQuery.isLoading;
  const resolvedTableId = order?.tableId ?? tableId ?? null;
  const resolvedTableName = isTableMode ? (tableQuery.data?.tableName ?? tableName ?? null) : (tableName ?? null);

  const revisions = useMemo(() => (order ? deriveRevisionLog(order.items) : []), [order]);
  const displayStatus = order ? getOrderDisplayStatus(order) : null;
  const isSettled = order ? SETTLED_STATUSES.has(order.status) : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="order-table-detail-drawer"
        className={cn(
          "fixed inset-y-0 top-0 right-0 left-auto h-full w-full max-w-[calc(100%-2rem)]",
          "translate-x-0 translate-y-0 flex flex-col gap-0 rounded-none border-l p-0",
          "sm:w-[420px] sm:max-w-[420px]",
          "data-open:slide-in-from-right data-open:fade-in-0 data-open:zoom-in-100",
          "data-closed:slide-out-to-right data-closed:fade-out-0 data-closed:zoom-out-100",
        )}
      >
        <DialogHeader className="shrink-0 space-y-1.5 border-b px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle>
              {order ? `Order #${order.orderNo ?? order.id.slice(0, 8)}` : "Order Details"}
            </DialogTitle>
            {displayStatus && <StatusBadge status={displayStatus} />}
          </div>
          {order && (
            <p className="text-xs text-muted-foreground">
              {resolvedTableName ? `Table ${resolvedTableName}` : order.type.replace("_", " ")}
              {order.coverCount > 0 ? ` · ${order.coverCount} cover(s)` : ""}
            </p>
          )}
          {revisions.length > 0 && <RevisionCountChip revisions={revisions} />}
        </DialogHeader>

        {isLoading ? (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
            Loading order…
          </div>
        ) : !order ? (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
            No active order found.
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto divide-y">
              {order.items.length === 0 ? (
                <div className="flex h-20 items-center justify-center text-sm text-muted-foreground">
                  No items yet
                </div>
              ) : (
                order.items.map((item) => (
                  <DrawerLineItem key={item.id} item={item} orderId={order.id} />
                ))
              )}
            </div>

            <InstructionsField orderId={order.id} notes={order.notes} disabled={isSettled} />

            {!isSettled && (
              <QuickAddSearch
                orderId={order.id}
                branchId={branchId}
                tableId={resolvedTableId}
                onFullMenu={onFullMenu}
              />
            )}

            <div className="shrink-0 border-t px-4 py-3">
              <SettlementActions order={order} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Line item row ────────────────────────────────────────────────────────────

interface DrawerLineItemProps {
  item: Order["items"][number];
  orderId: string;
}

function DrawerLineItem({ item, orderId }: DrawerLineItemProps) {
  const markServed = useMarkServed(orderId);
  const isActive =
    item.itemStatus !== "PENDING" && item.itemStatus !== "CANCELLED" && item.itemStatus !== "SERVED";

  return (
    <div className="flex flex-col gap-1.5 px-4 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p
              className={cn(
                "truncate text-sm font-medium",
                item.itemStatus === "CANCELLED" && "line-through text-muted-foreground",
              )}
            >
              {item.itemNameSnapshot}
            </p>
            <RevisionBadge revisionNo={item.revisionNo} />
          </div>
          {item.notes && (
            <p className="text-xs italic text-muted-foreground">Note: {item.notes}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-xs tabular-nums">×{item.quantity}</span>
          <MoneyDisplay paisa={item.lineTotalPaisa} className="font-mono text-xs" />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <StatusBadge status={item.itemStatus} className="text-[10px]" />
        {isActive && (
          <button
            type="button"
            onClick={() => markServed.mutate(item.id)}
            disabled={markServed.isPending}
            aria-label={`Mark ${item.itemNameSnapshot} served`}
            className="rounded border border-success px-2 py-1 text-xs text-success hover:bg-success/10 disabled:opacity-50"
          >
            Mark Served
          </button>
        )}
      </div>
    </div>
  );
}

// ── Order-level instructions (POS-13) ──────────────────────────────────────────

interface InstructionsFieldProps {
  orderId: string;
  notes: string | null;
  disabled: boolean;
}

function InstructionsField({ orderId, notes, disabled }: InstructionsFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes ?? "");
  const updateInstructions = useUpdateInstructions(orderId);

  const save = () => {
    updateInstructions.mutate({ notes: draft });
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="shrink-0 border-t px-4 py-2">
        <button
          type="button"
          onClick={() => {
            setDraft(notes ?? "");
            setEditing(true);
          }}
          disabled={disabled}
          className="flex w-full items-start gap-1.5 text-left text-xs text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <MessageSquare className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {notes ? <span className="italic">{notes}</span> : <span className="text-primary underline">+ Add note</span>}
        </button>
      </div>
    );
  }

  return (
    <div className="shrink-0 space-y-1 border-t px-4 py-2">
      <label className="flex items-center gap-1.5 text-xs font-semibold">
        <MessageSquare className="size-3.5" aria-hidden="true" />
        Special Instructions
      </label>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        maxLength={240}
        rows={2}
        placeholder="e.g. Birthday — bring cake last"
        aria-label="Special instructions"
        className="w-full resize-none rounded border bg-background px-2 py-1.5 text-xs"
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{draft.length}/240</span>
        <div className="flex gap-2">
          <button type="button" onClick={() => setEditing(false)} className="rounded border px-2 py-1 text-xs">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Quick Add search (UI-SPEC §2, drawer-embedded add-on path) ─────────────────

interface QuickAddSearchProps {
  orderId: string;
  branchId: string;
  tableId: string | null;
  onFullMenu?: (tableId: string | null) => void;
}

function QuickAddSearch({ orderId, branchId, tableId, onFullMenu }: QuickAddSearchProps) {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 150);
  const { data: items = [] } = useMenuItems();
  const addItem = useAddItem();

  const trimmed = debouncedQuery.trim().toLowerCase();
  const results = trimmed
    ? items.filter((i) => i.active && i.name.toLowerCase().includes(trimmed)).slice(0, 6)
    : [];

  const handleAdd = async (item: MenuItem) => {
    try {
      await addItem.mutateAsync({ orderId, payload: { menuItemId: item.id, branchId, quantity: 1 } });
      toast.success(`${item.name} added`);
      setQuery("");
    } catch {
      toast.error("Failed to add item. Please try again.");
    }
  };

  return (
    <div className="shrink-0 space-y-2 border-t px-4 py-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1.5 text-xs font-semibold">
          <Search className="size-3.5" aria-hidden="true" />
          Quick Add
        </label>
        <button
          type="button"
          onClick={() => onFullMenu?.(tableId)}
          className="inline-flex items-center gap-1 text-xs text-primary underline"
        >
          Full Menu <ArrowRight className="size-3" aria-hidden="true" />
        </button>
      </div>
      <Input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search menu…"
        aria-label="Search menu"
        className="h-10"
      />
      {results.length > 0 && (
        <ul data-testid="quick-add-results" className="flex flex-col divide-y rounded border">
          {results.map((item) => (
            <li key={item.id} className="flex items-center justify-between px-2 py-1.5 text-sm">
              <span className="truncate">{item.name}</span>
              <div className="flex shrink-0 items-center gap-2">
                <MoneyDisplay paisa={item.basePricePaisa} className="text-xs text-muted-foreground" />
                <button
                  type="button"
                  onClick={() => void handleAdd(item)}
                  disabled={addItem.isPending}
                  className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
