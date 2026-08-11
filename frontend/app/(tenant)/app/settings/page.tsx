"use client";

import Link from "next/link";
import { ArrowRight, Palette, Users } from "lucide-react";

import { AccessDenied } from "@/components/shared/access-denied";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { BranchSettingsForm } from "@/components/settings/branch-settings-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

/**
 * Settings — GA-009.
 *
 * <p>`/app/settings` was a 404 for OWNER and TENANT_ADMIN alike, with its nav entry hidden by
 * `comingSoon: true` so the owner could not even see that it was missing. This is the page.
 *
 * <h3>What it is built on, and why that is the whole design</h3>
 *
 * There is no tenant-settings API. Measured, live, as TENANT_ADMIN: `/api/v1/tenant-profile`,
 * `/api/v1/tenants/{id}/settings`, `/api/v1/tenants/{id}/theme`, `/api/v1/settings` and
 * `/api/v1/onboarding` all 404. `GET`/`PUT /api/v1/branches/{id}` answer 200.
 *
 * <p>So the page leads with the thing that genuinely saves — branch details — and links to the two
 * neighbouring surfaces. It does not offer a row of switches backed by `localStorage`, because a
 * control that looks saved and is not is worse than an absent one: the user stops looking for the
 * setting and believes it is applied.
 *
 * <h3>Appearance is labelled, not hidden</h3>
 *
 * Settings → Appearance stores a brand colour in this browser's `localStorage` and nowhere else.
 * That is stated on its card here, and again on the page itself, rather than left to be discovered
 * when a colleague's screen looks different.
 */
function SettingsPage() {
  const { branchId, permissions, roles } = useCurrentUser();
  const canManageUsers =
    permissions.includes("rbac.manage") || permissions.includes("rbac.user.manage");
  const canSeeAppearance = roles.includes("OWNER") || roles.includes("TENANT_ADMIN");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          How this branch is set up, and who can sign in to it.
        </p>
      </div>

      <BranchSettingsForm branchId={branchId || null} />

      <div className="grid gap-4 sm:grid-cols-2">
        {canManageUsers && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="size-4" aria-hidden="true" />
                Users
              </CardTitle>
              <CardDescription>
                Add staff, set what they can do on each branch, and issue a password when someone is
                locked out.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/app/users"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Manage users <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </CardContent>
          </Card>
        )}

        {canSeeAppearance && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="size-4" aria-hidden="true" />
                Appearance
              </CardTitle>
              <CardDescription>
                Brand colour and logo. Stored in this browser only — it is not saved to your
                account, so colleagues and your other devices see the default.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/settings/appearance"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Change appearance <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <PermissionGuard
      require={["rbac.manage", "branch.manage"]}
      mode="any"
      fallback={<AccessDenied />}
    >
      <SettingsPage />
    </PermissionGuard>
  );
}
