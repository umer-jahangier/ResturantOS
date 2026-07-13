"use client";

import { useState } from "react";

import { useCustomerAccounts } from "@/lib/hooks/finance/use-finance";
import { CustomerAccountFormDialog } from "@/components/finance/CustomerAccountFormDialog";
import { ArChargeDialog } from "@/components/finance/ArChargeDialog";
import { ArSettlementDialog } from "@/components/finance/ArSettlementDialog";
import { FinanceEmptyState } from "@/components/finance/FinanceEmptyState";
import { StatusBadge } from "@/components/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { MoneyDisplay } from "@/components/ui/money-display";
import { cn } from "@/lib/utils";
import type { CustomerAccount } from "@/lib/models/finance.model";

/** A house account's balance sitting at or over its credit limit needs the destructive semantic
 * token (04-04-B) — the same visual language ApAgingTable uses for "Over 90". */
function CustomerAccountRow({ account }: { account: CustomerAccount }) {
  const overLimit =
    account.creditLimitPaisa > 0 && account.balancePaisa >= account.creditLimitPaisa;

  return (
    <tr className={cn("border-b hover:bg-muted/50", overLimit && "bg-destructive/10")}>
      <td className="py-2 pr-4 font-mono tabular-nums">{account.accountCode}</td>
      <td className="py-2 pr-4">{account.name}</td>
      <td className="py-2 pr-4 text-xs text-muted-foreground">
        {account.contactName ?? "—"}
        {account.contactPhone ? ` · ${account.contactPhone}` : ""}
      </td>
      <td className="py-2 pr-4">
        <MoneyDisplay paisa={account.creditLimitPaisa} />
      </td>
      <td className="py-2 pr-4">
        <MoneyDisplay
          paisa={account.balancePaisa}
          className={overLimit ? "text-destructive" : undefined}
        />
      </td>
      <td className="py-2 pr-4">
        <StatusBadge
          status={account.status === "ACTIVE" ? "success" : "error"}
          label={account.status === "ACTIVE" ? "Active" : "Suspended"}
        />
      </td>
      <td className="py-2 pr-4">
        <div className="flex gap-2">
          <ArChargeDialog
            account={account}
            trigger={
              <Button type="button" size="sm" disabled={account.status === "SUSPENDED"}>
                Charge
              </Button>
            }
          />
          <ArSettlementDialog
            account={account}
            trigger={
              <Button type="button" size="sm" variant="outline">
                Settle
              </Button>
            }
          />
        </div>
      </td>
    </tr>
  );
}

// URL: /app/finance/house-accounts — create/charge/settle house (corporate/regular) accounts,
// the real AR writer a human can drive today (decision 10-17-A).
export default function HouseAccountsPage() {
  const [page] = useState(0);
  const { data, isLoading } = useCustomerAccounts(page);
  const accounts = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">House Accounts</h1>
          <p className="text-sm text-muted-foreground">
            Corporate clients and regulars billed on account — catering invoices, phone orders,
            month-end billing, settled later.
          </p>
        </div>
        <CustomerAccountFormDialog trigger={<Button>New house account</Button>} />
      </div>

      {isLoading ? (
        <div className="grid gap-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : accounts.length === 0 ? (
        <FinanceEmptyState
          title="No house accounts yet"
          description="Create one to bill a corporate client on account."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Code</th>
                <th className="py-2 pr-4 font-medium">Name</th>
                <th className="py-2 pr-4 font-medium">Contact</th>
                <th className="py-2 pr-4 font-medium">Credit limit</th>
                <th className="py-2 pr-4 font-medium">Balance</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <CustomerAccountRow key={account.id} account={account} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
