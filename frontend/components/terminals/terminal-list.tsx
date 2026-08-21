"use client";

import { MoreHorizontal } from "lucide-react";

import type { PosTerminal } from "@/lib/models/terminal.model";
import { PermissionGuard } from "@/components/shared/permission-guard";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const SERVICE_MODEL_LABEL: Record<PosTerminal["serviceModel"], string> = {
  COUNTER: "Counter",
  TABLE_SERVICE: "Table service",
  SELF_SERVE: "Self serve",
};

/**
 * The terminal catalogue list.
 *
 * <p>Every row states what the terminal offers **in words**, so the answer is on the screen without
 * anyone opening an edit dialog. That is the whole reason this column exists: a row that showed an
 * empty list, or a count, would leave "offers everything" and "offers nothing" looking the same,
 * and they are opposites.
 *
 * <p>No delete control. Orders will reference a terminal (28-12), so a closed order must keep
 * naming the till it was rung on.
 */
export function TerminalList({
  terminals,
  categoryNameById,
  stationNameById,
  onEdit,
  onToggleActive,
}: {
  terminals: PosTerminal[];
  categoryNameById: (id: string) => string;
  stationNameById: (id: string) => string;
  onEdit: (terminal: PosTerminal) => void;
  onToggleActive: (terminal: PosTerminal) => void;
}) {
  return (
    <div className="divide-y rounded-lg border">
      {terminals.map((terminal) => (
        <div key={terminal.id} data-testid="terminal-row" className="flex items-start gap-3 px-3 py-2.5 text-small">
          <code className="mt-0.5 shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-label font-medium">
            {terminal.code}
          </code>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{terminal.name}</span>
              <span className="shrink-0 text-label text-muted-foreground">
                {SERVICE_MODEL_LABEL[terminal.serviceModel]}
              </span>
              {!terminal.active ? <StatusBadge status="archived" label="Retired" /> : null}
            </div>
            <p data-testid="terminal-menu-summary" className="text-label text-muted-foreground">
              {terminal.offersWholeMenu
                ? "Offers the whole menu"
                : `Offers ${terminal.categoryIds.map(categoryNameById).join(", ")}`}
              {" · "}
              {terminal.firesToAllStations
                ? "fires to every station"
                : `fires to ${terminal.stationIds.map(stationNameById).join(", ")}`}
            </p>
          </div>
          <PermissionGuard require="pos.terminals.admin">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${terminal.name}`}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onEdit(terminal)}>Edit</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onToggleActive(terminal)}>
                  {terminal.active ? "Retire" : "Restore"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </PermissionGuard>
        </div>
      ))}
    </div>
  );
}
