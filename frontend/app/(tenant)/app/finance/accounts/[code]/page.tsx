"use client";

import { use } from "react";
import { useAccount } from "@/lib/hooks/finance/use-accounts";
import { StatusBadge } from "@/components/ui/status-badge";
import { FinanceEmptyState } from "@/components/finance/FinanceEmptyState";

interface AccountDetailPageProps {
  params: Promise<{ code: string }>;
}

// URL: /app/finance/accounts/[code]
export default function AccountDetailPage({ params }: AccountDetailPageProps) {
  const { code } = use(params);
  const { data: account, isLoading, isError } = useAccount(code);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 w-48 rounded bg-muted" />
        <div className="h-4 w-64 rounded bg-muted" />
      </div>
    );
  }

  if (isError || !account) {
    return (
      <FinanceEmptyState
        title="Account not found"
        description={`No account with code "${code}" was found.`}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold font-mono">{account.code}</h1>
          <StatusBadge
            status={account.active ? "active" : "inactive"}
            label={account.active ? "Active" : "Inactive"}
          />
        </div>
        <p className="text-lg text-muted-foreground">{account.name}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 rounded border p-4 text-sm">
        <div>
          <p className="text-xs text-muted-foreground uppercase">Type</p>
          <p className="font-medium mt-0.5">{account.accountType}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase">Parent Account</p>
          <p className="font-medium font-mono mt-0.5">{account.parentCode ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase">System Tag</p>
          <p className="font-medium font-mono mt-0.5">{account.systemTag ?? "—"}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground uppercase">System Account</p>
          <p className="font-medium mt-0.5">{account.system ? "Yes" : "No"}</p>
        </div>
      </div>
    </div>
  );
}
