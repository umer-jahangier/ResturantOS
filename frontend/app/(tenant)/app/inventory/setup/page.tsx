"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  useArchiveStorageLocation,
  useRestoreStorageLocation,
  useStorageLocations,
  useArchiveUom,
  useRestoreUom,
  useUoms,
} from "@/lib/hooks/inventory/use-inventory";
import type { StorageLocation, Uom } from "@/lib/adapters/inventory.adapter";
import { StorageLocationFormDialog } from "@/components/inventory/StorageLocationFormDialog";
import { UomFormDialog } from "@/components/inventory/UomFormDialog";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Button } from "@/components/ui/button";
import { PageBody } from "@/components/ui/page-body";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { QueryBoundary } from "@/components/ui/query-boundary";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const MEASURE_TYPES = [
  { key: "WEIGHT", label: "Weight" },
  { key: "VOLUME", label: "Volume" },
  { key: "COUNT", label: "Count" },
] as const;

const cellClass = "px-3 py-2 text-small";
const headClass = "px-3 py-2 text-left text-label uppercase tracking-[0.04em] text-muted-foreground";

/** How a unit converts, in words. A base unit has nothing above it — saying "1 G = 1 G" would be
 * noise, so it reads as the anchor it is. */
function conversionSummary(uom: Uom): string {
  if (!uom.baseUnitCode) {
    return "Base unit";
  }
  return `1 ${uom.code} = ${uom.toBaseFactor} ${uom.baseUnitCode}`;
}

// URL: /app/inventory/setup — the two pieces of inventory master data that had no screen at all:
// units of measure (the POST endpoint existed since 08.2-01 with no caller) and storage locations
// (free text on the ingredient form until V10).
export default function InventorySetupPage() {
  // GA-001: neither query's error was read. The units section then rendered as a silently empty
  // page body (every measure-type group returns null when its rows are empty) and the locations
  // section as "No storage locations yet" — two different disguises for the same 500.
  // includeRetired: the setup screen is the ONE place a retired unit must still be visible —
  // shown as retired, so it does not simply vanish with no explanation of where it went.
  const uomsQuery = useUoms(true);
  const locationsQuery = useStorageLocations(true);
  const uoms = uomsQuery.data;
  const locations = locationsQuery.data;
  const archiveLocation = useArchiveStorageLocation();
  const restoreLocation = useRestoreStorageLocation();

  const [editing, setEditing] = useState<StorageLocation | null>(null);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<StorageLocation | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  function handleConfirmArchive() {
    if (!archiving) return;
    setArchiveError(null);
    archiveLocation.mutate(archiving.id, {
      onSuccess: () => {
        toast.success(`Archived ${archiving.name}`);
        setArchiving(null);
      },
      onError: (error) => {
        // Stays open on a 409 STORAGE_LOCATION_IN_USE — the server's message names how many items
        // are in the way, which is exactly what the user needs and would miss in a toast.
        setArchiveError(error.message || "Could not archive this location. Please try again.");
      },
    });
  }

  function handleRestore(location: StorageLocation) {
    restoreLocation.mutate(location.id, {
      onSuccess: () => toast.success(`Restored ${location.name}`),
      onError: (error) => {
        toast.error(error.message || "Could not restore the location. Please try again.");
      },
    });
  }

  const allLocations = locations ?? [];

  return (
    <PageBody className="space-y-(--space-2xl)">
      <PageHeader
        title="Setup"
        description="The shared lists every ingredient draws on — how you measure stock, and where it lives."
      />

      {/* ── Units of measure ─────────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-h2 font-semibold">Units of measure</h2>
            <p className="text-body text-muted-foreground">
              A standard set is provided. Add a house unit for anything you buy or count your own
              way — a case, a bunch, a sheet pan.
            </p>
          </div>
          <PermissionGuard require="inventory.item.manage">
            <UomFormDialog trigger={<Button type="button">Add unit</Button>} />
          </PermissionGuard>
        </div>

        <QueryBoundary
          query={uomsQuery}
          what="units of measure"
          loading={
            <div className="grid gap-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          }
        >
          <div className="space-y-6">
            {MEASURE_TYPES.map((type) => {
              const rows = (uoms ?? []).filter((u) => u.measureType === type.key);
              if (rows.length === 0) return null;
              return (
                <div key={type.key} className="space-y-2">
                  <h3 className="text-h2 font-semibold">{type.label}</h3>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[32rem]">
                      <thead className="border-b bg-muted/40">
                        <tr>
                          <th className={headClass}>Code</th>
                          <th className={headClass}>Name</th>
                          <th className={headClass}>Conversion</th>
                          <th className={headClass}>Status</th>
                          <th className={headClass}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((u) => (
                          <tr key={u.id} className="border-b last:border-b-0">
                            <td className={`${cellClass} font-medium`}>{u.code}</td>
                            <td className={cellClass}>{u.name}</td>
                            <td className={`${cellClass} text-muted-foreground`}>
                              {conversionSummary(u)}
                            </td>
                            <td className={`${cellClass} text-muted-foreground`}>
                              {u.archivedAt ? "Retired" : "In use"}
                            </td>
                            <td className={cellClass}>
                              <PermissionGuard require="inventory.item.manage">
                                <UomRowActions uom={u} />
                              </PermissionGuard>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        </QueryBoundary>
      </section>

      {/* ── Storage locations ────────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-h2 font-semibold">Storage locations</h2>
            <p className="text-body text-muted-foreground">
              Where stock physically lives. Managing the list here is what lets a count sheet be
              ordered by shelf instead of by three spellings of the same walk-in.
            </p>
          </div>
          <PermissionGuard require="inventory.item.manage">
            <Button type="button" onClick={() => setCreating(true)}>
              Add location
            </Button>
          </PermissionGuard>
        </div>

        <QueryBoundary
          query={locationsQuery}
          what="storage locations"
          isEmpty={allLocations.length === 0}
          loading={
            <div className="grid gap-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          }
          empty={
            <PermissionGuard
              require="inventory.item.manage"
              fallback={
                <EmptyState
                  title="No storage locations yet"
                  description="Storage locations let you group stock by where it physically sits."
                />
              }
            >
              <EmptyState
                title="No storage locations yet"
                description="Storage locations let you group stock by where it physically sits."
                action={{ label: "Add location", onClick: () => setCreating(true) }}
              />
            </PermissionGuard>
          }
        >
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[40rem]">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className={headClass}>Name</th>
                  <th className={headClass}>Description</th>
                  <th className={headClass}>Items</th>
                  <th className={headClass}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {allLocations.map((location) => (
                  <tr
                    key={location.id}
                    className={`border-b last:border-b-0 ${location.archivedAt ? "opacity-60" : ""}`}
                  >
                    <td className={`${cellClass} font-medium`}>
                      {location.name}
                      {location.archivedAt ? (
                        <span className="ml-2 rounded-full border px-2 py-0.5 text-label text-muted-foreground">
                          Archived
                        </span>
                      ) : null}
                    </td>
                    <td className={`${cellClass} text-muted-foreground`}>
                      {location.description ?? "—"}
                    </td>
                    <td className={cellClass}>{location.ingredientCount}</td>
                    <td className={`${cellClass} text-right`}>
                      <PermissionGuard require="inventory.item.manage">
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditing(location)}
                          >
                            Edit
                          </Button>
                          {location.archivedAt ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRestore(location)}
                            >
                              Restore
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setArchiveError(null);
                                setArchiving(location);
                              }}
                            >
                              Archive
                            </Button>
                          )}
                        </div>
                      </PermissionGuard>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </QueryBoundary>
      </section>

      <StorageLocationFormDialog
        key={editing ? `edit-${editing.id}` : creating ? "create" : "idle"}
        location={editing ?? undefined}
        open={editing !== null || creating}
        onOpenChange={(next) => {
          if (!next) {
            setEditing(null);
            setCreating(false);
          }
        }}
      />

      {/* Archive confirmation — mirrors the categories page: stays open and renders the server's
          refusal inline (role="alert") rather than a toast the user could miss. */}
      <Dialog
        open={archiving !== null}
        onOpenChange={(next) => {
          if (!next) {
            setArchiving(null);
            setArchiveError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Archive storage location</DialogTitle>
            <DialogDescription>
              {archiving
                ? `Archive "${archiving.name}"? It stops being offered on the ingredient form, and nothing already filed there is moved.`
                : null}
            </DialogDescription>
          </DialogHeader>

          {archiveError ? (
            <div
              role="alert"
              className="rounded-lg border bg-card px-2.5 py-2 text-small text-destructive"
            >
              {archiveError}
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setArchiving(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmArchive}
              disabled={archiveLocation.isPending}
            >
              {archiveLocation.isPending ? "Archiving…" : "Archive location"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}

/**
 * Edit, retire and restore for one unit.
 *
 * <p>A refused retire is a CORRECT refusal — the server counts every ingredient, conversion row
 * and vendor-catalog row that still names the unit and says so. That message is rendered verbatim
 * and left on screen, because a bare "could not retire" toast turns a working guard into an
 * apparently broken button and the person has no idea what to change.
 */
function UomRowActions({ uom }: { uom: Uom }) {
  const archive = useArchiveUom();
  const restore = useRestoreUom();
  const [refusal, setRefusal] = useState<string | null>(null);

  if (uom.archivedAt) {
    return (
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={restore.isPending}
          onClick={() =>
            restore.mutate(uom.id, {
              onSuccess: () => toast.success(`${uom.code} is back in use.`),
              onError: (e) => toast.error(e.message || "Could not restore the unit."),
            })
          }
        >
          {restore.isPending ? "Restoring…" : "Restore"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <UomFormDialog
          editing={uom}
          trigger={
            <Button type="button" variant="ghost" size="sm">
              Edit
            </Button>
          }
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={archive.isPending}
          onClick={() => {
            setRefusal(null);
            archive.mutate(uom.id, {
              onSuccess: () =>
                toast.success(`${uom.code} retired. Historical records that use it still convert.`),
              onError: (e) =>
                setRefusal(e.message || "Could not retire the unit. Please try again."),
            });
          }}
        >
          {archive.isPending ? "Retiring…" : "Retire"}
        </Button>
      </div>
      {refusal && (
        <p role="alert" data-testid={`uom-retire-refusal-${uom.code}`} className="max-w-sm text-right text-small text-destructive">
          {refusal}
        </p>
      )}
    </div>
  );
}
