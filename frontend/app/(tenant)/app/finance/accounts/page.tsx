"use client";

import { useState } from "react";

import { AccountTable } from "@/components/finance/AccountTable";
import { FinanceEmptyState } from "@/components/finance/FinanceEmptyState";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { useFinanceSetupStatus } from "@/lib/hooks/finance/use-accounts";

const ACCOUNT_TYPES = [
  { value: "ASSET", label: "Asset" },
  { value: "LIABILITY", label: "Liability" },
  { value: "EQUITY", label: "Equity" },
  { value: "REVENUE", label: "Revenue" },
  { value: "EXPENSE", label: "Expense" },
];

// URL: /app/finance/accounts
export default function AccountsPage() {
  const [typeFilter, setTypeFilter] = useState("");
  const { data: setupStatus } = useFinanceSetupStatus();

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Chart of Accounts"
        description="Pakistan Restaurant Standard COA."
        meta={
          setupStatus
            ? `${setupStatus.accountCount} accounts${setupStatus.provisioned ? "" : " · not provisioned"}`
            : undefined
        }
      />

      {setupStatus && !setupStatus.provisioned && (
        <FinanceEmptyState
          title="Finance not provisioned"
          description="System Admin need to run the script to load COA and periods."
        />
      )}

      <FilterBar
        title="Accounts"
        filters={[
          {
            id: "type",
            label: "Type",
            value: typeFilter,
            allLabel: "All types",
            options: ACCOUNT_TYPES,
            onChange: setTypeFilter,
          },
        ]}
      />

      <AccountTable typeFilter={typeFilter || undefined} />
    </PageBody>
  );
}
