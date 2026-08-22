"use client";

import { MoreHorizontal } from "lucide-react";

import type { Station } from "@/lib/models/pos.model";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { stationTypeLabel } from "@/components/stations/station-type-select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The station catalogue list, grouped by the screen its rows appear on.
 *
 * <p>Grouping by DISPLAY FAMILY rather than by type is deliberate: the question an admin is
 * actually answering on this screen is "which screen does this land on", and five types over
 * three screens means a type-grouped list would show three separate kitchen groups that all go
 * to the same board.
 *
 * <p>There is no delete control here or anywhere else on this screen. A station's code is the
 * routing key on every ticket ever fired to it and the key of the KDS projection row; deleting
 * one would orphan history that must keep naming where it was cooked. Retire is the only
 * removal, and it is reversible.
 */

const FAMILY_LABEL: Record<Station["displayFamily"], string> = {
  KITCHEN: "Kitchen screen",
  BAR: "Bar screen",
  EXPO: "Expo screen",
};

const FAMILY_ORDER: Station["displayFamily"][] = ["KITCHEN", "BAR", "EXPO"];

export function StationList({
  stations,
  onEdit,
  onToggleActive,
}: {
  stations: Station[];
  onEdit: (station: Station) => void;
  onToggleActive: (station: Station) => void;
}) {
  const grouped = FAMILY_ORDER.map(
    (family) => [family, stations.filter((s) => s.displayFamily === family)] as const,
  ).filter(([, rows]) => rows.length > 0);

  return (
    <div className="space-y-6">
      {grouped.map(([family, rows]) => (
        <div
          key={family}
          role="group"
          aria-label={`${FAMILY_LABEL[family]} stations`}
          className="rounded-lg border"
        >
          <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
            <span className="font-medium">{FAMILY_LABEL[family]}</span>
            <span className="text-label text-muted-foreground">
              {rows.length} {rows.length === 1 ? "station" : "stations"}
            </span>
          </div>

          <div className="divide-y">
            {rows.map((station) => (
              <div
                key={station.id}
                data-testid="station-row"
                className="flex items-center gap-3 px-3 py-2 text-small"
              >
                <code className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-label font-medium">
                  {station.code}
                </code>
                <span className="flex-1 truncate font-medium">{station.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {stationTypeLabel(station.stationType)}
                </span>
                {!station.active ? <StatusBadge status="archived" label="Retired" /> : null}
                <PermissionGuard require="pos.menu.manage">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Actions for ${station.name}`}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => onEdit(station)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => onToggleActive(station)}>
                        {station.active ? "Retire" : "Restore"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </PermissionGuard>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
