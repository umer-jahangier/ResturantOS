"use client";

import type { ReactNode } from "react";

import { AccessDenied } from "@/components/shared/access-denied";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { SectionTabs } from "@/components/shared/section-tabs";

/**
 * The HR configuration area.
 *
 * <p>Gated on `hr.config.view`, not `hr.config.manage`: a manager who can read the department list
 * to fill in an employee form should be able to see what is on it. The individual write actions
 * inside each screen are gated on `manage`, so a reader sees the lists without the buttons —
 * which is more useful than a locked door, because it answers "what departments do we have?".
 */
const TABS = [
  { href: "/app/hr/settings/departments", label: "Departments" },
  { href: "/app/hr/settings/designations", label: "Job titles" },
  { href: "/app/hr/settings/tax", label: "Tax & EOBI" },
];

export default function HrSettingsLayout({ children }: { children: ReactNode }) {
  return (
    <PermissionGuard require="hr.config.view" fallback={<AccessDenied />}>
      <SectionTabs tabs={TABS} label="HR settings" testId="hr-settings-tabs" />
      {children}
    </PermissionGuard>
  );
}
