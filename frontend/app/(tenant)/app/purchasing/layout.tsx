"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/app/purchasing/vendors", label: "Vendors" },
  { href: "/app/purchasing/analytics", label: "Analytics" },
];

function PurchasingTabs() {
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

export default function PurchasingLayout({ children }: { children: ReactNode }) {
  return (
    <FeatureGuard feature="FEATURE_VENDOR" failOpenOnError>
      <div className="p-6">
        <PurchasingTabs />
        {children}
      </div>
    </FeatureGuard>
  );
}
