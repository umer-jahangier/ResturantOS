"use client";

import * as React from "react";
import { toast } from "sonner";

import { HrErrorNotice } from "@/components/hr/hr-error-notice";
import { LookupFormDialog } from "@/components/hr/lookup-form-dialog";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Button } from "@/components/ui/button";
import { DataGrid, type ColumnDef } from "@/components/ui/data-grid/data-grid";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  useDepartments,
  useDesignations,
  useSetDepartmentActive,
  useSetDesignationActive,
} from "@/lib/hooks/hr/use-hr-config";
import type { Department, Designation } from "@/lib/models/hr.model";

/**
 * The list screen for a tenant-managed lookup — departments or job titles.
 *
 * <h2>Why the empty state is the most important state on this screen</h2>
 *
 * 35-02 seeds nothing, deliberately: the user ruled out anything that needs a developer to set up.
 * So EVERY tenant sees this screen empty on their first day, and a blank table would read as a
 * screen that failed. It says what the list is for and what to do, and the "Add" button is the only
 * thing on it — because at that moment it is the only correct action.
 *
 * <h2>Retire, not delete</h2>
 *
 * There is no delete, here or in the API, and please do not add one for symmetry. A department
 * referenced by an employee cannot be removed without orphaning them or silently rewriting their
 * record. Retiring keeps the row resolvable — an employee hired into it still renders with a real
 * name — while removing it from every picker. It can be brought back.
 */
export function LookupListScreen({ kind }: { kind: "department" | "designation" }) {
  const isDesignation = kind === "designation";

  const departments = useDepartments();
  const designations = useDesignations();
  const query = isDesignation ? designations : departments;

  const setDepartmentActive = useSetDepartmentActive();
  const setDesignationActive = useSetDesignationActive();

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Department | Designation | undefined>();
  const [showRetired, setShowRetired] = React.useState(false);

  const noun = isDesignation ? "job title" : "department";
  const plural = isDesignation ? "Job titles" : "Departments";

  const departmentNameById = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const d of departments.data ?? []) map.set(d.id, d.name);
    return map;
  }, [departments.data]);

  const rows = (query.data ?? []).filter((r) => showRetired || r.active);

  const columns = React.useMemo<ColumnDef<Department | Designation, unknown>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        id: "code",
        accessorKey: "code",
        header: "Code",
        cell: ({ row }) => (
          <span className="font-mono tabular-nums">{row.original.code ?? "—"}</span>
        ),
      },
      ...(isDesignation
        ? [
            {
              id: "department",
              header: "Department",
              enableSorting: false,
              cell: ({ row }) => parentDepartmentName(row.original, departmentNameById),
            } satisfies ColumnDef<Department | Designation, unknown>,
          ]
        : []),
      {
        id: "status",
        accessorKey: "active",
        header: "Status",
        // "In use" / "Retired" were bare strings in a cell — the only difference between a live
        // lookup and a retired one was two words in body type. The badge keeps the words and adds
        // the shape and the token hue.
        cell: ({ row }) => (
          <StatusBadge
            status={row.original.active ? "active" : "archived"}
            label={row.original.active ? "In use" : "Retired"}
          />
        ),
      },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <PermissionGuard require="hr.config.manage" fallback={null}>
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(row.original);
                  setDialogOpen(true);
                }}
              >
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActive(row.original, !row.original.active)}
              >
                {row.original.active ? "Retire" : "Restore"}
              </Button>
            </div>
          </PermissionGuard>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isDesignation, departmentNameById],
  );

  function setActive(row: Department | Designation, active: boolean) {
    const options = {
      onSuccess: () => toast.success(active ? `${row.name} restored` : `${row.name} retired`),
      onError: () => toast.error(`Could not update ${row.name}`),
    };
    if (isDesignation) setDesignationActive.mutate({ id: row.id, active }, options);
    else setDepartmentActive.mutate({ id: row.id, active }, options);
  }

  return (
    <PageBody className="space-y-(--space-lg)">
      <PageHeader
        title={plural}
        description={
          isDesignation
            ? "The job titles staff are hired into. Chosen from a list on the employee form, never typed."
            : "The parts of the business staff belong to. Chosen from a list on the employee form, never typed."
        }
        actions={
          <PermissionGuard require="hr.config.manage" fallback={null}>
            <Button
              onClick={() => {
                setEditing(undefined);
                setDialogOpen(true);
              }}
            >
              New {noun}
            </Button>
          </PermissionGuard>
        }
      />

      {query.isError ? (
        <HrErrorNotice
          what={`the ${noun} list`}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : query.isPending ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-11" />
          ))}
        </div>
      ) : (query.data ?? []).length === 0 ? (
        // The first thing every tenant sees. An instruction, not a blank.
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">No {noun}s yet</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-prose text-small">
            {isDesignation
              ? "Nothing is set up for you, on purpose — every restaurant names its roles differently. Add the titles you hire into (Chef, Waiter, Cashier) and they become the list on the employee form."
              : "Nothing is set up for you, on purpose — every restaurant is organised differently. Add the parts of your business (Kitchen, Front of House, Delivery) and they become the list on the employee form."}
          </p>
        </div>
      ) : (
        <>
          <label className="flex items-center gap-2 text-small">
            <input
              type="checkbox"
              checked={showRetired}
              onChange={(e) => setShowRetired(e.target.checked)}
              className="size-4 rounded-sm border-border-interactive"
            />
            Show retired
          </label>
          <DataGrid
            label={plural}
            columns={columns}
            data={rows}
            isFiltered={!showRetired}
            onClearFilters={() => setShowRetired(true)}
            emptyTitle={`Every ${noun} is retired`}
            emptyDescription={`Tick "Show retired" to bring one back.`}
            card={{
              primary: (r) => r.name,
              secondary: (r) => r.code ?? "—",
              trailing: (r) => (
                <StatusBadge
                  status={r.active ? "active" : "archived"}
                  label={r.active ? "In use" : "Retired"}
                />
              ),
            }}
          />
        </>
      )}

      <PermissionGuard require="hr.config.manage" fallback={null}>
        <LookupFormDialog
          kind={kind}
          row={editing}
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setEditing(undefined);
          }}
        />
      </PermissionGuard>
    </PageBody>
  );
}

/**
 * A designation's parent department name, or an em dash.
 *
 * <p>Extracted rather than inlined because `"departmentId" in row` narrows a
 * `Department | Designation` union to something TypeScript will not hand to `Map.get(string)` — the
 * `in` operator widens the property to `unknown` on the branch it creates. An explicit signature is
 * clearer than a cast at the call site, and it puts the null handling in one place.
 */
function parentDepartmentName(
  row: Department | Designation,
  namesById: Map<string, string>,
): string {
  const departmentId = (row as Designation).departmentId;
  if (!departmentId) return "—";
  return namesById.get(departmentId) ?? "—";
}
