import { TenantDashboard } from "@/components/dashboard/tenant-dashboard";
import { ZoneProvider } from "@/components/providers/zone-provider";

// URL: /app/dashboard (protected). Branch KPIs + recent orders for admin/cashier; KDS entry for kitchen.
//
// ZONE: expressive (D-34-02) — nested inside the restrained back-office shell. This is
// the nesting case the containment gate must handle correctly, and it exists from the
// start of the phase for exactly that reason: the page is richer than the chrome above
// it, and the chrome must not inherit the page's richness downward onto the POS.
export default function TenantDashboardPage() {
  return (
    <ZoneProvider zone="expressive">
      <TenantDashboard />
    </ZoneProvider>
  );
}
