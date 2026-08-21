"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { StatusBadge } from "@/components/ui/status-badge";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useMyBranches } from "@/lib/hooks/auth/use-my-branches";
import { useUserDetail } from "@/lib/hooks/use-users";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-2 last:border-b-0">
      <span className="text-small text-muted-foreground">{label}</span>
      <span className="text-right text-small">{children}</span>
    </div>
  );
}

/**
 * Who you are signed in as.
 *
 * <h3>Why some of this is conditional, and why that is stated rather than hidden</h3>
 *
 * <b>There is no self-profile endpoint.</b> Measured live as a MANAGER through the real gateway:
 * `GET /api/v1/auth/me` → 404, `GET /api/v1/me` → 404, `GET /api/v1/auth/profile` → 404. The access
 * token carries `sub`, `tenant_id`, `branch_id`, `roles`, `permissions`, `attributes` and
 * `totp_verified` — and no email address.
 *
 * <p>So this panel assembles what can be known truthfully:
 *
 * <ul>
 *   <li><b>Roles, permissions, active branch</b> — from the signed JWT, available synchronously.</li>
 *   <li><b>Branch assignments</b> — `GET /api/v1/branches/mine`, open to any authenticated user.</li>
 *   <li><b>Email, display name, 2FA enrolment, last sign-in</b> — only from
 *       `GET /api/v1/users/{id}`, which is gated on an administration authority. An administrator
 *       reading their OWN row is allowed; everybody else gets a 403.</li>
 * </ul>
 *
 * <p>For the roles that cannot read that row, the panel says so in one sentence instead of showing
 * a blank field. A blank field claims the value is empty; the truth is that nothing in this
 * platform can tell a waiter their own email address, and that is worth someone reading.
 */
export function ProfilePanel() {
  const { userId, branchId, roles, permissions } = useCurrentUser();
  const branches = useMyBranches();

  // Only ask when the answer can be a 200. A guaranteed 403 rendered through QueryBoundary is a
  // red error box on every waiter's profile page reporting a rule working exactly as intended.
  const canReadOwnRow =
    permissions.includes("rbac.manage") || permissions.includes("rbac.user.manage");
  const detail = useUserDetail(canReadOwnRow ? userId : null);

  const activeBranch = branches.data?.find((b) => b.id === branchId);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Your details</CardTitle>
          {!canReadOwnRow && (
            <CardDescription>
              This platform has no endpoint that returns your own account details, so your email
              address and sign-in history cannot be shown here yet. Everything below comes from your
              signed-in session.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <dl className="space-y-0">
            {canReadOwnRow && (
              <QueryBoundary query={detail} what="your account details">
                {detail.data && (
                  <>
                    <Row label="Email">
                      <span className="break-all">{detail.data.user.email}</span>
                    </Row>
                    <Row label="Name">{detail.data.user.fullName ?? "Not set"}</Row>
                    <Row label="Two-factor authentication">
                      {detail.data.user.totpEnabled ? "Enrolled" : "Not enrolled"}
                    </Row>
                  </>
                )}
              </QueryBoundary>
            )}

            <Row label="Roles">
              <span className="inline-flex flex-wrap justify-end gap-1">
                {roles.length === 0
                  ? "None"
                  : roles.map((role) => <StatusBadge key={role} status="active" label={role} />)}
              </span>
            </Row>

            <Row label="Active branch">
              {branches.isPending
                ? "Loading…"
                : (activeBranch?.name ?? (branchId ? branchId : "None"))}
            </Row>

            <Row label="Permissions">
              <span className="tabular-nums">{permissions.length}</span>
            </Row>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Where you work</CardTitle>
          <CardDescription>
            The branches you are assigned to, and what you are there. Only an administrator can
            change these.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QueryBoundary
            query={branches}
            what="your branches"
            isEmpty={(branches.data ?? []).length === 0}
            empty={
              <p className="py-2 text-small text-warning-foreground">
                You hold no role on any branch. Ask an administrator to assign you one.
              </p>
            }
          >
            <ul className="divide-y rounded-md border">
              {(branches.data ?? []).map((branch) => (
                <li key={branch.id} className="flex items-center justify-between px-3 py-2 text-small">
                  <span className="truncate">
                    {branch.name}
                    {branch.isHq ? " (HQ)" : ""}
                  </span>
                  <StatusBadge status="active" label={branch.roleCode} />
                </li>
              ))}
            </ul>
          </QueryBoundary>
        </CardContent>
      </Card>
    </div>
  );
}
