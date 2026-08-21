import type { RecordRow } from "@/components/dashboard/portlets/portlet";
import { MoneyDisplay } from "@/components/ui/money-display";
import { formatDateTime } from "@/lib/format/locale";
import type { AccountingPeriod, JeFilters, JournalEntry } from "@/lib/models/finance.model";

/**
 * The ledger reads two dashboards share — FINANCE_VIEWER's and ACCOUNTANT's.
 *
 * <h3>Why this file exists rather than the two dashboards each having a copy</h3>
 *
 * Both roles ask a reconciliation question and both answer part of it from the same two
 * sources: draft journal entries and open accounting periods. The figures must AGREE — an
 * accountant and a finance viewer looking at the same branch on the same afternoon and reading
 * two different "unposted entries" counts is the defect that makes a dashboard unusable, and it
 * arrives through exactly this shape: two files, one formula, one of them edited.
 *
 * <p>It is deliberately small and holds no hooks: the two dashboards each run their own
 * queries (their permission sets differ, so their portlet sets differ) and share only the
 * derivations and the row formatting. Components take plain props and do not fetch; so does
 * this.
 */

/** The last twelve months, as `YYYY-MM-DD`. */
function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}

export function todayIso(): string {
  return isoDay(0);
}

/**
 * The journal-entry filter both dashboards send, with its window written down.
 *
 * <p>`from`/`to` are NOT optional in practice: `FinanceRepository.listJournalEntries` omits the
 * parameters when they are absent and finance-service then applies its own one-month default —
 * so an unfiltered call silently answers a different question from the one the tile's caption
 * claims. Twelve months is chosen because a DRAFT entry older than that is precisely the thing
 * a reconciliation is meant to surface, not something to hide behind a default.
 *
 * <p>A FUNCTION and not a `const`. A module-level constant would freeze both dates at import
 * time, so a dashboard left open overnight — which is what a back-office dashboard IS — would
 * keep asking about a window that ended yesterday, and go on doing so until the tab was
 * reloaded. Returning a fresh object per render costs nothing: TanStack compares query keys
 * structurally, so the query only refetches when the calendar day actually moves.
 */
export function draftJournalFilters(): JeFilters {
  return {
    status: "DRAFT",
    fromDate: isoDay(365),
    toDate: isoDay(0),
    size: 50,
  };
}

/**
 * Debits ≠ credits.
 *
 * <p>The backend refuses to POST an unbalanced entry, so in a healthy ledger this is zero — and
 * a measured zero is a fact, unlike a fabricated one. Where it is NOT zero the entry cannot be
 * posted at all, which makes it the single most useful thing either role can be shown.
 */
export function isUnbalanced(entry: JournalEntry): boolean {
  return entry.totalDebitPaisa !== entry.totalCreditPaisa;
}

/** Open periods whose end date has already passed. String compare — both are `YYYY-MM-DD`. */
export function overduePeriods(
  periods: readonly AccountingPeriod[],
  today = todayIso(),
): AccountingPeriod[] {
  return periods.filter((p) => p.status === "OPEN" && p.endDate < today);
}

/** Draft entries as record rows, newest first. Money goes through `MoneyDisplay`, as always. */
export function journalRecordRows(entries: readonly JournalEntry[], limit = 6): RecordRow[] {
  return [...entries]
    .sort((a, b) => b.entryDate.localeCompare(a.entryDate))
    .slice(0, limit)
    .map((entry) => ({
      key: entry.id,
      primary: entry.entryNo ?? entry.id.slice(0, 8),
      secondary: `${formatDateTime(entry.entryDate, {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })} · ${entry.description || "No description"}`,
      trailing: <MoneyDisplay paisa={entry.totalDebitPaisa} />,
    }));
}

/** Open periods as record rows, oldest first — the one most overdue to close reads first. */
export function periodRecordRows(
  periods: readonly AccountingPeriod[],
  today = todayIso(),
  limit = 6,
): RecordRow[] {
  return [...periods]
    .sort((a, b) => a.endDate.localeCompare(b.endDate))
    .slice(0, limit)
    .map((period) => ({
      key: period.id,
      primary: `Period ${period.periodNo} · FY${period.fiscalYear}`,
      secondary: `${formatDateTime(period.startDate, { day: "2-digit", month: "short" })} – ${formatDateTime(
        period.endDate,
        { day: "2-digit", month: "short", year: "numeric" },
      )}`,
      // A WORD, not a colour. The period list's only state is open-vs-overdue and the row has
      // no hue channel at all, so the state has to be text or it is not carried.
      trailing: period.endDate < today ? "Overdue" : "Open",
    }));
}
