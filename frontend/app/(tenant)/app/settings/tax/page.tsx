"use client";

import Link from "next/link";

import { AccessDenied } from "@/components/shared/access-denied";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { PageHeader } from "@/components/ui/page-header";
import { TaxClassManager } from "@/components/settings/tax-class-manager";
import { ZoneProvider } from "@/components/providers/zone-provider";

/**
 * URL: /app/settings/tax — F16.
 *
 * <h2>What was missing</h2>
 *
 * <p>All of it. The 2026-08-12 walkthrough drove `/app/settings/tax`, `/app/settings/taxes`,
 * `/app/finance/tax` and `/app/menu/tax` as the OWNER and got "This page doesn't exist" from every
 * one, with no tax entry anywhere in a 35-item sidebar. A rate could be typed onto one dish at a
 * time and nowhere else, so the walkthrough's own bill taxed a Rs 1,657.00 subtotal Rs 25.60 —
 * 1.5% — because two lines had a rate and the rest had none.
 *
 * <h2>The permission, and why it is a new one</h2>
 *
 * <p>Gated on `pos.tax.manage`, granted to OWNER and TENANT_ADMIN (auth changeset 091). Deciding
 * that a curry is standard-rated is menu work and stays on `pos.menu.manage`, which a branch
 * MANAGER holds. Deciding that "standard rate" MEANS 17% is a statutory fact about the business:
 * when it is wrong it is wrong for every dish at once, and what it mis-states is the tax return.
 * `pos.menu.manage` was NOT widened to reach this screen — the decision was given its own name,
 * the same split 083 made for tables and 085 for terminals.
 *
 * <h2>Not to be confused with the payroll tax screen</h2>
 *
 * <p>`/app/hr/settings/tax` is income-tax withholding bands for payslips and is a different
 * subject entirely. This one is sales tax on what the restaurant sells. The link below exists
 * because an owner looking for "tax" will land on whichever they find first.
 */
function TaxSettingsPage() {
  return (
    /* ZONE: expressive (D-34-02) — settings is named in that decision's table, and this page is
       nested inside the restrained back-office shell exactly as /app/settings is. */
    <ZoneProvider zone="expressive" className="space-y-6">
      <PageHeader
        title="Sales tax"
        description={
          <>
            The rates you charge guests. Set a rate here once, then apply it to a menu category on{" "}
            <Link href="/app/menu/items" className="underline underline-offset-2">
              Menu Items
            </Link>{" "}
            — every dish in that category inherits it, and a single dish can be given its own.
          </>
        }
      />

      <TaxClassManager />

      <p className="text-muted-foreground text-label">
        Looking for payroll withholding instead? Income-tax bands for payslips live on{" "}
        <Link href="/app/hr/settings/tax" className="underline underline-offset-2">
          HR → Tax settings
        </Link>
        .
      </p>
    </ZoneProvider>
  );
}

export default function TaxSettingsRoute() {
  return (
    <PermissionGuard
      require={["pos.tax.manage", "rbac.manage"]}
      mode="any"
      fallback={
        <AccessDenied
          title="Access denied"
          description="Setting the rates the whole menu is priced against needs the sales-tax permission. An owner or a tenant administrator holds it — a branch manager can still classify a dish on the Menu Items screen."
        />
      }
    >
      <TaxSettingsPage />
    </PermissionGuard>
  );
}
