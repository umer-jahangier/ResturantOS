"use client";

import type { ReactNode } from "react";

import { AccessDenied } from "@/components/shared/access-denied";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { SectionTabs } from "@/components/shared/section-tabs";

const TABS = [
  { href: "/app/hr/employees", label: "Employees" },
  { href: "/app/hr/payroll", label: "Payroll" },
  { href: "/app/hr/schedule", label: "Schedule" },
  { href: "/app/hr/attendance", label: "Attendance & Leave" },
  // 35-11: departments, job titles and the tax table are tenant-managed and had no screen at all.
  // A page nothing links to is a page that does not exist.
  { href: "/app/hr/settings", label: "Settings" },
];

export default function HrLayout({ children }: { children: ReactNode }) {
  return (
    <PermissionGuard require="hr.employee.view" fallback={<AccessDenied />}>
      <FeatureGuard feature="FEATURE_HR" failOpenOnError fallback={<AccessDenied />}>
        <SectionTabs tabs={TABS} label="People" testId="hr-tabs" />
        {children}
      </FeatureGuard>
    </PermissionGuard>
  );
}
