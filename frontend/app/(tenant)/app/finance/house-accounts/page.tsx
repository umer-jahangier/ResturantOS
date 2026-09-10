"use client";

import { useMemo, useState } from "react";
import { Building2, CircleAlert, CreditCard, Scale } from "lucide-react";

import { useCustomerAccounts } from "@/lib/hooks/finance/use-finance";
import { CustomerAccountFormDialog } from "@/components/finance/CustomerAccountFormDialog";
import { ArChargeDialog } from "@/components/finance/ArChargeDialog";
import { ArSettlementDialog } from "@/components/finance/ArSettlementDialog";
import { FinanceEmptyState } from "@/components/finance/FinanceEmptyState";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Button } from "@/components/ui/button";
import { MoneyDisplay } from "@/components/ui/money-display";
import { StatTile } from "@/components/ui/stat-tile";
import { countLine, statLine } from "@/lib/format/stat-line";
import { formatNumber } from "@/lib/format/locale";
import type { CustomerAccount } from "@/lib/models/finance.model";

/**
 * A house account at or over its credit limit.
 *
 * <p>The tint (04-04-B, the same language the aging report uses for "Over 90") is REINFORCEMENT.
 * The statement is the badge, in words, because a manager scanning this list for who to stop
 * serving on account cannot be asked to distinguish two shades of row.
 */
function isOverLimit(account: CustomerAccount): boolean {
  return account.creditLimitPaisa > 0 && account.balancePaisa >= account.creditLimitPaisa;
}

// URL: /app/finance/house-accounts — create/charge/settle house (corporate/regular) accounts,
// the real AR writer a human can drive today (decision 10-17-A).
export default function HouseAccountsPage() {
  const [page] = useState(0);
  // GA-001: `isError` was never destructured. A failed read rendered "No house accounts yet" on
  // the tenant's AR ledger — an invitation to re-create accounts that already exist.
  const accountsQuery = useCustomerAccounts(page);
  const accounts = accountsQuery.data?.data ?? [];

  /*
   * Off `accounts` — the page of rows the grid renders. `overLimit` is the figure a credit
   * controller opens this screen for and no column states: a balance past its own account's
   * limit. Both sides of that comparison are on the row, so it is a reading, not an estimate.
   */
  const outstandingPaisa = accounts.reduce((sum, a) => sum + a.balancePaisa, 0);
  const creditLimitPaisa = accounts.reduce((sum, a) => sum + a.creditLimitPaisa, 0);
  const overLimit = accounts.filter(
    (a) => a.creditLimitPaisa > 0 && a.balancePaisa > a.creditLimitPaisa,
  ).length;

  const columns = useMemo<ColumnDef<CustomerAccount, unknown>[]>(
    () => [
      {
        id: "accountCode",
        accessorKey: "accountCode",
        header: "Code",
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">{row.original.accountCode}</span>
        ),
      },
      { id: "name", accessorKey: "name", header: "Name" },
      {
        id: "contact",
        header: "Contact",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-foreground-secondary">
            {row.original.contactName ?? "—"}
            {row.original.contactPhone ? ` · ${row.original.contactPhone}` : ""}
          </span>
        ),
      },
      {
        id: "creditLimit",
        accessorKey: "creditLimitPaisa",
        header: "Credit limit",
        cell: ({ row }) => (
          <span className="block text-right">
            <MoneyDisplay paisa={row.original.creditLimitPaisa} />
          </span>
        ),
      },
      {
        id: "balance",
        accessorKey: "balancePaisa",
        header: "Balance",
        cell: ({ row }) => (
          <span className="block text-right">
            <MoneyDisplay
              paisa={row.original.balancePaisa}
              className={isOverLimit(row.original) ? "text-destructive" : undefined}
            />
          </span>
        ),
      },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="flex items-center gap-(--space-sm)">
            <StatusBadge
              status={row.original.status === "ACTIVE" ? "success" : "error"}
              label={row.original.status === "ACTIVE" ? "Active" : "Suspended"}
            />
            {isOverLimit(row.original) ? <StatusBadge status="error" label="Over limit" /> : null}
          </span>
        ),
      },
      {
        id: "actions",
        header: "Actions",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex gap-2">
            <ArChargeDialog
              account={row.original}
              trigger={
                <Button type="button" size="sm" disabled={row.original.status === "SUSPENDED"}>
                  Charge
                </Button>
              }
            />
            <ArSettlementDialog
              account={row.original}
              trigger={
                <Button type="button" size="sm" variant="outline">
                  Settle
                </Button>
              }
            />
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="House Accounts"
        description="Corporate clients and regulars billed on account — catering invoices, phone orders, month-end billing, settled later."
        meta={
          accountsQuery.isSuccess
            ? statLine(
                countLine(accounts.length, "account"),
                `${formatNumber(accounts.filter((a) => a.status === "ACTIVE").length)} active`,
                overLimit > 0 ? `${formatNumber(overLimit)} over their credit limit` : undefined,
              )
            : undefined
        }
        actions={<CustomerAccountFormDialog trigger={<Button>New house account</Button>} />}
      />

      {accounts.length > 0 && (
        <div className="grid gap-(--space-md) md:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="House accounts"
            value={formatNumber(accounts.length)}
            icon={Building2}
            accent="primary"
          />
          <StatTile
            label="Outstanding on account"
            value={<MoneyDisplay paisa={outstandingPaisa} />}
            icon={Scale}
            accent="secondary"
          />
          <StatTile
            label="Credit extended"
            value={<MoneyDisplay paisa={creditLimitPaisa} />}
            icon={CreditCard}
          />
          <StatTile label="Over their limit" value={formatNumber(overLimit)} icon={CircleAlert} />
        </div>
      )}

      <QueryBoundary
        query={accountsQuery}
        what="house accounts"
        isEmpty={accounts.length === 0}
        loading={
          <div className="grid gap-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        }
        empty={
          <FinanceEmptyState
            title="No house accounts yet"
            description="Create one to bill a corporate client on account."
          />
        }
      >
        <DataGrid
          label="House accounts"
          columns={columns}
          data={accounts}
          rowClassName={(a) => (isOverLimit(a) ? "bg-destructive/10" : undefined)}
          emptyTitle="No house accounts yet"
          emptyDescription="Create one to bill a corporate client on account."
          card={{
            primary: (a) => a.name,
            secondary: (a) => a.accountCode,
            trailing: (a) => <MoneyDisplay paisa={a.balancePaisa} />,
          }}
        />
      </QueryBoundary>
    </PageBody>
  );
}
