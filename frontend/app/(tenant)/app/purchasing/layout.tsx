"use client";

import type { ReactNode } from "react";
import { AccessDenied } from "@/components/shared/access-denied";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { SectionTabs } from "@/components/shared/section-tabs";

const TABS = [
  { href: "/app/purchasing/vendors", label: "Vendors" },
  // Sits before Purchase Orders because it is where an order now starts: the system works out
  // what is low and by how much, and a buyer turns that into a PO rather than typing one blind.
  { href: "/app/purchasing/order-suggestions", label: "Suggested Orders" },
  { href: "/app/purchasing/purchase-orders", label: "Purchase Orders" },
  { href: "/app/purchasing/invoices", label: "Invoices" },
  { href: "/app/purchasing/payments", label: "Payments" },
  { href: "/app/purchasing/analytics", label: "Analytics" },
];

export default function PurchasingLayout({ children }: { children: ReactNode }) {
  return (
    <PermissionGuard require="vendor.view" fallback={<AccessDenied />}>
      <FeatureGuard feature="FEATURE_VENDOR" failOpenOnError fallback={<AccessDenied />}>
        {/* See the note in inventory/layout.tsx: 24px of padding a side is 14% of a 390px
            viewport spent on nothing. */}
        <div className="p-(--space-md) md:p-6">
          <SectionTabs tabs={TABS} label="Purchasing" testId="purchasing-tabs" />
          {children}
        </div>
      </FeatureGuard>
    </PermissionGuard>
  );
}
