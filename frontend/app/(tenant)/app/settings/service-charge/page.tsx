"use client";

import { AccessDenied } from "@/components/shared/access-denied";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { PageHeader } from "@/components/ui/page-header";
import { ServiceChargeForm } from "@/components/settings/service-charge-form";
import { ZoneProvider } from "@/components/providers/zone-provider";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

/**
 * URL: /app/settings/service-charge — F20.
 *
 * <h2>What was actually missing</h2>
 *
 * <p>The whole spine already existed. `orders.service_charge_paisa` has been in the schema since
 * the first POS migration; `DailyTakingsService.headerTotals` sums it, `ORDER_CLOSED` carries it,
 * `AutoPostingRecipeEngine` credits it to account 4910 "Service Charges",
 * `ReceiptDocumentAssembler` puts it on the printed bill and the charge page renders it. What
 * never existed was any way to make the number non-zero. Measured live on 2026-08-12:
 * `service_charge_paisa` non-zero on <b>0 of 195</b> orders, while the charge page and every
 * guest's receipt printed <code>Service charge Rs 0.00</code> — a charge the restaurant is told
 * about, cannot influence, and never collects.
 *
 * <h2>The permission, and why it is a new one</h2>
 *
 * <p>Gated on `pos.service_charge.manage`, granted to OWNER and TENANT_ADMIN (auth changeset 093).
 * `pos.menu.manage` — which a branch MANAGER holds — prices one dish; this re-prices every check
 * in the building at once, including checks already open, and there is no reason code and no
 * per-check record of who decided it. `pos.tax.manage` was the other candidate and is wrong on
 * its own terms: a service charge is not a tax, it is the restaurant's own revenue.
 *
 * <p>A MANAGER is deliberately admitted to this page and finds every control disabled, because
 * `ServiceChargeServiceImpl.get` gates the READ on `pos.menu.view`. The charge is on every bill
 * they hand a guest; being refused the page would leave them defending a number the product hides
 * from them.
 *
 * <h2>Reached from the sidebar</h2>
 *
 * <p>Registered in `sidebar-nav-items.ts` beside Printers. A screen with no navigation entry is a
 * screen nobody finds — which is how the printer screen stayed unbuilt for a phase and a half.
 */
function ServiceChargePage() {
  const { branchId } = useCurrentUser();

  return (
    /*
     * ZONE: expressive (D-34-02) — settings is named in that decision's table. Nested inside the
     * restrained back-office shell exactly as /app/settings and /app/settings/printers are.
     */
    <ZoneProvider zone="expressive" className="space-y-6">
      <PageHeader
        title="Service charge"
        description="What this branch adds to a check for table service, and which channels it applies to."
      />

      <ServiceChargeForm branchId={branchId || null} />
    </ZoneProvider>
  );
}

export default function ServiceChargeRoute() {
  return (
    <PermissionGuard
      require={["pos.service_charge.manage", "pos.menu.view"]}
      mode="any"
      fallback={
        <AccessDenied
          title="Access denied"
          description="Reading this branch's service charge needs menu access; changing it needs the service-charge permission, which an owner or a tenant administrator holds."
        />
      }
    >
      <ServiceChargePage />
    </PermissionGuard>
  );
}
