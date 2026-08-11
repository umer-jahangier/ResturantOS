"use client";

import { useMemo, useState } from "react";
import { MonitorSpeaker } from "lucide-react";
import { toast } from "sonner";

import { useStationCatalogue, useSetStationActive } from "@/lib/hooks/pos/use-station-admin";
import type { Station } from "@/lib/models/pos.model";
import { StationList } from "@/components/stations/station-list";
import { StationFormDialog } from "@/components/stations/station-form-dialog";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { Button } from "@/components/ui/button";
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

const EMPTY_TITLE = "No stations yet";
const EMPTY_BODY =
  "A station is where a ticket goes — the grill, the bar, the pass. Add one and you can route menu items to it and put staff on it.";

type FormTarget = { mode: "create" } | { mode: "edit"; station: Station };

/**
 * URL: /app/stations — the station catalogue.
 *
 * <p>`/api/v1/pos/stations` has had complete CRUD since phase 3 and, until this screen, zero
 * frontend callers: creating a station required curl. D-28-05 refuses that outright — *"Nothing
 * should be needed to seed directly via developers or support team."* A bar station that only a
 * developer can create is not a bar station a restaurant owner has.
 *
 * <p>Two rules this screen holds and must not lose:
 * <ul>
 *   <li><b>Error before empty.</b> The query error is read by `QueryBoundary`, never folded into
 *       an emptiness check. "No stations yet" shown because pos-service is down is the product
 *       lying about the one thing this screen exists to answer (GA-001).</li>
 *   <li><b>Retire, never delete.</b> A station code is the routing key on every ticket ever fired
 *       to it. There is no delete affordance anywhere on this screen and pos-service exposes no
 *       endpoint that would do one.</li>
 * </ul>
 */
export default function StationsPage() {
  const [showRetired, setShowRetired] = useState(false);
  const stationsQuery = useStationCatalogue();
  const setActive = useSetStationActive();

  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);
  // Retiring is confirmed rather than immediate: a station with no tickets looks identical to one
  // the grill is working off right now, and retiring the second one takes it off that screen.
  const [retireTarget, setRetireTarget] = useState<Station | null>(null);

  const allStations = useMemo(() => stationsQuery.data ?? [], [stationsQuery.data]);
  const visibleStations = useMemo(
    () => (showRetired ? allStations : allStations.filter((s) => s.active)),
    [allStations, showRetired],
  );

  function handleToggleActive(station: Station) {
    if (station.active) {
      setRetireTarget(station);
      return;
    }
    restore(station);
  }

  function restore(station: Station) {
    setActive.mutate(
      { id: station.id, active: true, name: station.name, stationType: station.stationType },
      {
        onSuccess: () => toast.success(`Restored ${station.name}`),
        onError: (error) =>
          toast.error(error.message || "Could not update the station. Please try again."),
      },
    );
  }

  function confirmRetire() {
    const station = retireTarget;
    if (!station) return;
    setActive.mutate(
      { id: station.id, active: false, name: station.name, stationType: station.stationType },
      {
        onSuccess: () => {
          toast.success(`Retired ${station.name}`);
          setRetireTarget(null);
        },
        onError: (error) =>
          toast.error(error.message || "Could not update the station. Please try again."),
      },
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Stations</h1>
          <p className="text-sm text-muted-foreground">
            Where tickets go. A station&apos;s type decides which screen it appears on, and staff
            can be put on specific stations from the Users screen.
          </p>
        </div>
        <PermissionGuard require="pos.menu.manage">
          <Button type="button" onClick={() => setFormTarget({ mode: "create" })}>
            Add station
          </Button>
        </PermissionGuard>
      </div>

      <label className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={showRetired}
          onChange={(e) => setShowRetired(e.target.checked)}
          className="size-4 rounded border-input"
        />
        Show retired
      </label>

      <QueryBoundary
        query={stationsQuery}
        what="your stations"
        isEmpty={visibleStations.length === 0}
        loading={
          <div className="grid gap-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        }
        empty={
          <PermissionGuard
            require="pos.menu.manage"
            fallback={
              <EmptyState icon={MonitorSpeaker} title={EMPTY_TITLE} description={EMPTY_BODY} />
            }
          >
            <EmptyState
              icon={MonitorSpeaker}
              title={EMPTY_TITLE}
              description={EMPTY_BODY}
              action={{ label: "Add station", onClick: () => setFormTarget({ mode: "create" }) }}
            />
          </PermissionGuard>
        }
      >
        <StationList
          stations={visibleStations}
          onEdit={(station) => setFormTarget({ mode: "edit", station })}
          onToggleActive={handleToggleActive}
        />
      </QueryBoundary>

      <StationFormDialog
        key={
          formTarget
            ? formTarget.mode === "edit"
              ? `edit-${formTarget.station.id}`
              : "create"
            : "station-form-idle"
        }
        station={formTarget?.mode === "edit" ? formTarget.station : undefined}
        open={formTarget !== null}
        onOpenChange={(next) => {
          if (!next) setFormTarget(null);
        }}
      />

      <Dialog
        open={retireTarget !== null}
        onOpenChange={(next) => {
          if (!next) setRetireTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Retire {retireTarget?.name}?</DialogTitle>
            <DialogDescription>
              Its screen stops receiving new tickets and it disappears from this list. Nothing is
              deleted — past tickets keep naming it, and you can restore it from &ldquo;Show
              retired&rdquo;.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRetireTarget(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={confirmRetire} disabled={setActive.isPending}>
              {setActive.isPending ? "Retiring…" : "Retire station"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
