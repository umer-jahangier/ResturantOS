"use client";

import { formatPaisa } from "@/lib/adapters/shared";
import { useOrderJournalEntries } from "@/lib/hooks/finance/use-transactions";

/**
 * The round trip D-37-01 demands: from a transaction row through to the journal entries that
 * transaction's order produced (37-04 + 37-11).
 *
 * <p>Loaded ON DEMAND, per row, when the owner expands it — never eagerly for the page. The
 * register renders up to 200 rows and an eager fetch would be 200 calls to decorate a table
 * nobody has asked a question of yet.
 */
export function TransactionLedgerLinks({ orderId }: { orderId: string }) {
  // Fetched only once the row is expanded — the parent passes the id only then.
  const { data: entries, isLoading, error } = useOrderJournalEntries(orderId);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading ledger entries…</p>;

  if (error) {
    // D-37-05: say what went wrong. Never render an empty ledger panel that reads as
    // "this order produced no entries" when the truth is "we could not ask".
    return (
      <p className="text-sm text-destructive">
        Could not load the accounting entries — {error instanceof Error ? error.message : "unknown error"}
      </p>
    );
  }

  if (entries && entries.length === 0) {
    // A true and useful answer, and distinct from a failure. 37-04 returns 200 + [] here.
    return (
      <p className="text-sm text-muted-foreground">
        This order produced no accounting entries.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {entries?.map((e) => {
        const debits = e.lines.reduce((s, l) => s + l.debitPaisa, 0);
        const credits = e.lines.reduce((s, l) => s + l.creditPaisa, 0);
        const balanced = debits === credits;
        return (
          <div key={e.id} className="rounded border p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">
                {e.entryNo} · {e.sourceType ?? "manual"}
              </span>
              <span className="text-muted-foreground">{e.entryDate}</span>
            </div>
            <p className="text-muted-foreground">{e.description}</p>

            <table className="mt-2 w-full">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="font-normal">Account</th>
                  <th className="font-normal">Detail</th>
                  <th className="text-right font-normal">Debit</th>
                  <th className="text-right font-normal">Credit</th>
                </tr>
              </thead>
              <tbody>
                {e.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="py-0.5">{l.accountCode}</td>
                    <td className="py-0.5 text-muted-foreground">{l.description}</td>
                    <td className="py-0.5 text-right tabular-nums">
                      {l.debitPaisa ? formatPaisa(l.debitPaisa) : ""}
                    </td>
                    <td className="py-0.5 text-right tabular-nums">
                      {l.creditPaisa ? formatPaisa(l.creditPaisa) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Shown, not assumed. The JE_UNBALANCED trigger should make this impossible —
                which is exactly why an owner should be told if it ever is not. */}
            <p
              className={
                balanced
                  ? "mt-1 text-xs text-muted-foreground"
                  : "mt-1 text-xs font-medium text-destructive"
              }
            >
              {balanced
                ? `Balanced · ${formatPaisa(debits)}`
                : `UNBALANCED — debits ${formatPaisa(debits)} vs credits ${formatPaisa(credits)}`}
            </p>
          </div>
        );
      })}
    </div>
  );
}
