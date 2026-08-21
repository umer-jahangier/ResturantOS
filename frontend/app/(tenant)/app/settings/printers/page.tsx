"use client";

import { AccessDenied } from "@/components/shared/access-denied";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { PrintAgentPanel } from "@/components/settings/print-agent-panel";
import { PrinterRegistryForm } from "@/components/settings/printer-registry-form";
import { PageHeader } from "@/components/ui/page-header";
import { ZoneProvider } from "@/components/providers/zone-provider";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

/**
 * URL: /app/settings/printers — S1-06.
 *
 * <h2>What was actually missing</h2>
 *
 * <p>Almost nothing, and that is the point. Phase 26 shipped a complete ESC/POS renderer, a durable
 * agent queue, two transports, a per-branch machine credential with a lease-based claim protocol, a
 * gateway exemption for it, the `print_jobs` table, the after-commit dispatch that writes a row on
 * every fire and every close, the `branches.receipt_config` registry with its validated DTO, and
 * all four frontend layers for that registry. What it never shipped was <b>a page</b>. So every
 * one of those parts was real and none of them could be reached, `/app/settings/printers` was a 404
 * for all four personas, and every bill was a browser print dialog.
 *
 * <h2>The permission, and why it is a new one</h2>
 *
 * <p>Gated on `pos.printers.admin`, granted to OWNER, TENANT_ADMIN and MANAGER — the same holders
 * as `pos.tables.admin` and `pos.terminals.admin`, because deciding which printers a branch has is
 * the same class of decision as deciding which tables and which tills it has, made by the same
 * person on the same day. The endpoints behind this screen shipped gated on `branch.manage`
 * ("create, update and deactivate branches"), which OWNER and TENANT_ADMIN hold and a branch
 * MANAGER does not — so the person who physically installs the printer was refused. `branch.manage`
 * was NOT widened to fix that; the decision was given its own name.
 *
 * <h2>Reached from the sidebar</h2>
 *
 * <p>Registered in `sidebar-nav-items.ts` under MENU, beside Stations and POS Terminals. A screen
 * with no navigation entry is a screen nobody finds, which is how this one stayed unbuilt for a
 * phase and a half without anybody noticing it was the missing piece.
 */
function PrintersPage() {
  const { branchId } = useCurrentUser();

  return (
    /*
     * ZONE: expressive (D-34-02) — settings is named in that decision's table. Nested inside the
     * restrained back-office shell exactly as /app/settings is.
     */
    <ZoneProvider zone="expressive" className="space-y-6">
      <PageHeader
        title="Printers"
        description="The receipt printer at the till and the ticket printers in the kitchen, and the machine that drives them."
      />

      <PrintAgentPanel branchId={branchId || null} />
      <PrinterRegistryForm branchId={branchId || null} />
    </ZoneProvider>
  );
}

export default function PrintersRoute() {
  return (
    <PermissionGuard
      require={["pos.printers.admin", "branch.manage", "rbac.manage"]}
      mode="any"
      fallback={
        <AccessDenied
          title="Access denied"
          description="Configuring this branch's printers needs the printer administration permission. An owner, a tenant administrator or a branch manager holds it."
        />
      }
    >
      <PrintersPage />
    </PermissionGuard>
  );
}
