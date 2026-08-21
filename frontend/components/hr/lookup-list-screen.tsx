"use client";

import * as React from "react";
import { toast } from "sonner";

import { HrErrorNotice } from "@/components/hr/hr-error-notice";
import { LookupFormDialog } from "@/components/hr/lookup-form-dialog";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Button } from "@/components/ui/button";
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

  function setActive(row: Department | Designation, active: boolean) {
    const options = {
      onSuccess: () => toast.success(active ? `${row.name} restored` : `${row.name} retired`),
      onError: () => toast.error(`Could not update ${row.name}`),
    };
    if (isDesignation) setDesignationActive.mutate({ id: row.id, active }, options);
    else setDepartmentActive.mutate({ id: row.id, active }, options);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">{plural}</h1>
          <p className="text-muted-foreground text-sm">
            {isDesignation
              ? "The job titles staff are hired into. Chosen from a list on the employee form, never typed."
              : "The parts of the business staff belong to. Chosen from a list on the employee form, never typed."}
          </p>
        </div>
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
      </div>

      {query.isError ? (
        <HrErrorNotice
          what={`the ${noun} list`}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : query.isPending ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : (query.data ?? []).length === 0 ? (
        // The first thing every tenant sees. An instruction, not a blank.
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="font-medium">No {noun}s yet</p>
          <p className="text-muted-foreground mx-auto mt-1 max-w-prose text-sm">
            {isDesignation
              ? "Nothing is set up for you, on purpose — every restaurant names its roles differently. Add the titles you hire into (Chef, Waiter, Cashier) and they become the list on the employee form."
              : "Nothing is set up for you, on purpose — every restaurant is organised differently. Add the parts of your business (Kitchen, Front of House, Delivery) and they become the list on the employee form."}
          </p>
        </div>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showRetired}
              onChange={(e) => setShowRetired(e.target.checked)}
            />
            Show retired
          </label>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b text-left">
                <th className="py-2">Name</th>
                <th>Code</th>
                {isDesignation && <th>Department</th>}
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b">
                  <td className="py-2">{row.name}</td>
                  <td>{row.code ?? "—"}</td>
                  {isDesignation && <td>{parentDepartmentName(row, departmentNameById)}</td>}
                  <td>{row.active ? "In use" : "Retired"}</td>
                  <td className="space-x-1 text-right">
                    <PermissionGuard require="hr.config.manage" fallback={null}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(row);
                          setDialogOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setActive(row, !row.active)}>
                        {row.active ? "Retire" : "Restore"}
                      </Button>
                    </PermissionGuard>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={isDesignation ? 5 : 4}
                    className="text-muted-foreground py-4 text-center"
                  >
                    Every {noun} is retired. Tick “Show retired” to bring one back.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
    </div>
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
