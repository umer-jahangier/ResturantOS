"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";

import { cn } from "@/lib/utils";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { MoneyDisplay } from "@/components/ui/money-display";
import { ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { formatNumber } from "@/lib/format/locale";
import {
  roleCodeLabel,
  type BranchRoleAssignment,
  type PlatformUserDetail,
} from "@/lib/models/platform-access.model";

/**
 * What this person is allowed to do, and where.
 *
 * <h3>An empty role list is the headline, not a blank table</h3>
 *
 * A user with no active branch-role assignment cannot log in at all: permission resolution fails
 * before a token is minted, so the account looks created and is unusable. That is a defect this
 * product has actually shipped, and it is the reason the assignments travel on the user detail
 * rather than behind a second call. An empty grid saying "no rows" would render the most important
 * fact on this screen as an absence of data.
 *
 * <h3>Branch ids are ids here, deliberately</h3>
 *
 * Branches live in `user_db` and the platform service reaches them only one call per tenant, so
 * resolving 4 ids to names would put an extra cross-service call on a detail screen to decorate a
 * column. The honest answer is the id, in the mono face, which is also what a support conversation
 * and a log line both name.
 *
 * <h3>Station scopes: three answers, not two</h3>
 *
 * `null` means the assignments could not be READ on this request — with the reason travelling in
 * `stationScopeNote`. An empty list means no branch restricts this person to particular stations,
 * which is UNRESTRICTED: a user with no station rows sees every station at their branch, and that
 * is the product's default rather than a gap. Collapsing the first into the second would tell an
 * operator somebody has access to every station when nobody knows whether they have any.
 */
export function UserAccessPanel({ user }: { user: PlatformUserDetail }) {
  const roles = user.branchRoles;

  const columns = React.useMemo<ColumnDef<BranchRoleAssignment, unknown>[]>(
    () => [
      {
        id: "role",
        header: "Role",
        accessorFn: (row) => row.roleCode,
        cell: ({ row }) => (
          <span className="block py-1.5">
            <span className="block font-medium text-foreground">
              {roleCodeLabel(row.original.roleCode)}
            </span>
            <span className="block font-mono text-label text-foreground-tertiary">
              {row.original.roleCode}
            </span>
          </span>
        ),
      },
      {
        id: "branch",
        header: "Branch",
        accessorFn: (row) => row.branchId,
        meta: { mono: true },
        cell: ({ row }) => (
          <span className="text-foreground-secondary">{row.original.branchId.slice(0, 8)}</span>
        ),
      },
      {
        id: "primary",
        header: "Primary",
        accessorFn: (row) => (row.primary ? 1 : 0),
        cell: ({ row }) =>
          row.original.primary ? (
            <span className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-label font-semibold text-primary">
              Primary branch
            </span>
          ) : (
            <span className="text-foreground-tertiary">—</span>
          ),
      },
      {
        id: "limit",
        // "Approval ceiling", not "Limit": the figure is what this assignment lets them approve, and
        // a column headed with the bare noun reads as an amount they have spent.
        header: "Approval ceiling",
        accessorFn: (row) => row.approvalLimitPaisa ?? -1,
        meta: { mono: true, align: "end" },
        cell: ({ row }) =>
          // Null is "no per-assignment limit" — a state, and emphatically not a zero, which would
          // read as "may approve nothing".
          row.original.approvalLimitPaisa === null ? (
            <span className="whitespace-nowrap text-foreground-tertiary">No limit set</span>
          ) : (
            <MoneyDisplay paisa={row.original.approvalLimitPaisa} />
          ),
      },
    ],
    [],
  );

  return (
    <ConsoleSection
      anchorId="access"
      eyebrow="Access"
      title="Roles, branches and stations"
      description="What this account is entitled to do, and at which branch. Read-only from the platform tier."
      data-testid="user-access"
    >
      <div className="flex flex-col gap-(--space-md)">
        {roles.length === 0 ? (
          <ConsoleNote tone="warning" role="alert" data-testid="user-no-roles">
            <span className="inline-flex items-center gap-2 font-semibold">
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              This account holds no active branch-role assignment.
            </span>{" "}
            It cannot be used: permission resolution fails before a token is minted, so sign-in
            fails no matter how correct the password is. Nothing on this console can fix it —
            assigning a role is a tenant-tier action, bounded by a role ceiling a platform operator
            does not have. A tenant administrator has to grant one.
          </ConsoleNote>
        ) : (
          <>
            <p className="text-small text-foreground-secondary" data-testid="user-role-summary">
              <span className="font-medium text-foreground">
                {formatNumber(roles.length)} {roles.length === 1 ? "assignment" : "assignments"}
              </span>{" "}
              across {formatNumber(new Set(roles.map((role) => role.branchId)).size)}{" "}
              {new Set(roles.map((role) => role.branchId)).size === 1 ? "branch" : "branches"}. One
              active role per branch is the product&apos;s rule, so this is also the list of
              branches this person works at.
            </p>

            <DataGrid
              columns={columns}
              data={roles}
              label={`Branch roles held by ${user.fullName ?? user.email}`}
              getRowId={(row) => `${row.branchId}:${row.roleCode}`}
              density="compact"
              emptyTitle="No branch roles"
              emptyDescription="An account with no assignment cannot sign in."
              card={{
                primary: (row) => roleCodeLabel(row.roleCode),
                secondary: (row) => <span className="font-mono">{row.branchId.slice(0, 8)}</span>,
                trailing: (row) =>
                  row.approvalLimitPaisa === null ? (
                    <span className="text-label text-foreground-tertiary">No limit</span>
                  ) : (
                    <MoneyDisplay paisa={row.approvalLimitPaisa} />
                  ),
              }}
            />
          </>
        )}

        <StationScopes user={user} />
      </div>
    </ConsoleSection>
  );
}

/**
 * The three answers, kept apart.
 *
 * The dashed-hairline treatment is this console's established rendering for "there is no honest
 * reading here", so an unreadable scope looks ISSUED rather than broken — and looks different from
 * the perfectly ordinary state of a person who is not restricted to particular stations.
 */
function StationScopes({ user }: { user: PlatformUserDetail }) {
  const scopes = user.stationScopes;

  return (
    <div className="flex flex-col gap-2 border-t pt-(--space-md)">
      <p className="text-label font-semibold tracking-eyebrow text-foreground-tertiary uppercase">
        Station scope
      </p>

      {scopes === null ? (
        <ConsoleNote tone="warning" role="alert" data-testid="user-station-unreadable">
          <span className="font-semibold">Station assignments could not be read.</span>{" "}
          {user.stationScopeNote ??
            "The upstream call did not answer on this request, and no reason came back with it."}{" "}
          This is not the same as &ldquo;no restrictions&rdquo; — nobody currently knows which
          stations this person is scoped to.
        </ConsoleNote>
      ) : scopes.length === 0 ? (
        <p className="text-small text-foreground-secondary" data-testid="user-station-unrestricted">
          No branch restricts this person to particular stations, so they see{" "}
          <span className="font-medium text-foreground">every station</span> at each branch they
          work. That is the product&apos;s default and is what most accounts look like — an absent
          restriction, not an empty assignment.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="user-station-scopes">
          {scopes.map((scope) => (
            <li
              key={scope.branchId}
              className="flex flex-wrap items-center gap-2 rounded-lg border bg-surface-2 p-(--space-sm)"
            >
              <span className="font-mono text-label text-foreground-tertiary">
                {scope.branchId.slice(0, 8)}
              </span>
              {scope.unrestricted ? (
                <span className="text-small text-foreground-secondary">
                  Every station at this branch
                </span>
              ) : (
                <span className="flex flex-wrap gap-1.5">
                  {scope.stationCodes.map((code) => (
                    <span
                      key={code}
                      className={cn(
                        "inline-flex items-center rounded-full border bg-decorative px-2 py-0.5",
                        "font-mono text-label text-foreground-secondary",
                      )}
                    >
                      {code}
                    </span>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
