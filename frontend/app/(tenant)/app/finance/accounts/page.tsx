"use client";

import { useState } from "react";
import { AccountTable } from "@/components/finance/AccountTable";

const ACCOUNT_TYPES = [
  { value: "", label: "All Types" },
  { value: "ASSET", label: "Asset" },
  { value: "LIABILITY", label: "Liability" },
  { value: "EQUITY", label: "Equity" },
  { value: "REVENUE", label: "Revenue" },
  { value: "EXPENSE", label: "Expense" },
];

// URL: /app/finance/accounts
export default function AccountsPage() {
  const [typeFilter, setTypeFilter] = useState("");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Chart of Accounts</h1>
          <p className="text-sm text-muted-foreground">
            Pakistan Restaurant Standard COA
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <label htmlFor="typeFilter" className="text-sm font-medium">
          Filter by type
        </label>
        <select
          id="typeFilter"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded border border-input bg-background px-3 py-1.5 text-sm"
        >
          {ACCOUNT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <AccountTable typeFilter={typeFilter || undefined} />
    </div>
  );
}
