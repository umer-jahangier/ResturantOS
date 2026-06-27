"use client";

import { useRouter } from "next/navigation";
import { useAccounts } from "@/lib/hooks/finance/use-accounts";
import { FinanceEmptyState } from "./FinanceEmptyState";
import { StatusBadge } from "@/components/ui/status-badge";

interface AccountTableProps {
  typeFilter?: string;
}

function AccountTable({ typeFilter }: AccountTableProps) {
  const router = useRouter();
  const { data, isLoading, isError } = useAccounts(
    typeFilter ? { type: typeFilter } : undefined,
  );

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 rounded bg-muted" />
        ))}
      </div>
    );
  }

  if (isError || !data?.data.length) {
    return (
      <FinanceEmptyState
        title="No accounts found"
        description="Chart of Accounts will appear here after provisioning."
      />
    );
  }

  return (
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
          {data.data.map((account) => (
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
              <td className="py-2 pr-4 font-mono tabular-nums text-sm">
                {account.code}
              </td>
              <td className="py-2 pr-4">{account.name}</td>
              <td className="py-2 pr-4 text-xs text-muted-foreground">
                {account.accountType}
              </td>
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
  );
}

export { AccountTable };
