"use client";

import * as React from "react";

import { formatDateTime } from "@/lib/format/locale";
import { ConsoleFact, ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import {
  TenantStatusBadge,
  TierBadge,
  tenantStatusConsequence,
} from "@/components/platform/tenant-badges";
import type { PlatformTenant } from "@/lib/models/platform.model";

const DATE_ONLY: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
};

/**
 * Who this tenant is, what state it is in, and when it got there.
 *
 * <h3>Every timestamp here is a decision somebody made</h3>
 *
 * `suspendedAt` and `cancelledAt` are the only two lifecycle instants the tenant row stores, and
 * both are null on a healthy tenant — which is a state and not a missing value. They are rendered
 * as words ("Never suspended") rather than as an em dash, because an operator scanning three
 * identical dashes learns nothing from any of them.
 *
 * <h3>The status carries its consequence, not just its name</h3>
 *
 * "CANCELLED" is a word an operator has to translate before they can act on it, and the translation
 * differs from "SUSPENDED" in exactly the way that matters. The sentence beside the chip is the
 * same one the lifecycle panel and the tenant list use, drawn from one function, so the console
 * cannot end up describing the same state two different ways on two screens.
 */
export function TenantOverviewPanel({ tenant }: { tenant: PlatformTenant }) {
  return (
    <ConsoleSection
      anchorId="overview"
      eyebrow="Overview"
      title="Identity and status"
      description="What this tenant is called, what it resolves as, and whether it is trading right now."
      data-testid="tenant-overview"
    >
      <div className="flex flex-col gap-(--space-md)">
        <div className="flex flex-wrap items-center gap-(--space-sm)">
          <TenantStatusBadge status={tenant.status} />
          <TierBadge tier={tenant.tier} />
          <span className="text-small text-foreground-secondary">
            {tenantStatusConsequence(tenant.status)}
          </span>
        </div>

        <dl className="grid grid-cols-1 gap-(--space-md) md:grid-cols-2 xl:grid-cols-3">
          {/*
            The slug is the operational identifier: login resolves a tenant by it, auth_db mirrors
            it, and nothing in this product propagates a rename — which is why there is no endpoint
            to change it and why it is shown in the mono face beside the id rather than buried.
          */}
          <ConsoleFact label="Slug" value={tenant.slug} mono />
          <ConsoleFact label="Tenant id" value={tenant.id} mono className="md:col-span-1" />
          <ConsoleFact
            label="Created"
            value={formatDateTime(tenant.createdAt, DATE_ONLY)}
            absence="Not recorded"
          />
          <ConsoleFact
            label="Suspended"
            value={tenant.suspendedAt ? formatDateTime(tenant.suspendedAt, DATE_ONLY) : undefined}
            absence="Never suspended"
          />
          <ConsoleFact
            label="Cancelled"
            value={tenant.cancelledAt ? formatDateTime(tenant.cancelledAt, DATE_ONLY) : undefined}
            absence="Never cancelled"
          />
          {/*
            A free-text VARCHAR with no foreign key, no validation and no consumer anywhere in the
            product. It is shown because an operator put it there and needs to find it again; it is
            labelled honestly so nobody reads it as a link to a billing system that does not exist.
          */}
          <ConsoleFact
            label="Billing reference"
            value={tenant.billingRef ?? undefined}
            absence="Not set"
            mono
          />
        </dl>

        {tenant.status === "PROVISIONING_FAILED" && (
          <ConsoleNote tone="warning" data-testid="tenant-provisioning-failed-note">
            The provisioning saga stopped part-way, so this tenant has never been usable — its first
            administrator may not exist and its HQ branch may be missing. Re-drive it from the
            lifecycle panel below rather than creating a second tenant, which would strand this row
            and its slug.
          </ConsoleNote>
        )}
      </div>
    </ConsoleSection>
  );
}
