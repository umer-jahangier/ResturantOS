"use client";

import { use } from "react";

import { useAccount } from "@/lib/hooks/finance/use-accounts";
import { FinanceEmptyState } from "@/components/finance/FinanceEmptyState";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { QueryErrorNotice } from "@/components/ui/query-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { StatusBadge } from "@/components/ui/status-badge";

interface AccountDetailPageProps {
  params: Promise<{ code: string }>;
}

// URL: /app/finance/accounts/[code]
export default function AccountDetailPage({ params }: AccountDetailPageProps) {
  const { code } = use(params);
  const accountQuery = useAccount(code);
  const { data: account, isLoading } = accountQuery;

  if (isLoading) {
    return (
      <PageBody className="space-y-(--space-lg)">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </PageBody>
    );
  }

  // GA-001: `isError || !account` said "Account not found" for a 500 as readily as for a 404 —
  // and "this account does not exist" is a claim about the ledger, not about the network.
  if (accountQuery.isError) {
    return (
      <QueryErrorNotice
        what={`account ${code}`}
        error={accountQuery.error}
        onRetry={() => void accountQuery.refetch()}
      />
    );
  }

  if (!account) {
    return (
      <FinanceEmptyState
        title="Account not found"
        description={`No account with code "${code}" was found.`}
      />
    );
  }

  return (
    <PageBody className="space-y-(--space-lg)">
      {/* `PageHeader` owns the title's type role and offers no escape hatch for it — deliberately,
          per its own docblock: "every escape hatch offered here becomes the next `text-2xl`". So
          the code is set in the heading face rather than in Geist Mono, and the identifier fields
          below keep the mono (UI-SPEC §3.11 reserves it for identifiers, which is what a parent
          code and a system tag are). The money on this module's other screens moves the opposite
          way in the same plan; both are the one rule — mono means identifier. */}
      <PageHeader
        title={account.code}
        description={account.name}
        meta={
          <StatusBadge
            status={account.active ? "active" : "inactive"}
            label={account.active ? "Active" : "Inactive"}
          />
        }
      />

      <div className="grid gap-(--space-md) sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Type" value={account.accountType} />
        <StatTile
          label="Parent account"
          value={<span className="font-mono">{account.parentCode ?? "—"}</span>}
        />
        <StatTile
          label="System tag"
          value={<span className="font-mono">{account.systemTag ?? "—"}</span>}
        />
        <StatTile label="System account" value={account.system ? "Yes" : "No"} />
      </div>
    </PageBody>
  );
}
