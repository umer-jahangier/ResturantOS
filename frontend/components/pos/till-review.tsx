"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { MoneyDisplay } from "@/components/ui/money-display";
import { EmptyState } from "@/components/ui/empty-state";
import { useBranchTills, useTillReconciliation } from "@/lib/hooks/pos/use-till";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { TillSession } from "@/lib/models/pos.model";
import { cn } from "@/lib/utils";

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/**
 * Admin till-review (POS till reconciliation): a table of every till session for the branch
 * (opening/closing, cashier, float, expected/declared/variance) that expands into the session's
 * orders + cash collected. Backs "a table of tills the admin can review".
 */
export function TillReview() {
  const { branchId } = useCurrentUser();
  const { data: tills = [], isLoading, isFetching, refetch } = useBranchTills(branchId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!isLoading && tills.length === 0) {
    return (
      <div className="p-6">
        <EmptyState title="No till sessions yet" description="Opened and closed tills appear here for review." />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Till Review</h1>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-60"
        >
          <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} aria-hidden="true" />
          Refresh
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Opened</th>
              <th className="px-3 py-2 text-left">Closed</th>
              <th className="px-3 py-2 text-left">Cashier</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Float</th>
              <th className="px-3 py-2 text-right">Expected</th>
              <th className="px-3 py-2 text-right">Declared</th>
              <th className="px-3 py-2 text-right">Variance</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {tills.map((till) => (
              <TillRow
                key={till.id}
                till={till}
                expanded={selectedId === till.id}
                onToggle={() => setSelectedId(selectedId === till.id ? null : till.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TillRow({ till, expanded, onToggle }: { till: TillSession; expanded: boolean; onToggle: () => void }) {
  const variance = till.variancePaisa;
  return (
    <>
      <tr className="hover:bg-muted/30">
        <td className="px-3 py-2">{fmtTime(till.openedAt)}</td>
        <td className="px-3 py-2">{fmtTime(till.closedAt)}</td>
        <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{till.cashierId.slice(0, 8)}</td>
        <td className="px-3 py-2">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-xs font-medium",
              till.status === "OPEN" ? "bg-emerald-500/15 text-emerald-600" : "bg-muted text-muted-foreground",
            )}
          >
            {till.status}
          </span>
        </td>
        <td className="px-3 py-2 text-right"><MoneyDisplay paisa={till.openingFloatPaisa} className="text-xs" /></td>
        <td className="px-3 py-2 text-right">
          {till.expectedClosingPaisa !== null ? <MoneyDisplay paisa={till.expectedClosingPaisa} className="text-xs" /> : "—"}
        </td>
        <td className="px-3 py-2 text-right">
          {till.declaredClosingPaisa !== null ? <MoneyDisplay paisa={till.declaredClosingPaisa} className="text-xs" /> : "—"}
        </td>
        <td className={cn("px-3 py-2 text-right text-xs", variance !== null && variance < 0 && "text-red-600")}>
          {variance !== null ? <MoneyDisplay paisa={variance} className="text-xs" /> : "—"}
        </td>
        <td className="px-3 py-2 text-right">
          <button type="button" onClick={onToggle} className="text-xs font-medium text-primary underline">
            {expanded ? "Hide" : "Orders"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9} className="bg-muted/20 px-3 py-3">
            <TillReconciliationDetail tillId={till.id} />
          </td>
        </tr>
      )}
    </>
  );
}

function TillReconciliationDetail({ tillId }: { tillId: string }) {
  const { data: recon, isLoading } = useTillReconciliation(tillId);

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading orders…</p>;
  if (!recon) return <p className="text-xs text-muted-foreground">No data.</p>;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-4 text-xs">
        <span>Orders: <span className="font-medium">{recon.orderCount}</span></span>
        <span>Cash: <MoneyDisplay paisa={recon.cashCollectedPaisa} className="text-xs" /></span>
        <span>Non-cash: <MoneyDisplay paisa={recon.nonCashCollectedPaisa} className="text-xs" /></span>
        <span>Expected cash: <MoneyDisplay paisa={recon.liveExpectedCashPaisa} className="text-xs font-medium" /></span>
      </div>
      {recon.orders.length === 0 ? (
        <p className="text-xs text-muted-foreground">No orders in this till session.</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 text-left">Order</th>
              <th className="py-1 text-left">Status</th>
              <th className="py-1 text-right">Total</th>
              <th className="py-1 text-right">Paid</th>
            </tr>
          </thead>
          <tbody>
            {recon.orders.map((o) => (
              <tr key={o.orderId} className="border-t border-border/50">
                <td className="py-1">{o.orderNo ?? o.orderId.slice(0, 8)}</td>
                <td className="py-1">{o.status}</td>
                <td className="py-1 text-right"><MoneyDisplay paisa={o.totalPaisa} className="text-xs" /></td>
                <td className="py-1 text-right"><MoneyDisplay paisa={o.paidPaisa} className="text-xs" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
