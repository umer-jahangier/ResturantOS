"use client";

import { AccessDenied } from "@/components/shared/access-denied";
import { AuditLog } from "@/components/audit/audit-log";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { ZoneProvider } from "@/components/providers/zone-provider";

/**
 * URL: `/app/settings/audit` — F4.
 *
 * <h2>What was missing</h2>
 *
 * <p>The screen, and only the screen. The 2026-08-12 walkthrough recorded `/app/audit`,
 * `/app/settings/audit`, `/app/admin/audit` and `/app/settings/security` all answering 404 to the
 * OWNER, and zero navigation entries anywhere in the product matching audit, log, activity, history
 * or security — while `GET /api/v1/audit/events` answered 200 with `ORDER_VOIDED ×4`,
 * `TILL_OPENED`, `TILL_CLOSED`, `JOURNAL_POSTED ×12`, `USER_CREATED`, `ROLE_GRANTED` and
 * `PASSWORD_CHANGED`. The data, the permission, the endpoint, the gateway route and the
 * append-only guarantees were all in place. Nobody in the building could read any of it.
 *
 * <h2>Why this URL, and why under Settings</h2>
 *
 * <p>`/app/settings/audit` rather than `/app/audit`: this is an administrative record, sat beside
 * Users and Service health, reached by the same two roles and from the same part of the sidebar.
 * A top-level entry would put it in the working set of people who cannot open it.
 *
 * <h2>The refusal names the permission</h2>
 *
 * <p>A cashier who reaches this URL is told which permission is missing and who holds it — not
 * shown an empty log, and not shown a bare "Access denied". The distinction matters more here than
 * anywhere: an empty audit log shown to someone who was merely not allowed to look is the product
 * asserting that nothing happened, which is the exact opposite of what happened.
 *
 * <p>The guard is `audit.log.view` alone. It is deliberately NOT widened to `rbac.manage` or
 * `branch.manage`: `audit.log.view` is seeded by auth changelog 059 and granted by 060 to OWNER and
 * TENANT_ADMIN, and the endpoint behind this screen `@PreAuthorize`s exactly that code. A guard
 * broader than the endpoint produces a screen that renders and then fails; a guard narrower than
 * the endpoint hides a screen someone is entitled to. They must be the same code, and they are.
 */
function AuditLogPage() {
  return (
    /*
     * ZONE: expressive — the zone `/app/settings` and `/app/settings/health` both declare (D-34-02),
     * so this reads as part of the same administrative area rather than as a stray console.
     */
    <ZoneProvider zone="expressive" className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Every sign-in, void, refund, till session, role change and journal posting in this
          business, with who did it and when. These records cannot be edited or deleted by anyone,
          including an owner.
        </p>
      </div>

      <AuditLog />
    </ZoneProvider>
  );
}

export default function AuditLogRoute() {
  return (
    <PermissionGuard
      require="audit.log.view"
      fallback={
        <AccessDenied
          title="You cannot read the audit log"
          description="Reading it needs the audit.log.view permission, which an owner or a tenant administrator holds. It is deliberately not given to managers or cashiers: the log records their own voids and sign-ins, and someone who can read it can see whether anyone is looking. Ask an owner if you need something from it."
        />
      }
    >
      <AuditLogPage />
    </PermissionGuard>
  );
}
