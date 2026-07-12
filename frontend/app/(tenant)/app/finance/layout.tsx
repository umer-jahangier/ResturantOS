"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { AccessDenied } from "@/components/shared/access-denied";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { cn } from "@/lib/utils";

interface FinanceLayoutProps {
  children: ReactNode;
}

// Matches the purchasing module's tab-bar shape exactly (frontend/app/(tenant)/app/purchasing/layout.tsx).
const TABS = [
  { href: "/app/finance/accounts", label: "Accounts" },
  { href: "/app/finance/journal-entries", label: "Journal Entries" },
  { href: "/app/finance/gl", label: "General Ledger" },
  { href: "/app/finance/periods", label: "Periods" },
  { href: "/app/finance/expenses", label: "Expenses" },
  { href: "/app/finance/ap-aging", label: "AP Aging" },
];

function FinanceTabs() {
  const pathname = usePathname();
  return (
    <nav className="mb-4 flex gap-4 border-b">
      {TABS.map((tab) => {
        const active = pathname?.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "border-b-2 px-1 pb-2 text-sm font-medium",
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function FinanceLayout({ children }: FinanceLayoutProps) {
  return (
    <PermissionGuard require="finance.journal.view" fallback={<AccessDenied />}>
      <FeatureGuard feature="FEATURE_FINANCE" failOpenOnError fallback={<AccessDenied />}>
        <FinanceTabs />
        {children}
      </FeatureGuard>
    </PermissionGuard>
  );
}
