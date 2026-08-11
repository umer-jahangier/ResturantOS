"use client";

import { useMemo, useState } from "react";
import { MonitorSmartphone } from "lucide-react";
import { toast } from "sonner";

import {
  useTerminalCatalogue,
  useSetTerminalActive,
} from "@/lib/hooks/pos/use-terminal-admin";
import { useMenuCategories } from "@/lib/hooks/pos/use-menu";
import { useStations } from "@/lib/hooks/pos/use-station-admin";
import type { PosTerminal } from "@/lib/models/terminal.model";
import { TerminalList } from "@/components/terminals/terminal-list";
import { TerminalFormDialog } from "@/components/terminals/terminal-form-dialog";
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

const EMPTY_TITLE = "No POS terminals yet";
const EMPTY_BODY =
  "A terminal is a named till — the bar, the counter, the takeaway window. Give it a menu and the stations it fires to, and a browser opened on that till can be bound to it.";

type FormTarget = { mode: "create" } | { mode: "edit"; terminal: PosTerminal };

/**
 * URL: /app/terminals — the POS terminal catalogue. The route plan 28-06 registered in the
 * navigation, now built.
 *
 * <p>This is the half of the user's request that is about hardware-that-isn't:
 * *"they should be able to add specific screen (or station) or dedicated POS which should be
 * selecting respective menu."* RestaurantOS runs in a datacentre and staff reach it from browsers,
 * so a "dedicated POS" is a browser session bound to one of these profiles — which is why the
 * profile is a row an owner creates here rather than a config file someone installs.
 *
 * <p>Same two rules as the Stations screen: error is checked before empty, and there is no delete.
 */
export default function TerminalsPage() {
  const [showRetired, setShowRetired] = useState(false);
  const terminalsQuery = useTerminalCatalogue();
  const categories = useMenuCategories();
  const stations = useStations();
  const setActive = useSetTerminalActive();

  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);
  const [retireTarget, setRetireTarget] = useState<PosTerminal | null>(null);

  const all = useMemo(() => terminalsQuery.data ?? [], [terminalsQuery.data]);
  const visible = useMemo(
    () => (showRetired ? all : all.filter((t) => t.active)),
    [all, showRetired],
  );

  // Names, not ids. A row reading "Offers c1000001-…" answers nothing an operator asked.
  const categoryNameById = (id: string) =>
    categories.data?.find((c) => c.id === id)?.name ?? "a category";
  const stationNameById = (id: string) =>
    stations.data?.find((s) => s.id === id)?.name ?? "a station";

  function handleToggleActive(terminal: PosTerminal) {
    if (terminal.active) {
      setRetireTarget(terminal);
      return;
    }
    setActive.mutate(
      { id: terminal.id, active: true },
      {
        onSuccess: () => toast.success(`Restored ${terminal.name}`),
        onError: (e) => toast.error(e.message || "Could not update the terminal."),
      },
    );
  }

  function confirmRetire() {
    const terminal = retireTarget;
    if (!terminal) return;
    setActive.mutate(
      { id: terminal.id, active: false },
      {
        onSuccess: () => {
          toast.success(`Retired ${terminal.name}`);
          setRetireTarget(null);
        },
        onError: (e) => toast.error(e.message || "Could not update the terminal."),
      },
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">POS Terminals</h1>
          <p className="text-sm text-muted-foreground">
            Named tills. Each one decides which part of the menu it offers and which stations its
            orders fire to.
          </p>
        </div>
        <PermissionGuard require="pos.terminals.admin">
          <Button type="button" onClick={() => setFormTarget({ mode: "create" })}>
            Add terminal
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
        query={terminalsQuery}
        what="your POS terminals"
        moduleLabel="POS Terminals"
        isEmpty={visible.length === 0}
        loading={
          <div className="grid gap-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        }
        empty={
          <PermissionGuard
            require="pos.terminals.admin"
            fallback={
              <EmptyState icon={MonitorSmartphone} title={EMPTY_TITLE} description={EMPTY_BODY} />
            }
          >
            <EmptyState
              icon={MonitorSmartphone}
              title={EMPTY_TITLE}
              description={EMPTY_BODY}
              action={{ label: "Add terminal", onClick: () => setFormTarget({ mode: "create" }) }}
            />
          </PermissionGuard>
        }
      >
        <TerminalList
          terminals={visible}
          categoryNameById={categoryNameById}
          stationNameById={stationNameById}
          onEdit={(terminal) => setFormTarget({ mode: "edit", terminal })}
          onToggleActive={handleToggleActive}
        />
      </QueryBoundary>

      <TerminalFormDialog
        key={
          formTarget
            ? formTarget.mode === "edit"
              ? `edit-${formTarget.terminal.id}`
              : "create"
            : "terminal-form-idle"
        }
        terminal={formTarget?.mode === "edit" ? formTarget.terminal : undefined}
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
              A browser still bound to this terminal will need to pick another one. Nothing is
              deleted — past orders keep naming it, and you can restore it from &ldquo;Show
              retired&rdquo;.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRetireTarget(null)}>
              Cancel
            </Button>
            <Button type="button" onClick={confirmRetire} disabled={setActive.isPending}>
              {setActive.isPending ? "Retiring…" : "Retire terminal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
