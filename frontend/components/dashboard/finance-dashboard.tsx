"use client";

import { useMemo } from "react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PortletGrid, type PortletModels } from "@/components/dashboard/portlets/portlet-renderer";
import type { ExceptionRow } from "@/components/dashboard/portlets/portlet";
import { DASHBOARD_PRESETS, type FinancePortlets } from "@/components/dashboard/presets";
import { MoneyDisplay } from "@/components/ui/money-display";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { formatDateTime, formatNumber } from "@/lib/format/locale";
import { useJournalEntries } from "@/lib/hooks/finance/use-journal-entries";
import { useOpenPeriods } from "@/lib/hooks/finance/use-periods";
import { usePayrollRuns } from "@/lib/hooks/hr/use-payroll";
import {
  draftJournalFilters,
  isUnbalanced,
  journalRecordRows,
  overduePeriods,
  periodRecordRows,
  todayIso,
} from "@/components/dashboard/ledger-shared";

const PRESET = DASHBOARD_PRESETS.finance;

/**
 * FINANCE_VIEWER dashboard — "What still needs reconciling?" (PROVISIONAL question; see
 * `presets.ts`, which is where to change it).
 *
 * <h3>What this role saw before phase 38</h3>
 *
 * The same nothing an INVENTORY_MANAGER saw, for the same reason: no branch in
 * `resolveDashboardPreset` matched FINANCE_VIEWER, so it fell through to the cashier preset,
 * whose every tile needs `pos.till.open` or `pos.order.view`. The role holds neither — it holds
 * four permissions in total (`finance.coa.view`, `finance.journal.view`, `finance.journal.post`,
 * `hr.payroll.view`) — so the page rendered its title, its time frame, and one ungated 72px
 * **Open POS** button. It was the narrowest grant set in the seed pointed at the widest button
 * in the product.
 *
 * <h3>Why there is no revenue, margin or sales figure on this page</h3>
 *
 * Not restraint — permission. FINANCE_VIEWER holds no `reporting.report.view` and no
 * `pos.order.view`, so every sales portlet would be filtered out of the layout anyway, and
 * putting one here would produce a tile that renders for nobody. What the role CAN see is the
 * ledger's unfinished work, and that is what all seven portlets count.
 *
 * <h3>The window is stated, because a count without one is not a count</h3>
 *
 * `GET /api/v1/finance/journal-entries` applies its own one-month default when no range is
 * sent — a filter that is absent in the request and present in nobody's mind. So this page
 * always sends an explicit twelve-month window and the preset's `timeFrame` says so. A
 * "12 unposted entries" that silently meant "…in the last month" is how a reconciliation gets
 * signed off with an eight-week-old draft still sitting in it.
 */
export function FinanceDashboard() {
  const { permissions } = useCurrentUser();

  const draftsQuery = useJournalEntries(draftJournalFilters());
  const periodsQuery = useOpenPeriods();
  const payrollQuery = usePayrollRuns();

  const drafts = useMemo(() => draftsQuery.data?.data ?? [], [draftsQuery.data]);
  // The SERVER's count for the filter, not the length of the page we happened to fetch.
  const draftCount = draftsQuery.data?.meta.totalCount ?? drafts.length;
  const periods = useMemo(() => periodsQuery.data ?? [], [periodsQuery.data]);
  const payrollRuns = useMemo(() => payrollQuery.data ?? [], [payrollQuery.data]);

  const unbalanced = useMemo(() => drafts.filter(isUnbalanced), [drafts]);
  const overdue = useMemo(() => overduePeriods(periods), [periods]);
  const unpaidRuns = useMemo(
    () => payrollRuns.filter((r) => r.status !== "PAID" && r.status !== "REVERSED"),
    [payrollRuns],
  );

  const exceptions = useMemo<ExceptionRow[]>(() => {
    const rows: ExceptionRow[] = unbalanced.slice(0, 3).map((entry) => ({
      key: `unbalanced-${entry.id}`,
      label: `${entry.entryNo ?? entry.id.slice(0, 8)} does not balance`,
      detail: (
        <>
          <MoneyDisplay paisa={entry.totalDebitPaisa} /> debit against{" "}
          <MoneyDisplay paisa={entry.totalCreditPaisa} /> credit
        </>
      ),
      severity: "danger" as const,
    }));
    for (const period of overdue.slice(0, 3)) {
      rows.push({
        key: `overdue-${period.id}`,
        label: `Period ${period.periodNo} of FY${period.fiscalYear} is still open`,
        detail: `Ended ${formatDateTime(period.endDate, {
          day: "2-digit",
          month: "short",
          year: "numeric",
        })} and has not been locked`,
        severity: "warning" as const,
      });
    }
    return rows.slice(0, 6);
  }, [unbalanced, overdue]);

  const models: PortletModels<FinancePortlets> = {
    "finance-unposted-journals": {
      kind: "KpiTile",
      value: formatNumber(draftCount),
      caption: "Draft entries in the last 12 months",
      tone: draftCount > 0 ? "warning" : "neutral",
      boundary: { query: draftsQuery, what: "journal entries" },
    },
    "finance-unbalanced-journals": {
      kind: "KpiTile",
      value: formatNumber(unbalanced.length),
      // Says what it counted over. `unbalanced` is derived from the rows on the page, not from
      // a server-side count, and a tile that implied otherwise would under-report silently.
      caption: `Among the ${formatNumber(drafts.length)} most recent drafts`,
      tone: unbalanced.length > 0 ? "danger" : "neutral",
      boundary: { query: draftsQuery, what: "journal entries" },
    },
    "finance-open-periods": {
      kind: "KpiTile",
      value: formatNumber(periods.length),
      caption:
        overdue.length > 0
          ? `${formatNumber(overdue.length)} past its end date`
          : "All within their end date",
      tone: overdue.length > 0 ? "warning" : "neutral",
      boundary: { query: periodsQuery, what: "accounting periods" },
    },
    "finance-payroll-unpaid": {
      kind: "KpiTile",
      value: formatNumber(unpaidRuns.length),
      caption: `Of ${formatNumber(payrollRuns.length)} run${payrollRuns.length === 1 ? "" : "s"} on record`,
      boundary: {
        query: payrollQuery,
        what: "payroll runs",
        stillWorks: "The ledger is still readable.",
      },
    },
    "finance-unposted-list": {
      kind: "RecordList",
      rows: journalRecordRows(drafts),
      emptyLabel: "Every entry in this window is posted.",
      boundary: { query: draftsQuery, what: "journal entries" },
    },
    "finance-period-list": {
      kind: "RecordList",
      rows: periodRecordRows(periods, todayIso()),
      emptyLabel: "No period is open.",
      boundary: { query: periodsQuery, what: "accounting periods" },
    },
    "finance-exceptions": {
      kind: "ExceptionList",
      rows: exceptions,
      emptyLabel: "Nothing needs you right now.",
      // As a unit: this list merges the two sources, so half of it would say "nothing is
      // wrong" about a half nobody looked at.
      boundary: { query: [draftsQuery, periodsQuery], what: "the exception list" },
    },
  };

  return (
    <DashboardShell preset={PRESET}>
      <PortletGrid preset={PRESET} permissions={permissions} models={models} />
    </DashboardShell>
  );
}
