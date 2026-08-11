"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { AccessDenied } from "@/components/shared/access-denied";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/app/hr/employees", label: "Employees" },
  { href: "/app/hr/payroll", label: "Payroll" },
  { href: "/app/hr/schedule", label: "Schedule" },
  { href: "/app/hr/attendance", label: "Attendance & Leave" },
  // 35-11: departments, job titles and the tax table are tenant-managed and had no screen at all.
  // A page nothing links to is a page that does not exist.
  { href: "/app/hr/settings", label: "Settings" },
];

function HrTabs() {
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
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

export default function HrLayout({ children }: { children: ReactNode }) {
  return (
    <PermissionGuard require="hr.employee.view" fallback={<AccessDenied />}>
      <FeatureGuard feature="FEATURE_HR" failOpenOnError fallback={<AccessDenied />}>
        <HrTabs />
        {children}
      </FeatureGuard>
    </PermissionGuard>
  );
}
