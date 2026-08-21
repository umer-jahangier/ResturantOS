"use client";

import { useMemo, useState } from "react";

import { useTransactionRegister } from "@/lib/hooks/finance/use-transactions";
import { TransactionLedgerLinks } from "@/components/finance/TransactionLedgerLinks";
import { LedgerStatRow } from "@/components/finance/LedgerTotalRow";
import { Button } from "@/components/ui/button";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { FilterBar } from "@/components/ui/filter-bar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyDisplay } from "@/components/ui/money-display";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusBadge } from "@/components/ui/status-badge";
import type { TransactionEventKind, TransactionRow } from "@/lib/models/transaction.model";
import { cn } from "@/lib/utils";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * The three event kinds, each with a word and an icon-bearing badge — never a hue alone.
 *
 * <p>This map used to be twelve raw palette literals (`bg-emerald-50 text-emerald-700
 * dark:bg-emerald-950 …`), which follow neither the theme nor `--brand-h` and which put the
 * ENTIRE distinction between a payment, a refund and a void into colour. The shared badge carries
 * the hue through tokens and the label through words.
 */
const KIND_BADGE: Record<TransactionEventKind, { status: "success" | "warning" | "error"; label: string }> = {
  TENDER: { status: "success", label: "Payment" },
  REFUND: { status: "warning", label: "Refund" },
  VOID: { status: "error", label: "Void" },
};

const TENDER_OPTIONS = [
  { value: "CASH", label: "Cash" },
  { value: "CARD", label: "Card" },
  { value: "WALLET", label: "Wallet" },
];

/**
 * The transaction register (37-11, D-37-01).
 *
 * Every money event — tender, refund, void — filterable, with a path from any row to the order
 * behind it and the accounting entries it produced.
 *
 * <h3>Why the detail is a panel below the grid, not an expanding row</h3>
 *
 * It was a second `<tr>` injected under the clicked one, carrying a `colSpan={7}` cell. `DataGrid`
 * paginates, sorts and mirrors every row into a card list below `md`, and none of those three can
 * express "and also this other row belongs to that one" — a sorted grid would separate the pair,
 * and the card list has no colspan at all. So the row OPENS a panel that sits under the grid,
 * which also fixes something the inline version got wrong: at 390px the expansion was a
 * seven-column-wide cell inside a horizontally-scrolled table, so the ledger links a user had
 * just asked for were off-screen.
 *
 * <h3>The four totals are the SERVER'S, over the whole filtered range</h3>
 *
 * Not this page, and not summed here. `orderTotalPaisa` on a row is the ORDER's figure and is
 * deliberately not summable — a split-tender order appears on two rows and adding that column
 * double-counts it. The register states each row's own `eventAmountPaisa` and the server states
 * the aggregates; there is no arithmetic in this file.
 */
export function TransactionRegister() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [tenderMethod, setTenderMethod] = useState("");
  const [kinds, setKinds] = useState<TransactionEventKind[]>([]);
  const [page, setPage] = useState(0);

  const [openRow, setOpenRow] = useState<{ key: string; row: TransactionRow } | null>(null);

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

  const rowKey = (r: TransactionRow, i: number) =>
    `${r.orderId}-${r.eventKind}-${r.eventAt.toISOString()}-${i}`;

  const columns = useMemo<ColumnDef<TransactionRow, unknown>[]>(
    () => [
      {
        id: "when",
        header: "When",
        accessorFn: (r) => r.eventAt.getTime(),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.eventAt.toLocaleString()}</span>
        ),
      },
      {
        id: "kind",
        accessorKey: "eventKind",
        header: "Type",
        cell: ({ row }) => {
          const badge = KIND_BADGE[row.original.eventKind];
          return <StatusBadge status={badge.status} label={badge.label} />;
        },
      },
      {
        id: "orderNo",
        accessorKey: "orderNo",
        header: "Order",
        cell: ({ row }) => <span className="font-medium">{row.original.orderNo}</span>,
      },
      {
        id: "tenderMethod",
        accessorKey: "tenderMethod",
        header: "Tender",
        cell: ({ row }) => row.original.tenderMethod ?? "—",
      },
      {
        id: "amount",
        accessorKey: "eventAmountPaisa",
        header: "Amount",
        cell: ({ row }) => (
          <span className="block text-right">
            {/* The demo's signed, colour-coded ledger amount — with the sign as a CHARACTER, so
                the direction of the money survives greyscale and dichromacy (D-38-13). */}
            <MoneyDisplay
              paisa={row.original.eventAmountPaisa}
              sign="signed"
              className={row.original.eventAmountPaisa < 0 ? "text-destructive" : "text-success"}
            />
          </span>
        ),
      },
      {
        id: "orderTotal",
        accessorKey: "orderTotalPaisa",
        header: "Order total",
        // Marked as the ORDER's, deliberately — see the model's comment on why these must not be
        // summed down the column.
        cell: ({ row }) => (
          <span className="block text-right text-foreground-secondary">
            <MoneyDisplay paisa={row.original.orderTotalPaisa} />
          </span>
        ),
      },
      {
        id: "trace",
        header: "Trace",
        enableSorting: false,
        cell: ({ row }) => {
          const key = rowKey(row.original, row.index);
          const isOpen = openRow?.key === key;
          return (
            <Button
              type="button"
              variant="link"
              size="sm"
              aria-expanded={isOpen}
              onClick={() => setOpenRow(isOpen ? null : { key, row: row.original })}
            >
              {isOpen ? "Hide" : "Open"} <span className="sr-only">{row.original.orderNo}</span>
            </Button>
          );
        },
      },
    ],
    [openRow],
  );

  const activeFilterCount = (tenderMethod ? 1 : 0) + (kinds.length > 0 ? 1 : 0);

  return (
    <div className="space-y-(--space-lg)">
      <FilterBar
        title="Money events"
        filters={[
          {
            id: "tender",
            label: "Tender",
            value: tenderMethod,
            allLabel: "Any tender",
            options: TENDER_OPTIONS,
            onChange: (value) => {
              setPage(0);
              setTenderMethod(value);
            },
          },
        ]}
        extraActiveCount={kinds.length > 0 ? 1 : 0}
        onClearAll={() => {
          setPage(0);
          setTenderMethod("");
          setKinds([]);
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="txn-from">From</Label>
          <Input
            id="txn-from"
            type="date"
            value={from}
            onChange={(e) => {
              setPage(0);
              setFrom(e.target.value);
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="txn-to">To</Label>
          <Input
            id="txn-to"
            type="date"
            value={to}
            onChange={(e) => {
              setPage(0);
              setTo(e.target.value);
            }}
          />
        </div>
        <fieldset className="flex flex-col gap-1">
          <legend className="text-label font-semibold uppercase tracking-wide text-foreground-tertiary">
            Show
          </legend>
          <div className="flex gap-1">
            {(["TENDER", "REFUND", "VOID"] as TransactionEventKind[]).map((k) => {
              const on = kinds.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleKind(k)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1 text-small transition-colors",
                    on
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-foreground-secondary hover:bg-surface-2",
                  )}
                >
                  {KIND_BADGE[k].label}
                </button>
              );
            })}
          </div>
        </fieldset>
      </FilterBar>

      {/* ── Totals for the WHOLE filtered range, not this page ──────────────────────── */}
      {data && (
        <div className="space-y-(--space-sm)">
          <div className="grid grid-cols-2 gap-(--space-md) lg:grid-cols-4">
            <StatTile label="Taken in" value={<MoneyDisplay paisa={data.tenderedPaisa} />} />
            <StatTile
              label="Refunded"
              value={<MoneyDisplay paisa={data.refundedPaisa} sign="accounting" />}
            />
            <StatTile
              label="Voided"
              value={<MoneyDisplay paisa={data.voidedPaisa} sign="accounting" />}
            />
            <StatTile
              label="Net"
              accent="primary"
              value={<MoneyDisplay paisa={data.netAmountPaisa} />}
            />
          </div>
          {/* Said out loud, because a four-tile row above a paginated grid reads as a summary OF
              the grid. It is not: these are the server's aggregates over every event in the
              filtered range, and the grid below is showing at most fifty of them. */}
          <p className="text-small text-foreground-tertiary">
            Totals cover the whole filtered range ({data.totalRows} events), not just this page.
          </p>
        </div>
      )}

      {/* ── The register ────────────────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-small font-medium text-destructive">Transactions could not be loaded</p>
          <p className="text-small text-foreground-secondary">{error}</p>
        </div>
      )}

      {!error && (
        <DataGrid
          label="Transaction register"
          columns={columns}
          data={data?.rows ?? []}
          isLoading={loading}
          pageSize={50}
          isFiltered={activeFilterCount > 0}
          onClearFilters={() => {
            setPage(0);
            setTenderMethod("");
            setKinds([]);
          }}
          emptyTitle="No money moved in this period"
          emptyDescription="No payment, refund or void was recorded between these dates. That is what the register holds — it is not a failed read."
          card={{
            primary: (r) => r.orderNo,
            secondary: (r) => `${KIND_BADGE[r.eventKind].label} · ${r.eventAt.toLocaleString()}`,
            trailing: (r) => <MoneyDisplay paisa={r.eventAmountPaisa} sign="signed" />,
          }}
        />
      )}

      {openRow && <TraceDetail row={openRow.row} onClose={() => setOpenRow(null)} />}

      {data && data.totalRows > data.size && (
        <div className="flex items-center gap-3 text-small">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <span className="text-foreground-secondary">
            Page {data.page + 1} of {Math.max(1, Math.ceil(data.totalRows / data.size))}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={(page + 1) * data.size >= data.totalRows}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * One event, traced: the order behind it and the accounting entries it produced (D-37-01).
 *
 * <p>The order's own figures are listed as a stack of ledger rows rather than a run-on sentence,
 * so subtotal, discount, tax and service charge line up under one another and can be read against
 * the bill. Discounts are written in accounting parentheses, because on this panel they are the
 * one line that comes OFF the total.
 */
function TraceDetail({ row, onClose }: { row: TransactionRow; onClose: () => void }) {
  return (
    <section
      aria-label={`Trace for ${row.orderNo}`}
      className="rounded-xl border border-border bg-card p-(--space-lg) text-card-foreground"
    >
      <div className="flex flex-wrap items-start justify-between gap-(--space-md)">
        <div>
          <h3 className="text-h2 font-semibold">{row.orderNo}</h3>
          <p className="text-small text-foreground-secondary">
            {KIND_BADGE[row.eventKind].label} · order status {row.orderStatus}
            {row.reason ? ` · reason ${row.reason}` : ""}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      <div className="mt-(--space-md) grid gap-(--space-lg) lg:grid-cols-2">
        <div>
          <h4 className="text-label font-semibold uppercase tracking-wide text-foreground-tertiary">
            The order this event settled
          </h4>
          <div className="mt-(--space-sm)">
            <LedgerStatRow label="Subtotal" value={<MoneyDisplay paisa={row.orderSubtotalPaisa} />} />
            <LedgerStatRow
              label="Discount"
              value={
                <MoneyDisplay
                  paisa={row.orderDiscountPaisa === 0 ? 0 : -row.orderDiscountPaisa}
                  sign="accounting"
                />
              }
            />
            <LedgerStatRow label="Tax" value={<MoneyDisplay paisa={row.orderTaxPaisa} />} />
            <LedgerStatRow
              label="Service charge"
              value={<MoneyDisplay paisa={row.orderServiceChargePaisa} />}
            />
            <LedgerStatRow
              label="Order total"
              value={<MoneyDisplay paisa={row.orderTotalPaisa} />}
            />
          </div>
        </div>

        <div>
          <h4 className="text-label font-semibold uppercase tracking-wide text-foreground-tertiary">
            What it posted to the ledger
          </h4>
          <div className="mt-(--space-sm)">
            <TransactionLedgerLinks orderId={row.orderId} />
          </div>
        </div>
      </div>
    </section>
  );
}
