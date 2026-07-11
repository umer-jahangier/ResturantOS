"use client";

import type { ReactNode } from "react";
import { FeatureGuard } from "@/components/shared/feature-guard";

export default function PurchasingLayout({ children }: { children: ReactNode }) {
  return (
    <FeatureGuard feature="FEATURE_VENDOR" failOpenOnError>
      <div className="p-6">{children}</div>
    </FeatureGuard>
  );
}
