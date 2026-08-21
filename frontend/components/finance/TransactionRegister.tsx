"use client";

import { Fragment, useMemo, useState } from "react";
import { formatPaisa } from "@/lib/adapters/shared";
import { useTransactionRegister } from "@/lib/hooks/finance/use-transactions";
import { TransactionLedgerLinks } from "@/components/finance/TransactionLedgerLinks";
import type { TransactionEventKind } from "@/lib/models/transaction.model";
import { cn } from "@/lib/utils";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const KIND_STYLES: Record<TransactionEventKind, string> = {
  TENDER: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  REFUND: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  VOID: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};

/**
 * The transaction register (37-11, D-37-01).
 *
 * Every money event — tender, refund, void — filterable, with a path from any row to the order
 * behind it and the accounting entries it produced.
 */
export function TransactionRegister() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [tenderMethod, setTenderMethod] = useState("");
  const [kinds, setKinds] = useState<TransactionEventKind[]>([]);
  const [page, setPage] = useState(0);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      from,
      to,
      tenderMethod: tenderMethod || undefined,
      eventKinds: kinds.length ? kinds : undefined,
      page,
      size: 50,
    }),
    [from, to, tenderMethod, kinds, page],
  );

  const { data, isLoading: loading, error: queryError } = useTransactionRegister(filters);
  // D-37-05: never render a plausible zero. If the figure cannot be computed, say so and say
  // why — a blank screen is better than a fabricated total someone acts on.
  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : "Could not load transactions"
    : null;

  function toggleKind(k: TransactionEventKind) {
    setPage(0);
    setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  }

  return (
    <div className="space-y-4">
      {/* ── Filters ─────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3 rounded border p-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setPage(0);
              setFrom(e.target.value);
            }}
            className="rounded border bg-background px-2 py-1"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setPage(0);
              setTo(e.target.value);
            }}
            className="rounded border bg-background px-2 py-1"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Tender</span>
          <select
            value={tenderMethod}
            onChange={(e) => {
              setPage(0);
              setTenderMethod(e.target.value);
            }}
            className="rounded border bg-background px-2 py-1"
          >
            <option value="">Any</option>
            <option value="CASH">Cash</option>
            <option value="CARD">Card</option>
            <option value="WALLET">Wallet</option>
          </select>
        </label>
        <div className="text-sm">
          <span className="mb-1 block text-muted-foreground">Show</span>
          <div className="flex gap-1">
            {(["TENDER", "REFUND", "VOID"] as TransactionEventKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => toggleKind(k)}
                className={cn(
                  "rounded border px-2 py-1 text-xs",
                  kinds.includes(k) ? "border-primary bg-primary/10" : "text-muted-foreground",
                )}
              >
                {k === "TENDER" ? "Payments" : k === "REFUND" ? "Refunds" : "Voids"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Totals for the WHOLE filtered range, not this page ──────────────────────── */}
      {data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Taken in", value: data.tenderedPaisa },
            { label: "Refunded", value: data.refundedPaisa },
            { label: "Voided", value: data.voidedPaisa },
            { label: "Net", value: data.netAmountPaisa },
          ].map((t) => (
            <div key={t.label} className="rounded border p-3">
              <p className="text-xs text-muted-foreground">{t.label}</p>
              <p className="text-lg font-semibold tabular-nums">{formatPaisa(t.value)}</p>
            </div>
          ))}
          <p className="col-span-full text-xs text-muted-foreground">
            Totals cover the whole filtered range ({data.totalRows} events), not just this page.
          </p>
        </div>
      )}

      {/* ── The register ────────────────────────────────────────────────────────────── */}
      {loading && <p className="text-sm text-muted-foreground">Loading transactions…</p>}

      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">Transactions could not be loaded</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      )}

      {!loading && !error && data && data.rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No money moved in this period with these filters.
        </p>
      )}

      {!loading && !error && data && data.rows.length > 0 && (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2 font-medium">When</th>
                <th className="p-2 font-medium">Type</th>
                <th className="p-2 font-medium">Order</th>
                <th className="p-2 font-medium">Tender</th>
                <th className="p-2 text-right font-medium">Amount</th>
                <th className="p-2 text-right font-medium">Order total</th>
                <th className="p-2 font-medium">Trace</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => {
                const key = `${r.orderId}-${r.eventKind}-${r.eventAt.toISOString()}-${i}`;
                const isOpen = expanded === key;
                return (
                  // Fragment must be the KEYED element: a bare <> inside a map carries no key,
                  // so React cannot track rows across a filter change and warns.
                  <Fragment key={key}>
                    <tr className="border-t">
                      <td className="p-2 whitespace-nowrap tabular-nums">
                        {r.eventAt.toLocaleString()}
                      </td>
                      <td className="p-2">
                        <span
                          className={cn("rounded px-1.5 py-0.5 text-xs", KIND_STYLES[r.eventKind])}
                        >
                          {r.eventKind === "TENDER"
                            ? "Payment"
                            : r.eventKind === "REFUND"
                              ? "Refund"
                              : "Void"}
                        </span>
                      </td>
                      <td className="p-2 font-medium">{r.orderNo}</td>
                      <td className="p-2">{r.tenderMethod ?? "—"}</td>
                      <td
                        className={cn(
                          "p-2 text-right font-medium tabular-nums",
                          r.eventAmountPaisa < 0 && "text-destructive",
                        )}
                      >
                        {formatPaisa(r.eventAmountPaisa)}
                      </td>
                      {/* Marked as the ORDER's, deliberately — see the model's comment on why
                          these must not be summed down the column. */}
                      <td className="p-2 text-right tabular-nums text-muted-foreground">
                        {formatPaisa(r.orderTotalPaisa)}
                      </td>
                      <td className="p-2">
                        <button
                          type="button"
                          onClick={() => {
                            setExpanded(isOpen ? null : key);
                            setExpandedOrderId(isOpen ? null : r.orderId);
                          }}
                          className="text-primary underline underline-offset-2"
                        >
                          {isOpen ? "Hide" : "Open"}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-t bg-muted/20">
                        <td colSpan={7} className="p-3">
                          <div className="space-y-3">
                            <div className="text-sm">
                              <span className="text-muted-foreground">Order </span>
                              <span className="font-medium">{r.orderNo}</span>
                              <span className="text-muted-foreground"> · status </span>
                              <span>{r.orderStatus}</span>
                              {r.reason && (
                                <>
                                  <span className="text-muted-foreground"> · reason </span>
                                  <span>{r.reason}</span>
                                </>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              Order totals — subtotal {formatPaisa(r.orderSubtotalPaisa)} · discount{" "}
                              {formatPaisa(r.orderDiscountPaisa)} · tax{" "}
                              {formatPaisa(r.orderTaxPaisa)} · service{" "}
                              {formatPaisa(r.orderServiceChargePaisa)} · total{" "}
                              {formatPaisa(r.orderTotalPaisa)}
                            </div>
                            {expandedOrderId === r.orderId && (
                              <TransactionLedgerLinks orderId={r.orderId} />
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data && data.totalRows > data.size && (
        <div className="flex items-center gap-3 text-sm">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="rounded border px-2 py-1 disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-muted-foreground">
            Page {data.page + 1} of {Math.max(1, Math.ceil(data.totalRows / data.size))}
          </span>
          <button
            type="button"
            disabled={(page + 1) * data.size >= data.totalRows}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border px-2 py-1 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
