"use client";

import { useState } from "react";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { AccessDenied } from "@/components/shared/access-denied";
import { CustomerList } from "@/components/crm/customer-list";
import { CustomerDetail } from "@/components/crm/customer-detail";
import type { Customer } from "@/lib/models/crm.model";

function CrmPage() {
  const [selected, setSelected] = useState<Customer | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Customers</h1>
        <p className="text-sm text-muted-foreground">
          Find a customer, see their loyalty standing, and review the points they have earned.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <CustomerList onSelect={setSelected} selectedId={selected?.id ?? null} />
        <CustomerDetail customerId={selected?.id ?? null} />
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <FeatureGuard feature="FEATURE_CRM" fallback={<AccessDenied />}>
      <PermissionGuard require="crm.customer.view" fallback={<AccessDenied />}>
        <CrmPage />
      </PermissionGuard>
    </FeatureGuard>
  );
}
