"use client";

import type { ReactNode } from "react";
import { AccessDenied } from "@/components/shared/access-denied";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { SectionTabs } from "@/components/shared/section-tabs";

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

export default function InventoryLayout({ children }: { children: ReactNode }) {
  return (
    <PermissionGuard require="inventory.item.view" fallback={<AccessDenied />}>
      <FeatureGuard feature="FEATURE_INVENTORY" failOpenOnError fallback={<AccessDenied />}>
        {/* 38-14: `p-6` is 24px of padding on a 390px screen — 48px of a 342px content box spent
            before anything is drawn. Below `md` it drops to `--space-md`, which is the difference
            between the six tabs wrapping onto two lines and wrapping onto three. */}
        <div className="p-(--space-md) md:p-6">
          <SectionTabs tabs={TABS} label="Inventory" testId="inventory-tabs" />
          {children}
        </div>
      </FeatureGuard>
    </PermissionGuard>
  );
}
