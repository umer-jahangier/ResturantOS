"use client";

import type { ReactNode } from "react";

import { AccessDenied } from "@/components/shared/access-denied";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";

interface FinanceLayoutProps {
  children: ReactNode;
}

export default function FinanceLayout({ children }: FinanceLayoutProps) {
  return (
    <PermissionGuard require="finance.journal.view" fallback={<AccessDenied />}>
      <FeatureGuard feature="FEATURE_FINANCE" failOpenOnError fallback={<AccessDenied />}>
        {children}
      </FeatureGuard>
    </PermissionGuard>
  );
}
