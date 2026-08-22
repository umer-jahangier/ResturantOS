"use client";

import * as React from "react";
import { Check } from "lucide-react";

import type { AssignableRole } from "@/lib/models/user.model";
import type { PermissionEntry, PermissionModule } from "@/lib/models/role.model";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { FilterBar } from "@/components/ui/filter-bar";
import { formatNumber, NO_VALUE } from "@/lib/format/locale";
import { cn } from "@/lib/utils";

/**
 * The permission × role matrix (N6) — every permission this platform understands, against every
 * role this tenant's caller may see, one cell per decision.
 *
 * <h3>What was here before, and why a card grid is not this</h3>
 *
 * <p>`role-list.tsx` renders one card per role with a COUNT ("57 permissions"), and
 * `permission-picker.tsx` renders a nested checklist for ONE role at a time inside a dialog.
 * Between them they answer "what does Cashier grant?" — which is the question 13-07 was written
 * to answer, and they answer it well. Neither answers the question an administrator actually
 * arrives with: <b>"who else can do this?"</b> Comparing two roles today means opening two
 * dialogs in sequence and holding one of them in your head. Nine roles means nine.
 *
 * <h3>The demo is a LAYOUT reference here and explicitly not a DATA reference</h3>
 *
 * <p>`Docs/NEXUS_ERP_Demo.html:1327-1345` draws 7 permissions × 5 roles = 35 cells. Its five
 * columns are *Super Admin · Branch Mgr · Accountant · Cashier · Kitchen*, and
 * APP-DASHBOARD-AUDIT §6.2 #17 measures what is wrong with that list against this system: two of
 * those five are roles this product never mints (`SUPER_ADMIN` is a platform-plane principal with
 * no `roles` row at all; the code is `MANAGER`, not `BRANCH_MANAGER`), and four of the nine real
 * roles — `TENANT_ADMIN`, `WAITER`, `INVENTORY_MANAGER`, `FINANCE_VIEWER` — are simply missing
 * from it. So the grid shape is adopted and the column list is not.
 *
 * <p><b>Nothing in this file names a role or a permission.</b> Both axes arrive as props, from
 * `GET /api/v1/roles` and `GET /api/v1/permissions`. For an OWNER that is the nine real roles and
 * the 79 live codes, which is what this view was asked to render — but it renders them because
 * the server said so, not because a constant here agrees with the server today. `role-list.tsx`
 * and `user.schema.ts:128-129` already record why the frontend must never hold its own copy of
 * the role list: a second, weaker copy of an authorization rule, living in the one place an
 * attacker controls. A hardcoded nine would also silently mis-draw the matrix for a tenant with
 * custom roles, which is the feature `/app/roles` exists to provide.
 *
 * <h3>The demo's two partial-grant words cannot be honoured, and are not faked</h3>
 *
 * <p>The demo's matrix carries `View` on one cell and `Summary` on another. This system's
 * `role_permissions` is a junction table: a role holds a code or it does not. There is no
 * partial grant, no scope qualifier, no "summary" tier — `Finance — View P&L: Summary` cannot be
 * expressed at all, and the P&L it summarises does not exist either (§6.2 #4: zero
 * statement-assembly endpoints in finance-service). Inventing a third glyph to match the demo
 * would be D-38-16's defect exactly: rendering a distinction the system cannot compute. The
 * boolean nature of the grant is therefore STATED on the screen rather than left to be inferred
 * from the absence of a third symbol.
 *
 * <h3>Why `DataGrid` per module, rather than one grid or a hand-rolled matrix</h3>
 *
 * <p>Conformance forbids a hand-rolled `<table>` (G4), and `DataGrid` genuinely fits: a matrix IS
 * a table with a header row, and every property the grid enforces — one row height, sticky
 * headers with `scope="col"`, a card fallback below `md` — is a property a 711-cell matrix needs
 * more than a five-row list does.
 *
 * <p>It is <b>one grid per module</b> rather than one grid of 79 rows, and the reason is
 * measurable rather than aesthetic. `DataGrid` puts `position: sticky; top: 0` on each `<th>`
 * inside a wrapper carrying `overflow-x-auto` — which makes that wrapper the sticky
 * containing block. It has no vertical overflow, so the header sticks to a box that never
 * scrolls: past roughly the fifteenth row of a 79-row grid the column meanings are simply gone,
 * and a matrix whose columns you cannot see is nine columns of unlabelled ticks. Splitting on the
 * module boundary bounds every table at 28 rows (`pos`, the largest), repeats the role names at
 * every section, and delivers the grouping the brief asks for as a structural fact rather than as
 * a styling hint. `pageSize` is set past the largest module so no section ever grows a pager.
 *
 * <h3>Density</h3>
 *
 * <p>`compact` (32 px rows, UI-SPEC §7.2). The permission column carries the CODE and not the
 * catalogue sentence: the code is the vocabulary an administrator actually uses — it is what the
 * audit log filters on, what a support request quotes, and what `permission-picker` writes — and
 * a second prose line per row would double the height of a 79-row document to buy a paraphrase of
 * the identifier beside it. The sentence is not discarded: it is the cell's `title` and its
 * screen-reader text, and the full prose catalogue is one click away in the role detail dialog.
 *
 * <h3>Colour is never the only channel (D-38-13, UI-SPEC §4.2)</h3>
 *
 * <p>Granted is a CHECK GLYPH; not-granted is an em dash. Those differ in shape, so the matrix
 * survives greyscale and survives a reader who cannot separate the accent from the tertiary
 * tier. The word ("Granted" / "Not granted") is `sr-only` here and that is not the regression
 * `activity-row.tsx` forbids: its rule binds a *tone* — a severity claimed by hue alone, with
 * nothing else on the row stating it. Here the fact is already carried visibly by two different
 * glyph shapes, and 711 visible "Granted"/"Not granted" words would destroy the one property a
 * matrix has, which is that it can be scanned.
 *
 * <h3>Keyboard</h3>
 *
 * <p>Every control is a real control — the search field, the two selects, and a module jump-nav
 * of ordinary anchors. There is deliberately NO roving-tabindex grid: 711 focusable cells would
 * be 711 tab stops carrying no action, and the cells have nothing to activate. What a keyboard
 * user needs here is to reach a module without 79 tab presses, which the jump-nav gives in one.
 */

/** How many rows the largest module can have before a section grows a pager. `pos` has 28. */
const NO_PAGER = 200;

/**
 * Left to right, most authority first.
 *
 * <p>Not the server's order and not alphabetical. The demo reads Super Admin → Kitchen and that
 * descent is the reason its 35 cells are scannable: the ticks form a staircase, and a cell that
 * breaks the staircase is the interesting one. Sorting by grant count reproduces that for the
 * real catalogue (OWNER 79 → KITCHEN_STAFF 2) and — unlike a hardcoded seniority list — keeps
 * working when a tenant adds a custom role, which is the whole point of `/app/roles`.
 *
 * <p>Ties break on name so the column order cannot flicker between renders of the same data.
 */
function byAuthorityDescending(a: AssignableRole, b: AssignableRole): number {
  if (b.permissions.length !== a.permissions.length) {
    return b.permissions.length - a.permissions.length;
  }
  return a.name.localeCompare(b.name);
}

/** One cell. `granted` is a fact from `role_permissions`; there is no third state to render. */
function GrantCell({ granted, label }: { granted: boolean; label: string }) {
  return (
    <span className="flex items-center justify-center" data-granted={granted ? "true" : "false"}>
      {granted ? (
        <Check aria-hidden="true" className="size-4 text-primary" />
      ) : (
        <span aria-hidden="true" className="text-foreground-tertiary">
          {NO_VALUE}
        </span>
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}

export interface PermissionMatrixProps {
  /** The roles the CALLER may see. Ceiling-filtered by the server; never re-filtered here. */
  roles: AssignableRole[];
  /** The permission vocabulary, grouped and ordered by the server. Nothing here re-sorts it. */
  modules: PermissionModule[];
  className?: string;
}

export function PermissionMatrix({ roles, modules, className }: PermissionMatrixProps) {
  const [search, setSearch] = React.useState("");
  const [moduleFilter, setModuleFilter] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState("");

  const orderedRoles = React.useMemo(() => [...roles].sort(byAuthorityDescending), [roles]);

  /** `Set` per role, built once: the naive `role.permissions.includes(code)` is 711 array scans. */
  const grantsByRole = React.useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const role of roles) map.set(role.code, new Set(role.permissions));
    return map;
  }, [roles]);

  const query = search.trim().toLowerCase();
  const focusedRole = roleFilter ? grantsByRole.get(roleFilter) : undefined;

  const visibleModules = React.useMemo(() => {
    return modules
      .filter((group) => !moduleFilter || group.module === moduleFilter)
      .map((group) => ({
        module: group.module,
        /** Every code in the module, filtered or not — the denominator a header count needs. */
        total: group.permissions.length,
        permissions: group.permissions.filter((permission) => {
          if (focusedRole && !focusedRole.has(permission.code)) return false;
          if (!query) return true;
          return (
            permission.code.toLowerCase().includes(query) ||
            group.module.toLowerCase().includes(query) ||
            (permission.description ?? "").toLowerCase().includes(query)
          );
        }),
      }))
      .filter((group) => group.permissions.length > 0);
  }, [modules, moduleFilter, focusedRole, query]);

  const columns = React.useMemo<ColumnDef<PermissionEntry, unknown>[]>(() => {
    const permissionColumn: ColumnDef<PermissionEntry, unknown> = {
      id: "permission",
      header: () => <span className="block w-64">Permission</span>,
      cell: ({ row }) => (
        <span className="block w-64">
          <code
            className="font-mono text-small text-foreground"
            title={row.original.description ?? undefined}
          >
            {row.original.code}
          </code>
          {row.original.description ? (
            <span className="sr-only"> — {row.original.description}</span>
          ) : null}
        </span>
      ),
    };

    const roleColumns = orderedRoles.map<ColumnDef<PermissionEntry, unknown>>((role) => ({
      id: `role-${role.code}`,
      header: ({ table }) => {
        // The count is for THIS module's table, not the whole catalogue: "MANAGER 24/28" beside
        // the pos header answers a question the global 57 cannot, and every section is a
        // different question.
        const rows = table.getCoreRowModel().rows;
        const held = grantsByRole.get(role.code);
        const granted = held ? rows.filter((r) => held.has(r.original.code)).length : 0;
        return (
          <span className="block w-20 text-center">
            <span className="block break-words whitespace-normal">{role.name}</span>
            <span className="block font-normal tabular-nums text-foreground-tertiary">
              {formatNumber(granted)}/{formatNumber(rows.length)}
            </span>
          </span>
        );
      },
      cell: ({ row }) => (
        <GrantCell
          granted={Boolean(grantsByRole.get(role.code)?.has(row.original.code))}
          label={
            grantsByRole.get(role.code)?.has(row.original.code)
              ? `${role.name}: granted`
              : `${role.name}: not granted`
          }
        />
      ),
    }));

    return [permissionColumn, ...roleColumns];
  }, [orderedRoles, grantsByRole]);

  const totalPermissions = modules.reduce((sum, group) => sum + group.permissions.length, 0);
  const shownPermissions = visibleModules.reduce((sum, group) => sum + group.permissions.length, 0);
  const isFiltered = Boolean(query || moduleFilter || roleFilter);

  const clearAll = React.useCallback(() => {
    setSearch("");
    setModuleFilter("");
    setRoleFilter("");
  }, []);

  return (
    <div
      className={cn("flex flex-col gap-(--space-lg)", className)}
      data-testid="permission-matrix"
    >
      {/*
       * No `title`: `PageHeader` has already said "Permission matrix" as this page's one `<h1>`,
       * and FilterBar's own docblock asks callers to omit it there rather than render a second
       * heading with the same words two elements below the first.
       */}
      <FilterBar
        search={{
          value: search,
          onChange: setSearch,
          label: "Search permissions",
          placeholder: "Try “void”, “payroll”, “till”",
        }}
        filters={[
          {
            id: "module",
            label: "Module",
            value: moduleFilter,
            onChange: setModuleFilter,
            allLabel: "All modules",
            testId: "matrix-filter-module",
            options: modules.map((group) => ({ value: group.module, label: group.module })),
          },
          {
            id: "granted-by",
            label: "Granted by",
            value: roleFilter,
            onChange: setRoleFilter,
            // Not "All roles": this control narrows the ROWS, never the columns. Every role stays
            // on screen while you read what one of them holds — otherwise the comparison the
            // matrix exists for disappears the moment you use its filter.
            allLabel: "Any role",
            testId: "matrix-filter-role",
            options: orderedRoles.map((role) => ({ value: role.code, label: role.name })),
          },
        ]}
        onClearAll={clearAll}
      />

      <p className="text-small text-foreground-secondary" data-testid="permission-matrix-summary">
        {formatNumber(orderedRoles.length)} {orderedRoles.length === 1 ? "role" : "roles"} against{" "}
        {formatNumber(totalPermissions)} permissions ·{" "}
        {formatNumber(orderedRoles.length * totalPermissions)} decisions
        {isFiltered ? <> · showing {formatNumber(shownPermissions)}</> : null}
        {". "}
        Every grant is all-or-nothing: this system has no partial permission, so a cell is granted
        or it is not.
      </p>

      {visibleModules.length === 0 ? (
        <p
          role="status"
          className="rounded-lg border border-dashed px-4 py-8 text-center text-body text-muted-foreground"
        >
          {roleFilter && !query && !moduleFilter
            ? `${orderedRoles.find((r) => r.code === roleFilter)?.name ?? roleFilter} holds no permissions at all.`
            : "No permission matches these filters."}{" "}
          <button
            type="button"
            onClick={clearAll}
            className="font-medium text-primary underline underline-offset-2"
          >
            Clear them
          </button>
        </p>
      ) : (
        <>
          {/*
           * The jump-nav. Rendered only when there is more than one section, because a list of
           * one link to the thing already on screen is furniture rather than navigation.
           */}
          {visibleModules.length > 1 && (
            <nav aria-label="Jump to a module" data-testid="permission-matrix-jump">
              <ul className="flex flex-wrap gap-(--space-xs)">
                {visibleModules.map((group) => (
                  <li key={group.module}>
                    <a
                      href={`#permission-matrix-${group.module}`}
                      className="inline-flex min-h-11 items-center rounded-full border border-border px-3 text-label font-semibold uppercase tracking-[0.08em] text-foreground-secondary hover:bg-surface-2"
                    >
                      {group.module}
                      <span className="ml-1.5 font-normal tabular-nums text-foreground-tertiary">
                        {formatNumber(group.permissions.length)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          {visibleModules.map((group) => (
            <section
              key={group.module}
              id={`permission-matrix-${group.module}`}
              aria-labelledby={`permission-matrix-${group.module}-heading`}
              // `scroll-mt-20` so a jump-nav landing does not put the heading underneath the
              // sticky top bar, which is where every in-page anchor in this product lands today.
              className="flex scroll-mt-20 flex-col gap-(--space-sm)"
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2
                  id={`permission-matrix-${group.module}-heading`}
                  className="text-body font-semibold uppercase tracking-[0.08em] text-foreground"
                >
                  {group.module}
                </h2>
                {/*
                 * Only when a filter is actually hiding rows. `DataGrid` already prints its own
                 * "N rows" under every section, so an unfiltered caption here would be the same
                 * number twice per module, thirteen times down the page. What the grid's line
                 * CANNOT say is the denominator — "3 of 28" is the fact that stops a reader
                 * concluding the pos module only has three permissions in it.
                 */}
                {group.permissions.length !== group.total && (
                  <p className="text-small text-foreground-tertiary">
                    {formatNumber(group.permissions.length)} of {formatNumber(group.total)} shown
                  </p>
                )}
              </div>

              <DataGrid
                columns={columns}
                data={group.permissions}
                density="compact"
                pageSize={NO_PAGER}
                label={`${group.module} permissions by role`}
                isFiltered={isFiltered}
                onClearFilters={clearAll}
                card={{
                  primary: (permission) => <code className="font-mono">{permission.code}</code>,
                  // The card branch cannot show nine columns, so it names the holders instead —
                  // the same fact, read the other way round. A matrix squeezed onto 390px is
                  // exactly the "desktop table dropped in unchanged" the grid's card mode exists
                  // to refuse.
                  secondary: (permission) => {
                    const holders = orderedRoles.filter((role) =>
                      grantsByRole.get(role.code)?.has(permission.code),
                    );
                    return holders.length === 0
                      ? "No role holds this"
                      : holders.map((role) => role.name).join(", ");
                  },
                  trailing: (permission) =>
                    `${formatNumber(
                      orderedRoles.filter((role) =>
                        grantsByRole.get(role.code)?.has(permission.code),
                      ).length,
                    )}/${formatNumber(orderedRoles.length)}`,
                }}
              />
            </section>
          ))}
        </>
      )}
    </div>
  );
}
