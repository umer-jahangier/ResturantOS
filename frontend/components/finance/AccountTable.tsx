"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";

import { useAccounts } from "@/lib/hooks/finance/use-accounts";
import { FinanceEmptyState } from "./FinanceEmptyState";
import { StatusBadge } from "@/components/ui/status-badge";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { Skeleton } from "@/components/ui/skeleton";
import type { Account } from "@/lib/models/finance.model";

interface AccountTableProps {
  typeFilter?: string;
}

/**
 * The chart of accounts, on the shared grid (38-08 task 1).
 *
 * <h3>The row is no longer a `<tr onClick>`</h3>
 *
 * It used to be a clickable `<tr>` carrying `tabIndex={0}` and an Enter handler — a
 * `<div onclick>` in table clothing, which is precisely the pattern D-38-15 records the demo
 * using for every interactive row and which it names as having nothing to adopt. A screen reader
 * announced no control at all, and the row had no role and no accessible name. The code cell now
 * carries a real button with a real name; the destination is the one the row used to push.
 */
function AccountTable({ typeFilter }: AccountTableProps) {
  const router = useRouter();
  const accounts = useAccounts(typeFilter ? { type: typeFilter } : undefined);
  const rows = accounts.data?.data ?? [];

  const columns = useMemo<ColumnDef<Account, unknown>[]>(
    () => [
      {
        id: "code",
        accessorKey: "code",
        header: "Code",
        cell: ({ row }) => (
          <button
            type="button"
            onClick={() => router.push(`/app/finance/accounts/${row.original.code}`)}
            className="font-mono tabular-nums text-primary underline-offset-2 hover:underline"
          >
            {row.original.code}
          </button>
        ),
      },
      { id: "name", accessorKey: "name", header: "Name" },
      {
        id: "accountType",
        accessorKey: "accountType",
        header: "Type",
        cell: ({ row }) => (
          <span className="text-foreground-secondary">{row.original.accountType}</span>
        ),
      },
      {
        id: "status",
        header: "Status",
        enableSorting: false,
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.active ? "active" : "inactive"}
            label={row.original.active ? "Active" : "Inactive"}
          />
        ),
      },
      {
        id: "systemTag",
        accessorKey: "systemTag",
        header: "Tag",
        cell: ({ row }) => (
          <span className="text-foreground-secondary">{row.original.systemTag ?? "—"}</span>
        ),
      },
    ],
    [router],
  );

  return (
    // GA-001: "No accounts found" used to mean either "this tenant has no chart of accounts" or
    // "finance-service is down", with no way to tell. The first is a provisioning problem, the
    // second is an outage, and the two want opposite responses from the reader.
    <QueryBoundary
      query={accounts}
      what="the chart of accounts"
      isEmpty={rows.length === 0}
      loading={
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      }
      empty={
        <FinanceEmptyState
          title="No accounts found"
          description="Chart of Accounts will appear here after provisioning."
        />
      }
    >
      <DataGrid
        label="Chart of accounts"
        columns={columns}
        data={rows}
        isFiltered={Boolean(typeFilter)}
        emptyTitle="No accounts found"
        emptyDescription="Chart of Accounts will appear here after provisioning."
        card={{
          primary: (a) => a.name,
          secondary: (a) => `${a.code} · ${a.accountType}`,
          trailing: (a) => (
            <StatusBadge
              status={a.active ? "active" : "inactive"}
              label={a.active ? "Active" : "Inactive"}
            />
          ),
        }}
      />
    </QueryBoundary>
  );
}

export { AccountTable };
