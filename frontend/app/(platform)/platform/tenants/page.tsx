"use client";

import * as React from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { CreateTenantDialog } from "@/components/platform/create-tenant-dialog";
import { TenantDirectory } from "@/components/platform/tenant-directory";

/**
 * URL: `/platform/tenants` — the tenant register (GA-050, GA-053).
 *
 * <h3>What this route is</h3>
 *
 * The list an operator opens to answer three questions: which restaurants are on the platform, which
 * of them are not serving right now, and which one am I looking for. Filters and the grid live in
 * `TenantDirectory`; this file is the route, the page heading and the one action that creates
 * something.
 *
 * <h3>What it will not show, and why that is the feature</h3>
 *
 * UI-SPEC §7.5 sketches columns for MRR and last-active. Neither exists in any API this console can
 * call, and neither exists in the product at all: there is no billing anywhere in these sixteen
 * services, and no per-tenant activity timestamp is recorded. They are omitted rather than filled
 * with a plausible-looking placeholder, for the same reason the usage panel refuses to render a
 * zero — a fabricated figure on a control plane is acted on.
 *
 * <p>The ENTITLEMENT ceilings are shown, and they are labelled as ceilings. `maxBranches`,
 * `maxUsers`, `storageGb` and `nlqQuota` have come back on every row of this endpoint since Phase 3
 * and, before the console existed, grepping the entire frontend for those four names returned zero
 * matches (GA-083). Tier alone does not tell an operator what a tenant is entitled to — `CUSTOM` in
 * particular means nothing without its numbers.
 */
export default function PlatformTenantsPage() {
  const [createOpen, setCreateOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-(--space-lg)">
      <PageHeader
        title="Tenants"
        description="Every restaurant group on the platform, the state it is in, and what its tier entitles it to."
        actions={
          <Button onClick={() => setCreateOpen(true)} data-testid="create-tenant-open">
            <Plus className="size-4" aria-hidden="true" />
            Create tenant
          </Button>
        }
      />

      <TenantDirectory onCreate={() => setCreateOpen(true)} />

      <CreateTenantDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
