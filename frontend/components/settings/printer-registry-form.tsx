"use client";

import { useEffect, useMemo, useState } from "react";
import { Printer, Save, TestTube2, Trash2, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import {
  useReceiptConfig,
  useSaveReceiptConfig,
} from "@/lib/hooks/settings/use-receipt-config";
import {
  EMPTY_RECEIPT_CONFIG,
  type PrinterEntry,
  type ReceiptConfig,
} from "@/lib/models/receipt-config.model";
import { useStations } from "@/lib/hooks/pos/use-station-admin";
import { probeAgent, requestTestPrint, type AgentHealth } from "@/lib/print/agent-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QueryBoundary } from "@/components/ui/query-boundary";
import { Select } from "@/components/ui/select";
import { formatUserFacingError } from "@/lib/errors";

const DEFAULT_AGENT_BASE_URL = "http://127.0.0.1:7654";

/**
 * A brand-new printer row.
 *
 * <p>`columnsMeasured` starts FALSE and there is no control that sets it to true without a human
 * having counted characters on paper. Research §7.5 could not establish a canonical column count
 * for any model — it is a function of model, print width, font and codepage together, and the one
 * vendor datasheet consulted was provably wrong about its own character dimensions. A stored number
 * nobody measured is a different thing from one somebody did, and this screen has to be able to say
 * which.
 */
function newPrinter(role: "RECEIPT" | "KITCHEN"): PrinterEntry {
  return {
    id: `${role.toLowerCase()}-${Math.random().toString(36).slice(2, 8)}`,
    terminalId: null,
    role,
    stationCode: role === "KITCHEN" ? "DEFAULT" : null,
    transport: "TCP",
    host: "127.0.0.1",
    port: 9100,
    systemPrinterName: null,
    widthMm: 80,
    columns: 42,
    columnsMeasured: false,
    codepage: "CP437",
    cut: "PARTIAL",
    drawerPin: null,
    drawerPulseMs: null,
  };
}

const ROLE_OPTIONS = [
  { value: "RECEIPT", label: "Receipt — the customer's bill" },
  { value: "KITCHEN", label: "Kitchen — station tickets" },
];
const TRANSPORT_OPTIONS = [
  { value: "TCP", label: "Network (raw TCP, usually port 9100)" },
  { value: "SYSTEM", label: "USB / operating-system print queue" },
];
const CUT_OPTIONS = [
  { value: "PARTIAL", label: "Partial cut" },
  { value: "FULL", label: "Full cut" },
  { value: "NONE", label: "No cutter" },
];

/**
 * The branch printer registry, given a screen.
 *
 * <h2>What was already there, and what was missing</h2>
 *
 * <p>Everything except this. `receipt-config.schema.ts`, `.adapter.ts`, `.repository.ts`,
 * `.model.ts` and `use-receipt-config.ts` all shipped in phase 26 with a full `PrinterEntry` — role,
 * transport, host, port, width, columns, codepage, cut, drawer pin — and, at the moment this
 * component was written, exactly zero production consumers. `receipt-config.model.ts:81` refers in
 * so many words to "a settings screen that renders this". This is that screen.
 *
 * <h2>Two rules this screen must not break</h2>
 *
 * <p><b>A failed read is never an empty printer list.</b> `QueryBoundary` renders the error. A
 * manager who sees an empty list concludes nothing is configured and enters a second registry over
 * the top of a first one that was fine — and then two configurations disagree and the kitchen
 * prints to whichever won.
 *
 * <p><b>A saved configuration is not presented as complete when stations are unrouted.</b> The save
 * response names them; this screen shows them. A configuration that looks finished and prints
 * nothing is the exact shape of defect this codebase keeps shipping.
 */
export function PrinterRegistryForm({ branchId }: { branchId: string | null }) {
  const query = useReceiptConfig(branchId);
  const save = useSaveReceiptConfig(branchId);
  /**
   * The branch's real stations, offered as suggestions on the station field.
   *
   * <p>Not decoration. A ticket's station code is whatever the menu item's route resolves to, and
   * a manager who has never seen that list guesses — measured live during this repair, a fired
   * order produced `UNROUTABLE: no kitchen printer configured for station PANTRY1` while the
   * branch had printers bound to DEFAULT and UNASSIGNED. The kitchen got nothing and the only
   * record was a FAILED row nobody was looking at. Showing the codes is how a manager binds all
   * of them on the day they set the branch up.
   *
   * <p>A failure here degrades to the two built-in suggestions and never blocks the form: the
   * field is free text, so a station this list does not know is still bindable.
   */
  const stations = useStations();

  /**
   * Local edits, or null when the operator has not touched the form.
   *
   * <p>DERIVED, not copied in an effect. Seeding form state from a query inside `useEffect` is the
   * pattern that produces "I saved and it came back with my old values": the effect fires on the
   * first response, and a later refetch — after a save, after a window focus — either overwrites
   * the operator's typing or is ignored, and which one it is depends on render ordering. Here the
   * server's value is what renders until somebody types, and `null` after a save means the next
   * render shows what the SERVER actually stored rather than what this component hoped it did.
   *
   * <p>`EMPTY_RECEIPT_CONFIG` appears only as the base for a first edit on a branch that genuinely
   * has nothing configured. It is never a fallback for a failed read — `QueryBoundary` owns that,
   * and the model's own doc comment forbids it.
   */
  const [edits, setEdits] = useState<ReceiptConfig | null>(null);
  const [agentHealth, setAgentHealth] = useState<AgentHealth | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const draft: ReceiptConfig | null = edits ?? query.data?.config ?? null;

  const agentBaseUrl = draft?.agent?.baseUrl?.trim() || DEFAULT_AGENT_BASE_URL;

  useEffect(() => {
    let cancelled = false;
    void probeAgent(agentBaseUrl).then((h) => {
      if (!cancelled) setAgentHealth(h);
    });
    return () => {
      cancelled = true;
    };
  }, [agentBaseUrl]);

  const unrouted = query.data?.completeness.unroutedStations ?? [];
  const printers = useMemo(() => draft?.printers ?? [], [draft]);

  /** Every edit starts from what is on screen right now — local if edited, server otherwise. */
  function base(current: ReceiptConfig | null): ReceiptConfig {
    return current ?? query.data?.config ?? EMPTY_RECEIPT_CONFIG;
  }

  function patch(index: number, changes: Partial<PrinterEntry>) {
    setEdits((current) => {
      const from = base(current);
      const next = from.printers.map((p, i) => (i === index ? { ...p, ...changes } : p));
      return { ...from, printers: next };
    });
  }

  function addPrinter(role: "RECEIPT" | "KITCHEN") {
    setEdits((current) => {
      const from = base(current);
      const entry = newPrinter(role);
      const stations =
        role === "KITCHEN" && entry.stationCode && !from.kitchenStations.includes(entry.stationCode)
          ? [...from.kitchenStations, entry.stationCode]
          : from.kitchenStations;
      return {
        ...from,
        agent: from.agent ?? { baseUrl: DEFAULT_AGENT_BASE_URL, lanUrl: null },
        printers: [...from.printers, entry],
        kitchenStations: stations,
      };
    });
  }

  function removePrinter(index: number) {
    setEdits((current) => {
      const from = base(current);
      return { ...from, printers: from.printers.filter((_, i) => i !== index) };
    });
  }

  async function handleSave() {
    if (draft === null) return;
    // Kitchen stations are DECLARED here as well as routed, so the server's completeness report can
    // name a station that has no printer. A station list derived from the printers could never
    // report an unrouted one — it would be true by construction and therefore worthless.
    const declared = new Set(draft.kitchenStations);
    for (const p of draft.printers) {
      if (p.role === "KITCHEN" && p.stationCode) declared.add(p.stationCode);
    }
    const payload: ReceiptConfig = {
      ...draft,
      agent: { baseUrl: agentBaseUrl, lanUrl: draft.agent?.lanUrl ?? null },
      kitchenStations: [...declared],
      printers: draft.printers.map((p) => ({
        ...p,
        // The server rejects a station code on a RECEIPT printer and a drawer pin on a KITCHEN one.
        // Normalised here so a role change in the form cannot produce a 400 the user did not cause.
        stationCode: p.role === "KITCHEN" ? (p.stationCode ?? "DEFAULT") : null,
        drawerPin: p.role === "KITCHEN" ? null : p.drawerPin,
        drawerPulseMs: p.role === "KITCHEN" ? null : p.drawerPulseMs,
        host: p.transport === "TCP" ? (p.host ?? "127.0.0.1") : null,
        port: p.transport === "TCP" ? (p.port ?? 9100) : null,
        systemPrinterName: p.transport === "SYSTEM" ? p.systemPrinterName : null,
      })),
    };
    try {
      const stored = await save.mutateAsync(payload);
      // Drop the local edits so the next render shows what the SERVER stored — including any
      // normalisation it applied — rather than what this form believed it sent.
      setEdits(null);
      if (stored.completeness.unroutedStations.length > 0) {
        toast.warning(
          `Saved. ${stored.completeness.unroutedStations.join(", ")} has no printer — tickets for it will not print.`,
        );
      } else {
        toast.success("Printers saved. The agent picks this up on its next poll.");
      }
    } catch (error) {
      toast.error(`Could not save the printers — ${formatUserFacingError(error)}`);
    }
  }

  async function handleTestPrint(printerId: string) {
    setTesting(printerId);
    try {
      const result = await requestTestPrint(agentBaseUrl, printerId);
      if (result.outcome === "DELIVERED") toast.success(result.detail);
      else if (result.outcome === "QUEUED") toast.warning(result.detail);
      else toast.error(result.detail);
    } finally {
      setTesting(null);
    }
  }

  return (
    <Card depth={2}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Printer className="size-4" aria-hidden="true" />
          Printers
        </CardTitle>
        <CardDescription>
          Which printers this branch has, and what each one is for. The receipt printer prints the
          customer&rsquo;s bill when an order is settled; a kitchen printer prints the ticket for its
          station when the order is fired. Both happen on the server, so they do not depend on any
          browser tab being open.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="agent-base-url">Print agent address on this machine</Label>
            <Input
              id="agent-base-url"
              value={draft?.agent?.baseUrl ?? DEFAULT_AGENT_BASE_URL}
              onChange={(e) =>
                setEdits((c) => {
                  const from = base(c);
                  return {
                    ...from,
                    agent: { baseUrl: e.target.value, lanUrl: from.agent?.lanUrl ?? null },
                  };
                })
              }
              placeholder={DEFAULT_AGENT_BASE_URL}
            />
            <p className="text-xs text-muted-foreground">
              Used only by the Test print button on this screen. Real bills and kitchen tickets never
              go through the browser.
            </p>
          </div>
          <div className="space-y-1">
            <Label>Agent on this computer</Label>
            <div
              className="rounded-lg border p-3 text-xs"
              data-testid="agent-reachability"
              data-reachability={agentHealth?.reachability ?? "PROBING"}
            >
              <p className="font-medium">
                {agentHealth === null
                  ? "Checking…"
                  : agentHealth.reachability === "REACHABLE"
                    ? `Running${agentHealth.version ? ` (v${agentHealth.version})` : ""}`
                    : "Not reachable from this browser"}
              </p>
              <p className="mt-0.5 text-muted-foreground">{agentHealth?.detail ?? ""}</p>
            </div>
          </div>
        </div>

        {unrouted.length > 0 && (
          <div
            role="alert"
            data-testid="unrouted-stations"
            className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
          >
            <TriangleAlert className="mt-0.5 size-4 text-amber-500" aria-hidden="true" />
            <span>
              <strong>{unrouted.join(", ")}</strong> {unrouted.length === 1 ? "has" : "have"} no
              printer. Tickets for {unrouted.length === 1 ? "that station" : "those stations"} will
              be recorded as unprintable and no paper will appear in the kitchen.
            </span>
          </div>
        )}

        {/*
          Suggestions only — the field stays free text, because a station code is whatever the
          ticket carries and a closed list would make an unlisted one unbindable.
        */}
        <datalist id="kitchen-station-codes">
          {/* The synthetic code the ticket assembler stamps on an unrouted line — not a station
              anybody created, and the one a branch with an unrouted menu needs most. */}
          <option value="UNASSIGNED" />
          {(stations.data ?? []).map((station) => (
            <option key={station.id} value={station.code}>
              {station.name}
            </option>
          ))}
          {(draft?.kitchenStations ?? []).map((code) => (
            <option key={`declared-${code}`} value={code} />
          ))}
        </datalist>

        <QueryBoundary
          query={query}
          what="this branch's printers"
          moduleLabel="Printing"
          isEmpty={draft !== null && printers.length === 0}
          empty={
            <EmptyState
              icon={Printer}
              title="No printers configured"
              description="Every bill is currently a browser print dialog and no kitchen ticket prints at all. Add a receipt printer, and one kitchen printer per station."
            />
          }
        >
          <ul className="space-y-3" data-testid="printer-list">
            {printers.map((printer, index) => (
              <li
                key={printer.id}
                className="rounded-lg border p-3"
                data-testid="printer-row"
                data-printer-role={printer.role}
              >
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-1">
                    <Label htmlFor={`role-${printer.id}`}>What it prints</Label>
                    <Select
                      id={`role-${printer.id}`}
                      options={ROLE_OPTIONS}
                      value={printer.role}
                      onValueChange={(v) =>
                        patch(index, {
                          role: v as PrinterEntry["role"],
                          stationCode: v === "KITCHEN" ? (printer.stationCode ?? "DEFAULT") : null,
                        })
                      }
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor={`name-${printer.id}`}>Name</Label>
                    <Input
                      id={`name-${printer.id}`}
                      value={printer.id}
                      onChange={(e) => patch(index, { id: e.target.value })}
                      maxLength={64}
                    />
                  </div>

                  {printer.role === "KITCHEN" && (
                    <div className="space-y-1">
                      <Label htmlFor={`station-${printer.id}`}>Station</Label>
                      <Input
                        id={`station-${printer.id}`}
                        value={printer.stationCode ?? ""}
                        onChange={(e) => patch(index, { stationCode: e.target.value.toUpperCase() })}
                        placeholder="DEFAULT"
                        maxLength={64}
                        list="kitchen-station-codes"
                      />
                      {/*
                        UNASSIGNED is not a station anybody creates — it is the code the ticket
                        assembler stamps on a line whose menu item has no station route, which on a
                        menu nobody has routed is EVERY line. A branch that binds printers only to
                        the stations it created therefore gets no paper at all and no error, which
                        is measured fact on this seed data. Naming it here is the difference between
                        a kitchen that prints and one that silently does not.
                      */}
                      <p className="text-xs text-muted-foreground">
                        The station code on the ticket. This branch has{" "}
                        {(stations.data ?? []).length > 0
                          ? (stations.data ?? []).map((st) => st.code).join(", ")
                          : "no stations yet"}
                        . Items with no station route produce tickets on{" "}
                        <strong>UNASSIGNED</strong> — bind a printer to that too, or the kitchen
                        gets nothing until the menu is routed.
                      </p>
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label htmlFor={`transport-${printer.id}`}>How it is attached</Label>
                    <Select
                      id={`transport-${printer.id}`}
                      options={TRANSPORT_OPTIONS}
                      value={printer.transport}
                      onValueChange={(v) => patch(index, { transport: v as PrinterEntry["transport"] })}
                    />
                  </div>

                  {printer.transport === "TCP" ? (
                    <>
                      <div className="space-y-1">
                        <Label htmlFor={`host-${printer.id}`}>Address</Label>
                        <Input
                          id={`host-${printer.id}`}
                          value={printer.host ?? ""}
                          onChange={(e) => patch(index, { host: e.target.value })}
                          placeholder="192.168.1.50"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`port-${printer.id}`}>Port</Label>
                        <Input
                          id={`port-${printer.id}`}
                          type="number"
                          value={printer.port ?? 9100}
                          onChange={(e) => patch(index, { port: Number(e.target.value) })}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="space-y-1 sm:col-span-2">
                      <Label htmlFor={`queue-${printer.id}`}>Print queue name</Label>
                      <Input
                        id={`queue-${printer.id}`}
                        value={printer.systemPrinterName ?? ""}
                        onChange={(e) => patch(index, { systemPrinterName: e.target.value })}
                        placeholder="TM_T88VI"
                      />
                      <p className="text-xs text-muted-foreground">
                        The queue must be RAW. A queue configured with a driver re-renders the bytes
                        and prints garbage rather than failing.
                      </p>
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label htmlFor={`width-${printer.id}`}>Paper width (mm)</Label>
                    <Input
                      id={`width-${printer.id}`}
                      type="number"
                      value={printer.widthMm}
                      onChange={(e) => patch(index, { widthMm: Number(e.target.value) })}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor={`columns-${printer.id}`}>Characters per line</Label>
                    <Input
                      id={`columns-${printer.id}`}
                      type="number"
                      value={printer.columns}
                      onChange={(e) =>
                        patch(index, { columns: Number(e.target.value), columnsMeasured: false })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {printer.columnsMeasured
                        ? "Measured on paper."
                        : "Not measured. Run a test print and count where the ruler stops."}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor={`cut-${printer.id}`}>Cutter</Label>
                    <Select
                      id={`cut-${printer.id}`}
                      options={CUT_OPTIONS}
                      value={printer.cut}
                      onValueChange={(v) => patch(index, { cut: v as PrinterEntry["cut"] })}
                    />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={printer.columnsMeasured}
                      onChange={(e) => patch(index, { columnsMeasured: e.target.checked })}
                    />
                    I counted the ruler on paper and this column count is right
                  </label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={testing === printer.id}
                      onClick={() => void handleTestPrint(printer.id)}
                      data-testid={`test-print-${printer.role}`}
                    >
                      <TestTube2 className="size-3.5" aria-hidden="true" />
                      {testing === printer.id ? "Sending…" : "Test print"}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => removePrinter(index)}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      Remove
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </QueryBoundary>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => addPrinter("RECEIPT")}
              data-testid="add-receipt-printer"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add receipt printer
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => addPrinter("KITCHEN")}
              data-testid="add-kitchen-printer"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add kitchen printer
            </Button>
          </div>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={save.isPending || draft === null}
            data-testid="save-printers"
          >
            <Save className="size-4" aria-hidden="true" />
            {save.isPending ? "Saving…" : "Save printers"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
