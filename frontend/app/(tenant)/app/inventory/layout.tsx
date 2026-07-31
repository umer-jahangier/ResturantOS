"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccessDenied } from "@/components/shared/access-denied";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { cn } from "@/lib/utils";

// Owned by plan 08.2-14 for the whole phase — plans 08.2-15/16/17 must not modify this list.
// "Setup" was added afterwards, for the two master-data lists that had no screen: units of measure
// and storage locations. It sits last because it is configured once and then rarely revisited,
// unlike the four operational tabs before it.
const TABS = [
  { href: "/app/inventory/ingredients", label: "Ingredients" },
  { href: "/app/inventory/categories", label: "Categories" },
  { href: "/app/inventory/recipes", label: "Recipes" },
  { href: "/app/inventory/coverage", label: "Coverage" },
  { href: "/app/inventory/stock", label: "Stock" },
  { href: "/app/inventory/setup", label: "Setup" },
];

function InventoryTabs() {
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

export default function InventoryLayout({ children }: { children: ReactNode }) {
  return (
    <PermissionGuard require="inventory.item.view" fallback={<AccessDenied />}>
      <FeatureGuard feature="FEATURE_INVENTORY" failOpenOnError fallback={<AccessDenied />}>
        <div className="p-6">
          <InventoryTabs />
          {children}
        </div>
      </FeatureGuard>
    </PermissionGuard>
  );
}
