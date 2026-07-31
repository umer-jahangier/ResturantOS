"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  useArchiveStorageLocation,
  useRestoreStorageLocation,
  useStorageLocations,
  useUoms,
} from "@/lib/hooks/inventory/use-inventory";
import type { StorageLocation, Uom } from "@/lib/adapters/inventory.adapter";
import { StorageLocationFormDialog } from "@/components/inventory/StorageLocationFormDialog";
import { UomFormDialog } from "@/components/inventory/UomFormDialog";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
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

const cellClass = "px-3 py-2 text-sm";
const headClass = "px-3 py-2 text-left text-xs font-medium text-muted-foreground";

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
  const { data: uoms, isLoading: uomsLoading } = useUoms();
  const { data: locations, isLoading: locationsLoading } = useStorageLocations(true);
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
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold">Setup</h1>
        <p className="text-sm text-muted-foreground">
          The shared lists every ingredient draws on — how you measure stock, and where it lives.
        </p>
      </div>

      {/* ── Units of measure ─────────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Units of measure</h2>
            <p className="text-sm text-muted-foreground">
              A standard set is provided. Add a house unit for anything you buy or count your own
              way — a case, a bunch, a sheet pan.
            </p>
          </div>
          <PermissionGuard require="inventory.item.manage">
            <UomFormDialog trigger={<Button type="button">Add unit</Button>} />
          </PermissionGuard>
        </div>

        {uomsLoading ? (
          <div className="grid gap-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : (
          <div className="space-y-6">
            {MEASURE_TYPES.map((type) => {
              const rows = (uoms ?? []).filter((u) => u.measureType === type.key);
              if (rows.length === 0) return null;
              return (
                <div key={type.key} className="space-y-2">
                  <h3 className="text-sm font-medium">{type.label}</h3>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full min-w-[32rem]">
                      <thead className="border-b bg-muted/40">
                        <tr>
                          <th className={headClass}>Code</th>
                          <th className={headClass}>Name</th>
                          <th className={headClass}>Conversion</th>
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
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Storage locations ────────────────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Storage locations</h2>
            <p className="text-sm text-muted-foreground">
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

        {locationsLoading ? (
          <div className="grid gap-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : allLocations.length === 0 ? (
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
        ) : (
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
                        <span className="ml-2 rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
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
        )}
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
            <div role="alert" className="rounded-lg border bg-card px-2.5 py-2 text-sm text-destructive">
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
    </div>
  );
}
