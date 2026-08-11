"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { AccessDenied } from "@/components/shared/access-denied";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { cn } from "@/lib/utils";

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
  const pathname = usePathname();
  return (
    <PermissionGuard require="hr.config.view" fallback={<AccessDenied />}>
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
      {children}
    </PermissionGuard>
  );
}
