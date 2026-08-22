"use client";

import { useMemo } from "react";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { PortletGrid, type PortletModels } from "@/components/dashboard/portlets/portlet-renderer";
import type { ExceptionRow, RankedRow } from "@/components/dashboard/portlets/portlet";
import { DASHBOARD_PRESETS, type AccountantPortlets } from "@/components/dashboard/presets";
import { MoneyDisplay } from "@/components/ui/money-display";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { formatDateTime, formatNumber } from "@/lib/format/locale";
import { useApAging, useArAging } from "@/lib/hooks/finance/use-finance";
import { useJournalEntries } from "@/lib/hooks/finance/use-journal-entries";
import { useOpenPeriods } from "@/lib/hooks/finance/use-periods";
import { useVendorInvoices } from "@/lib/hooks/purchasing/use-purchasing";
import type { InvoiceStatus } from "@/lib/models/purchasing-status";
import {
  draftJournalFilters,
  isUnbalanced,
  journalRecordRows,
  overduePeriods,
} from "@/components/dashboard/ledger-shared";

const PRESET = DASHBOARD_PRESETS.accountant;

/** Booked and not yet paid. `PAID` is finished; `PENDING_MATCH` is a state the server skips. */
const UNSETTLED_INVOICE_STATUSES: InvoiceStatus[] = [
  "MATCHED",
  "MISMATCHED",
  "APPROVED_FOR_PAYMENT",
];

/**
 * ACCOUNTANT dashboard — "What needs posting or reconciling?" (PROVISIONAL question; see
 * `presets.ts`, which is where to change it).
 *
 * <h3>What this role was asked before phase 38</h3>
 *
 * *"Is the business healthy?"* — the OWNER's question. `resolveDashboardPreset` had no
 * ACCOUNTANT branch, so the role fell past every role match and was caught by
 * `permissions.includes("reporting.report.view")`, which an accountant does hold. All seven
 * owner portlets survived the permission filter, so the page was not broken in any way a
 * screenshot would show. It was simply the wrong question: an accountant's 26 permissions are
 * `finance.journal.post`, `finance.journal.reverse`, `finance.period.close`, `vendor.invoice.book`,
 * `vendor.payment.create` — a list of unfinished work, not a health check. Being plausible is
 * what made it survive four phases.
 *
 * <h3>The one deliberately unavailable tile, and why it is HERE</h3>
 *
 * `accountant-net-income` renders `—` and a stated reason, forever, until two things change in
 * the backend. This is D-38-16 applied at the one place it costs something: an accountant is
 * exactly the reader who wants a net-income figure, and the demo puts one on its Finance screen
 * (`Net Income (MTD) $26,808`, beside `COGS (MTD) $19,432` and `Net Margin 39.2%`).
 *
 * <p>This system can produce none of them. `sales_item_facts.cogs_paisa` and `.gross_margin_paisa`
 * are Phase-8-deferred NULLs for every row, and finance-service has no statement-assembly
 * endpoint of any kind — `grep -rli "income-statement|trial-balance|cash-flow|profit"
 * services/*&#47;src/main/java` returns zero files. It has journal entries, a chart of accounts,
 * periods and AR/AP aging, and nothing that adds them up into a P&L.
 *
 * <p>Rendering the tile as an absence rather than dropping it from the layout is the deliberate
 * choice: a missing tile reads as a feature nobody thought of, while a tile that says what it
 * cannot compute and why reads as a known gap with an owner. The alternative — a number — is the
 * defect this codebase has already written three separate guards against
 * (`ReportCatalog.java:74-80`, `ReportTable.tsx:22-34`, and this dashboard family's own
 * `owner-gross-margin`).
 *
 * <h3>Everything else is measured</h3>
 *
 * Draft entries and open periods from finance-service (shared with FINANCE_VIEWER through
 * `ledger-shared.tsx`, so the two roles cannot read different counts); AP and AR totals from
 * `GET /api/v1/finance/{ap,ar}/aging`, which return their own bucket totals; unsettled vendor
 * invoices from the branch's invoice list. The AP ranking's bars are the buckets' shares of the
 * aging total — a real denominator, from the same response.
 */
export function AccountantDashboard() {
  const { branchId, permissions } = useCurrentUser();

  const draftsQuery = useJournalEntries(draftJournalFilters());
  const periodsQuery = useOpenPeriods();
  const apQuery = useApAging();
  const arQuery = useArAging();
  const invoicesQuery = useVendorInvoices(branchId, UNSETTLED_INVOICE_STATUSES);

  const drafts = useMemo(() => draftsQuery.data?.data ?? [], [draftsQuery.data]);
  const draftCount = draftsQuery.data?.meta.totalCount ?? drafts.length;
  const periods = useMemo(() => periodsQuery.data ?? [], [periodsQuery.data]);
  const invoices = useMemo(() => invoicesQuery.data ?? [], [invoicesQuery.data]);

  const ap = apQuery.data;
  const ar = arQuery.data;

  const unbalanced = useMemo(() => drafts.filter(isUnbalanced), [drafts]);
  const overdue = useMemo(() => overduePeriods(periods), [periods]);
  const mismatched = useMemo(() => invoices.filter((i) => i.status === "MISMATCHED"), [invoices]);

  const apBuckets = useMemo<RankedRow[]>(() => {
    if (!ap) return [];
    const total = ap.totalApPaisa;
    return ap.buckets.map((bucket) => ({
      key: bucket.label,
      label: bucket.label,
      value: <MoneyDisplay paisa={bucket.amountPaisa} />,
      // Share of the payables total — a real denominator, from the same response. Omitted
      // rather than defaulted when the total is zero: `0/0` is not "this bucket is empty",
      // and a bar of unknown length encodes nothing.
      ...(total > 0 ? { fraction: bucket.amountPaisa / total } : {}),
    }));
  }, [ap]);

  const invoiceRows = useMemo(
    () =>
      invoices.slice(0, 6).map((invoice) => ({
        key: invoice.id,
        primary: invoice.invoiceNo,
        secondary: `${invoice.status.replace(/_/g, " ").toLowerCase()} · ${formatDateTime(
          invoice.invoiceDate,
          { day: "2-digit", month: "short", year: "numeric" },
        )}`,
        trailing: <MoneyDisplay paisa={invoice.totalPaisa} />,
      })),
    [invoices],
  );

  const exceptions = useMemo<ExceptionRow[]>(() => {
    const rows: ExceptionRow[] = mismatched.slice(0, 3).map((invoice) => ({
      key: `mismatch-${invoice.id}`,
      label: `Invoice ${invoice.invoiceNo} failed its three-way match`,
      detail: (
        <>
          <MoneyDisplay paisa={invoice.totalPaisa} /> booked — approve with a justification or send
          it back
        </>
      ),
      severity: "danger" as const,
    }));
    for (const entry of unbalanced.slice(0, 2)) {
      rows.push({
        key: `unbalanced-${entry.id}`,
        label: `${entry.entryNo ?? entry.id.slice(0, 8)} does not balance`,
        detail: (
          <>
            <MoneyDisplay paisa={entry.totalDebitPaisa} /> debit against{" "}
            <MoneyDisplay paisa={entry.totalCreditPaisa} /> credit — it cannot be posted as it
            stands
          </>
        ),
        severity: "danger" as const,
      });
    }
    for (const period of overdue.slice(0, 2)) {
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
  }, [mismatched, unbalanced, overdue]);

  const models: PortletModels<AccountantPortlets> = {
    "accountant-unposted-journals": {
      kind: "KpiTile",
      value: formatNumber(draftCount),
      caption: "Draft entries in the last 12 months",
      tone: draftCount > 0 ? "warning" : "neutral",
      boundary: { query: draftsQuery, what: "journal entries" },
    },
    // No `?? 0` on either of these. The boundary means the tile only renders once the query
    // has resolved without error, so the fallback could never reach a screen — but a
    // `paisa={total ?? 0}` left in the source is a fabricated zero waiting for the day somebody
    // removes the boundary, and this is the one product where that day has already happened
    // ("Closed sales: Rs 0.00", which was a query bug and not a quiet day).
    "accountant-payables-outstanding": ap
      ? {
          kind: "KpiTile",
          value: <MoneyDisplay paisa={ap.totalApPaisa} />,
          caption: `Across ${formatNumber(ap.buckets.length)} ageing bucket${
            ap.buckets.length === 1 ? "" : "s"
          }`,
          boundary: { query: apQuery, what: "payables ageing" },
        }
      : {
          kind: "KpiTile",
          caption: "Owed to vendors",
          unavailableReason: "Payables ageing has not been read yet.",
          boundary: { query: apQuery, what: "payables ageing" },
        },
    "accountant-receivables-outstanding": ar
      ? {
          kind: "KpiTile",
          value: <MoneyDisplay paisa={ar.totalArPaisa} />,
          caption: "Owed by house accounts",
          boundary: { query: arQuery, what: "receivables ageing" },
        }
      : {
          kind: "KpiTile",
          caption: "Owed by house accounts",
          unavailableReason: "Receivables ageing has not been read yet.",
          boundary: { query: arQuery, what: "receivables ageing" },
        },
    "accountant-net-income": {
      kind: "KpiTile",
      caption: "Revenue less cost of goods and operating expense",
      // No `value`. The union will not accept one beside this, which is the point (D-38-16).
      unavailableReason:
        "Cost of goods is not posted per sale and no income statement is assembled anywhere " +
        "in this system, so net income cannot be computed. Showing nothing rather than a " +
        "wrong number.",
    },
    "accountant-payables-ageing": {
      kind: "RankedList",
      rows: apBuckets,
      emptyLabel: "Nothing is payable.",
      boundary: { query: apQuery, what: "payables ageing" },
    },
    "accountant-unposted-list": {
      kind: "RecordList",
      rows: journalRecordRows(drafts),
      emptyLabel: "Every entry in this window is posted.",
      boundary: { query: draftsQuery, what: "journal entries" },
    },
    "accountant-exceptions": {
      kind: "ExceptionList",
      rows: exceptions,
      emptyLabel: "Nothing needs you right now.",
      // As a unit: this list merges three sources, and a partially populated exception list
      // tells an accountant nothing needs them when something does.
      boundary: {
        query: [draftsQuery, periodsQuery, invoicesQuery],
        what: "the exception list",
      },
    },
    "accountant-invoices": {
      kind: "RecordList",
      rows: invoiceRows,
      emptyLabel: "No vendor invoice is waiting to be settled.",
      boundary: {
        query: invoicesQuery,
        what: "vendor invoices",
        stillWorks: "The ledger is still readable.",
      },
    },
  };

  return (
    <DashboardShell preset={PRESET}>
      <PortletGrid preset={PRESET} permissions={permissions} models={models} />
    </DashboardShell>
  );
}
