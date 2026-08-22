"use client";

import * as React from "react";
import { Check, Lock, ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { DataTableSkeleton } from "@/components/skeletons/data-table-skeleton";
import { FilterBar } from "@/components/ui/filter-bar";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { ConsoleNote, ConsoleSection } from "@/components/platform/console-section";
import { formatNumber } from "@/lib/format/locale";
import { usePlatformPermissions, usePermissionMatrix } from "@/lib/hooks/use-platform-rbac";
import { usePlatformTenants } from "@/lib/hooks/use-platform-tenants";
import {
  permissionLeafLabel,
  permissionModuleLabel,
  roleCodeLabel,
  type PermissionMatrixRow,
} from "@/lib/models/platform-access.model";

/** One row of the grid: a permission, and which roles grant it. */
interface MatrixPermissionRow {
  code: string;
  module: string;
  description: string | null;
  granted: ReadonlySet<string>;
  grantedCount: number;
}

const ID_READ_ONLY_REASON = "rbac-read-only-reason";

/**
 * The role × permission matrix — nine roles, seventy-nine permission codes, and no way to change
 * any of it from here.
 *
 * <h3>Read-only is a posture, and it is rendered as one</h3>
 *
 * Composing a role IS granting authority. At the tenant tier that is bounded by the role ceiling:
 * an assigner may only grant a role whose permissions are a subset of their own, recomputed from
 * the database on every call. A platform operator holds no `user_branch_roles` at all, so the
 * ceiling resolves the empty set against them — there is nothing to bound a platform-tier role
 * editor with, and one would let an operator author a role granting anything and drop it into any
 * tenant. That is the escalation the split of `rbac.manage` out of `rbac.role.manage` exists to
 * prevent, and the platform tier does not hand it back one layer up.
 *
 * <p>The API carries that sentence in every response as `readOnlyReason`, and this screen renders
 * the API's words rather than a local paraphrase: a change of policy on the server then changes
 * what the console says without a frontend release. The Edit control is present and DISABLED, with
 * the reason wired to it by `aria-describedby` — a disabled button that explains itself beats both
 * a hidden control (which reads as a missing feature) and an enabled one that 404s.
 *
 * <h3>Why permissions are the rows and roles are the columns</h3>
 *
 * The other orientation is 79 columns of horizontal scroll. This way the long axis is the one that
 * scrolls vertically, the sticky header keeps the nine role names in view, and the first column —
 * the thing a reader scans — holds the permission.
 *
 * <h3>Every permission is a row, including the ones nobody grants</h3>
 *
 * The API returns EVERY permission as a column, not only the granted ones, and this screen keeps
 * all of them, because the question a matrix is usually opened for is *"what can nobody do?"*. An
 * orphaned permission — one no role grants — produces a clean 403 for every user including OWNER,
 * which is the highest-recurrence defect class in this product and which the auth changelog
 * carries repair changesets for. It gets a filter of its own and a warning hue, so finding it
 * takes one click rather than an eye-scan of 711 cells.
 *
 * <h3>Density is the whole design problem, so the grid collapses four ways</h3>
 *
 * A search over code and description, a domain filter, a "granted by nobody" toggle, and — the one
 * that makes the grid readable — pressing a role in the legend, which narrows the rows to that
 * role's grants. All four are real focusable controls, so the 711 cells are reachable from a
 * keyboard by narrowing rather than by arrowing through them, and the grid itself stays a semantic
 * table with no interactive cells for a screen reader's table commands to fight with.
 */
export function PermissionMatrix() {
  const [tenantId, setTenantId] = React.useState("");
  const [moduleFilter, setModuleFilter] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [onlyOrphans, setOnlyOrphans] = React.useState(false);
  const [focusRole, setFocusRole] = React.useState<string | null>(null);

  const tenants = usePlatformTenants();
  const permissions = usePlatformPermissions();
  const matrix = usePermissionMatrix(tenantId || undefined);

  const data = matrix.data;

  /**
   * Code → its module and description.
   *
   * The catalogue is a SEPARATE query and it is allowed to fail on its own: the grid's structure
   * comes entirely from the matrix, so a missing catalogue costs the descriptions and nothing else.
   * The module then falls back to the code's own prefix, which is where the seeded value comes
   * from anyway — so the grouping survives, and the panel says the descriptions did not load
   * rather than rendering blank cells that look like permissions without a purpose.
   */
  const catalogue = React.useMemo(() => {
    const byCode = new Map<string, { module: string; description: string | null }>();
    for (const mod of permissions.data ?? []) {
      for (const entry of mod.permissions) {
        byCode.set(entry.code, { module: entry.module, description: entry.description });
      }
    }
    return byCode;
  }, [permissions.data]);

  const roles: PermissionMatrixRow[] = React.useMemo(() => data?.rows ?? [], [data]);

  const allRows: MatrixPermissionRow[] = React.useMemo(() => {
    if (!data) return [];
    // One Set per role, built once. Membership is tested 711 times; `Array.includes` per cell
    // would be 711 linear scans of a 60-element array on every render of this screen.
    const grantsByRole = new Map(
      data.rows.map((row) => [row.roleCode, new Set(row.grantedPermissionCodes)] as const),
    );
    return data.permissionCodes.map((code) => {
      const meta = catalogue.get(code);
      const granted = new Set<string>();
      for (const [roleCode, codes] of grantsByRole) {
        if (codes.has(code)) granted.add(roleCode);
      }
      return {
        code,
        module: meta?.module ?? code.split(".")[0] ?? "other",
        description: meta?.description ?? null,
        granted,
        grantedCount: granted.size,
      };
    });
  }, [data, catalogue]);

  const moduleOptions = React.useMemo(() => {
    const seen = new Map<string, number>();
    for (const row of allRows) seen.set(row.module, (seen.get(row.module) ?? 0) + 1);
    return [...seen.entries()].map(([module, count]) => ({
      value: module,
      label: `${permissionModuleLabel(module)} (${formatNumber(count)})`,
    }));
  }, [allRows]);

  const tenantOptions = React.useMemo(
    () => (tenants.data ?? []).map((tenant) => ({ value: tenant.id, label: tenant.brandName })),
    [tenants.data],
  );

  const term = search.trim().toLowerCase();
  const rows = React.useMemo(
    () =>
      allRows.filter((row) => {
        if (moduleFilter && row.module !== moduleFilter) return false;
        if (onlyOrphans && row.grantedCount > 0) return false;
        if (focusRole && !row.granted.has(focusRole)) return false;
        if (
          term &&
          !row.code.toLowerCase().includes(term) &&
          !(row.description ?? "").toLowerCase().includes(term)
        ) {
          return false;
        }
        return true;
      }),
    [allRows, moduleFilter, onlyOrphans, focusRole, term],
  );

  const orphanCount = React.useMemo(
    () => allRows.filter((row) => row.grantedCount === 0).length,
    [allRows],
  );

  const filtered = Boolean(moduleFilter || term || onlyOrphans || focusRole);
  const clearAll = React.useCallback(() => {
    setModuleFilter("");
    setSearch("");
    setOnlyOrphans(false);
    setFocusRole(null);
  }, []);

  const columns = React.useMemo<ColumnDef<MatrixPermissionRow, unknown>[]>(() => {
    const permissionColumn: ColumnDef<MatrixPermissionRow, unknown> = {
      id: "permission",
      header: "Permission",
      accessorFn: (row) => row.code,
      cell: ({ row }) => (
        <span className="block min-w-[15rem] max-w-[24rem] py-1.5">
          <span className="block truncate font-medium text-foreground">
            {permissionLeafLabel(row.original.code)}
          </span>
          <span className="block truncate font-mono text-label text-foreground-tertiary">
            {row.original.code}
          </span>
          {row.original.description && (
            <span className="mt-0.5 block truncate text-label text-foreground-secondary">
              {row.original.description}
            </span>
          )}
        </span>
      ),
    };

    const domainColumn: ColumnDef<MatrixPermissionRow, unknown> = {
      id: "domain",
      header: "Domain",
      accessorFn: (row) => row.module,
      meta: { hideBelow: "lg" },
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-label font-semibold tracking-eyebrow text-foreground-tertiary uppercase">
          {permissionModuleLabel(row.original.module)}
        </span>
      ),
    };

    const roleColumns: ColumnDef<MatrixPermissionRow, unknown>[] = roles.map((role) => ({
      id: `role-${role.roleCode}`,
      /*
        Text, not a control. `DataGrid` wraps every header in its own sort `<button>`, so a button
        here nests one inside another — invalid HTML, and React reports it as a hydration error.
        The per-role narrowing lives on the legend above the grid instead, where the target is a
        card rather than a 6mm column heading and its pressed state is visible without hovering.
      */
      header: () => (
        <span
          data-testid={`rbac-role-${role.roleCode}`}
          className={cn(
            "flex flex-col items-start gap-0.5 py-1 text-start",
            focusRole === role.roleCode && "text-primary",
          )}
        >
          <span className="whitespace-nowrap">{role.roleName ?? roleCodeLabel(role.roleCode)}</span>
          <span className="font-mono text-label tracking-normal normal-case text-foreground-tertiary">
            {formatNumber(role.grantedPermissionCodes.length)} granted
          </span>
        </span>
      ),
      accessorFn: (row) => (row.granted.has(role.roleCode) ? 1 : 0),
      cell: ({ row }) =>
        row.original.granted.has(role.roleCode) ? (
          <span className="flex items-center justify-center">
            <Check className="size-4 text-success" aria-hidden="true" />
            {/* Colour is never the only channel: the glyph carries it visually and this carries
                it to a screen reader, where the row and column headers supply the rest. */}
            <span className="sr-only">Granted</span>
          </span>
        ) : (
          <span className="flex items-center justify-center">
            <span className="size-1.5 rounded-full bg-decorative" aria-hidden="true" />
            <span className="sr-only">Not granted</span>
          </span>
        ),
    }));

    const reachColumn: ColumnDef<MatrixPermissionRow, unknown> = {
      id: "reach",
      header: "Roles",
      accessorFn: (row) => row.grantedCount,
      meta: { mono: true, align: "end" },
      cell: ({ row }) =>
        row.original.grantedCount === 0 ? (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-warning">
            <ShieldAlert className="size-3.5 shrink-0" aria-hidden="true" />
            None
          </span>
        ) : (
          <span>{formatNumber(row.original.grantedCount)}</span>
        ),
    };

    return [permissionColumn, domainColumn, ...roleColumns, reachColumn];
  }, [roles, focusRole]);

  return (
    <ConsoleSection
      anchorId="matrix"
      eyebrow="Authorization"
      title="Roles and permissions"
      description="Every permission this product defines, and which role grants it. Read-only from the platform tier."
      action={
        <Button
          variant="outline"
          size="sm"
          disabled
          aria-describedby={ID_READ_ONLY_REASON}
          data-testid="rbac-edit-disabled"
        >
          <Lock className="size-4" aria-hidden="true" />
          Editing roles
        </Button>
      }
      data-testid="rbac-matrix"
    >
      <div className="flex flex-col gap-(--space-md)">
        {/*
          The posture, first and in full. It is not an error state and it must not be styled as
          one: the neutral note is the same treatment every other stated absence on this console
          gets. `id` is what the disabled Edit control points at, so the button is not merely
          inert — it is inert with a reason a screen reader reads out with it.
        */}
        <div id={ID_READ_ONLY_REASON}>
          {/*
            The id sits on a wrapper rather than on the note itself: `ConsoleNote` is a shared
            console primitive with a closed prop shape, and widening it so this one caller can hang
            an anchor off it is a change four other screens would inherit. `aria-describedby`
            resolves the referenced element's text content either way.
          */}
          <ConsoleNote data-testid="rbac-read-only-reason">
            <span className="font-semibold">Roles are read-only to the platform tier.</span>{" "}
            {data?.readOnlyReason ??
              "Composing a role is granting authority, and the tenant tier bounds that with a role ceiling — an assigner may only grant permissions they already hold. A platform operator holds none, so there is no ceiling to bound them."}
          </ConsoleNote>
        </div>

        <FilterBar
          title="Narrow the matrix"
          search={{
            value: search,
            onChange: setSearch,
            label: "Search permissions by code or description",
            placeholder: "pos.order.void, refund…",
          }}
          filters={[
            {
              id: "scope",
              label: "Catalogue",
              value: tenantId,
              onChange: setTenantId,
              options: tenantOptions,
              allLabel: "Global (system roles)",
              isLoading: tenants.isLoading,
              error: tenants.isError,
              onRetry: () => void tenants.refetch(),
              testId: "rbac-filter-tenant",
            },
            {
              id: "module",
              label: "Domain",
              value: moduleFilter,
              onChange: setModuleFilter,
              options: moduleOptions,
              allLabel: "Every domain",
              testId: "rbac-filter-module",
            },
          ]}
          extraActiveCount={(onlyOrphans ? 1 : 0) + (focusRole ? 1 : 0)}
          onClearAll={clearAll}
          actions={
            <Button
              variant={onlyOrphans ? "default" : "outline"}
              size="sm"
              aria-pressed={onlyOrphans}
              onClick={() => setOnlyOrphans((current) => !current)}
              data-testid="rbac-filter-orphans"
            >
              <ShieldAlert className="size-4" aria-hidden="true" />
              Granted by nobody
              {orphanCount > 0 ? ` (${formatNumber(orphanCount)})` : ""}
            </Button>
          }
        />

        {/*
          The catalogue is a second, independent query. Losing it costs the descriptions and
          nothing structural, so it degrades in place rather than taking the grid down with it —
          a control plane that goes blank because a lookup is unreachable is one you cannot use
          during the incident you opened it for.
        */}
        {permissions.isError && (
          <ConsoleNote tone="warning" role="alert" data-testid="rbac-catalogue-degraded">
            The permission catalogue could not be read, so the plain-language description of each
            code is missing and the domain grouping falls back to the code&apos;s own prefix. The
            grants below come from the matrix and are unaffected.
          </ConsoleNote>
        )}

        <QueryBoundary
          query={matrix}
          what="the role and permission matrix"
          loading={<DataTableSkeleton columns={8} rows={12} />}
          isEmpty={Boolean(data) && allRows.length === 0}
          empty={
            <ConsoleNote tone="warning" data-testid="rbac-empty">
              The authorization catalogue came back with no permissions at all. That is not a state
              this product has — permissions are seeded by Liquibase and every deployment has them —
              so it points at the catalogue read rather than at an empty configuration.
            </ConsoleNote>
          }
        >
          {data ? (
            <div className="flex flex-col gap-(--space-md)">
              <RoleLegend
                roles={roles}
                scope={data.scope}
                focusRole={focusRole}
                onFocusRole={setFocusRole}
              />

              <p className="text-small text-foreground-secondary" data-testid="rbac-summary">
                <span className="font-medium text-foreground">
                  {formatNumber(roles.length)} {roles.length === 1 ? "role" : "roles"} ×{" "}
                  {formatNumber(allRows.length)}{" "}
                  {allRows.length === 1 ? "permission" : "permissions"}
                </span>
                {data.scope === "TENANT"
                  ? " — this tenant's own custom roles included, with the number of people holding each."
                  : " — the system roles every tenant inherits. Holder counts are a per-tenant fact and are shown when a tenant is chosen."}
                {orphanCount > 0 ? (
                  <span className="text-warning">
                    {" "}
                    {formatNumber(orphanCount)}{" "}
                    {orphanCount === 1 ? "permission is" : "permissions are"} granted by no role at
                    all — every user, including the owner, is refused those.
                  </span>
                ) : (
                  <span> Every permission is granted by at least one role.</span>
                )}
                {filtered ? (
                  <span className={cn("font-medium", rows.length === 0 && "text-warning")}>
                    {" "}
                    Filters show {formatNumber(rows.length)} of them.
                  </span>
                ) : null}
              </p>

              <DataGrid
                columns={columns}
                data={rows}
                label={
                  data.scope === "TENANT"
                    ? "Role and permission matrix for this tenant"
                    : "Global role and permission matrix"
                }
                getRowId={(row) => row.code}
                density="compact"
                // 79 permissions today and growing by changeset. One page holds the whole
                // catalogue so that the grid is scrolled rather than paged — a matrix split
                // across pages cannot answer "which role grants the most" at a glance.
                pageSize={100}
                isFiltered={filtered}
                onClearFilters={clearAll}
                emptyTitle="No permissions"
                emptyDescription="Permissions are seeded by the database, so an empty catalogue points at the read rather than at the configuration."
                rowClassName={(row) => (row.grantedCount === 0 ? "bg-warning/5" : undefined)}
                card={{
                  primary: (row) => permissionLeafLabel(row.code),
                  secondary: (row) => <span className="font-mono">{row.code}</span>,
                  trailing: (row) =>
                    row.grantedCount === 0 ? (
                      <span className="text-label font-semibold text-warning">No role</span>
                    ) : (
                      <span className="text-label">
                        {formatNumber(row.grantedCount)} {row.grantedCount === 1 ? "role" : "roles"}
                      </span>
                    ),
                }}
              />
            </div>
          ) : null}
        </QueryBoundary>
      </div>
    </ConsoleSection>
  );
}

/**
 * The nine roles, above the grid they head.
 *
 * <h3>Why a legend and not just column headers</h3>
 *
 * A column header has room for a name and one number. What a reader needs before they can use the
 * grid is three things per role: whether it is a SYSTEM role (global, seeded, editable by nobody at
 * any tier) or one a tenant wrote for itself, how much it grants, and how many people hold it. The
 * third is only meaningful once a tenant is chosen — holders are a per-tenant fact, and a global
 * view reports 0 rather than a fleet-wide sum nobody asked for, which is exactly the kind of zero
 * that gets read as "nobody has this role".
 */
function RoleLegend({
  roles,
  scope,
  focusRole,
  onFocusRole,
}: {
  roles: PermissionMatrixRow[];
  scope: string;
  focusRole: string | null;
  onFocusRole: (role: string | null) => void;
}) {
  return (
    <ul
      className="grid grid-cols-1 gap-(--space-sm) md:grid-cols-2 xl:grid-cols-3"
      data-testid="rbac-role-legend"
    >
      {roles.map((role) => {
        const active = focusRole === role.roleCode;
        return (
          <li key={role.roleCode}>
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onFocusRole(active ? null : role.roleCode)}
              className={cn(
                "flex w-full flex-col items-start gap-1 rounded-lg border p-(--space-sm) text-start",
                "hover:border-primary/40",
                active ? "border-primary/60 bg-primary/10" : "bg-surface-2",
              )}
            >
              <span className="flex w-full items-center gap-2">
                <span className="truncate font-medium text-foreground">
                  {role.roleName ?? roleCodeLabel(role.roleCode)}
                </span>
                <span
                  className={cn(
                    "ms-auto shrink-0 rounded-full border px-2 py-0.5 text-label font-semibold tracking-eyebrow uppercase",
                    role.system
                      ? "border-border bg-decorative text-foreground-secondary"
                      : "border-primary/20 bg-primary/10 text-primary",
                  )}
                >
                  {role.system ? "System" : "Custom"}
                </span>
              </span>
              <span className="font-mono text-label text-foreground-tertiary">{role.roleCode}</span>
              <span className="text-label text-foreground-secondary">
                {formatNumber(role.grantedPermissionCodes.length)} permissions
                {scope === "TENANT" ? (
                  <>
                    {" · "}
                    {formatNumber(role.assignedUserCount)}{" "}
                    {role.assignedUserCount === 1 ? "holder" : "holders"}
                  </>
                ) : null}
              </span>
              <span className="sr-only">
                {active
                  ? "Showing only this role's permissions. Activate to show all again."
                  : "Activate to show only this role's permissions."}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
