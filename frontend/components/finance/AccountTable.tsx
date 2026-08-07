"use client";

import { useRouter } from "next/navigation";
import { useAccounts } from "@/lib/hooks/finance/use-accounts";
import { FinanceEmptyState } from "./FinanceEmptyState";
import { StatusBadge } from "@/components/ui/status-badge";
import { QueryBoundary } from "@/components/ui/query-boundary";

interface AccountTableProps {
  typeFilter?: string;
}

function AccountTable({ typeFilter }: AccountTableProps) {
  const router = useRouter();
  const accounts = useAccounts(typeFilter ? { type: typeFilter } : undefined);
  const rows = accounts.data?.data ?? [];

  return (
    // GA-001: "No accounts found" used to mean either "this tenant has no chart of accounts" or
    // "finance-service is down", with no way to tell. The first is a provisioning problem, the
    // second is an outage, and the two want opposite responses from the reader.
    <QueryBoundary
      query={accounts}
      what="the chart of accounts"
      isEmpty={rows.length === 0}
      loading={
        <div className="animate-pulse space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 rounded bg-muted" />
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
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Code</th>
              <th className="py-2 pr-4 font-medium">Name</th>
              <th className="py-2 pr-4 font-medium">Type</th>
              <th className="py-2 pr-4 font-medium">Status</th>
              <th className="py-2 pr-4 font-medium">Tag</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((account) => (
              <tr
                key={account.id}
                className="cursor-pointer border-b transition-colors hover:bg-muted/50"
                onClick={() => router.push(`/app/finance/accounts/${account.code}`)}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    router.push(`/app/finance/accounts/${account.code}`);
                  }
                }}
              >
                <td className="py-2 pr-4 font-mono tabular-nums text-sm">{account.code}</td>
                <td className="py-2 pr-4">{account.name}</td>
                <td className="py-2 pr-4 text-xs text-muted-foreground">{account.accountType}</td>
                <td className="py-2 pr-4">
                  <StatusBadge
                    status={account.active ? "active" : "inactive"}
                    label={account.active ? "Active" : "Inactive"}
                  />
                </td>
                <td className="py-2 pr-4 text-xs text-muted-foreground">
                  {account.systemTag ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </QueryBoundary>
  );
}

export { AccountTable };
