"use client";

import { useState } from "react";
import { FeatureGuard } from "@/components/shared/feature-guard";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { AccessDenied } from "@/components/shared/access-denied";
import { CustomerList } from "@/components/crm/customer-list";
import { CustomerDetail } from "@/components/crm/customer-detail";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import type { Customer } from "@/lib/models/crm.model";

function CrmPage() {
  const [selected, setSelected] = useState<Customer | null>(null);

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title="Customers"
        description="Find a customer, see their loyalty standing, and review the points they have earned."
      />

      {/* The demo's universal back-office split — a wide list beside a narrow stack
          (DEMO-SCREENS §"the universal two-column body pattern"). `minmax(0,1fr)` on the BASE
          track and not only at `lg`: a grid item defaults to `min-width: auto`, so without it the
          grid refuses to shrink below its content and the list runs past the viewport at 390. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <CustomerList onSelect={setSelected} selectedId={selected?.id ?? null} />
        <CustomerDetail customerId={selected?.id ?? null} />
      </div>
    </PageBody>
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
