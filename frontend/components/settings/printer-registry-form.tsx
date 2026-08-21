"use client";

import { useEffect, useMemo, useState } from "react";
import { Printer, Save, TestTube2, Trash2, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { useReceiptConfig, useSaveReceiptConfig } from "@/lib/hooks/settings/use-receipt-config";
import {
  EMPTY_RECEIPT_CONFIG,
  type PrinterEntry,
  type ReceiptConfig,
} from "@/lib/models/receipt-config.model";
import { usePrintAgents, usePrinterHealth } from "@/lib/hooks/settings/use-print-agents";
import {
  describeDelivery,
  discoveredDevices,
  noDeviceReason,
  type PrinterDelivery,
} from "@/lib/models/print-agent.model";
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

/** Which fields of one printer row are wrong, and why, in the operator's words. */
interface FieldProblems {
  id?: string;
  stationCode?: string;
  host?: string;
  port?: string;
  systemPrinterName?: string;
  columns?: string;
  widthMm?: string;
}

/**
 * Validate one row against the rest, live, as the operator types.
 *
 * <h2>Why this is here and not only on the server</h2>
 *
 * <p>The server rejects a bad registry with a 400 and a field path. That is correct and it is not
 * enough: the register recorded that no screen in this product does inline validation at all, and
 * a printer configuration is the worst place to learn that — a save that succeeds with a queue name
 * nobody can spell produces no error anywhere and no paper in the kitchen, and the person who
 * typed it has gone home.
 *
 * <p>Every message names the FIELD and the REAL problem. "Invalid" is not a message.
 */
function validatePrinter(printer: PrinterEntry, all: PrinterEntry[]): FieldProblems {
  const problems: FieldProblems = {};
  const name = printer.id.trim();

  if (name.length === 0) {
    problems.id = "Give this printer a name. It is how a bill or a ticket is addressed to it.";
  } else if (all.filter((p) => p.id.trim() === name).length > 1) {
    problems.id = `Another printer is already called “${name}”. Two printers with one name means tickets go to whichever was saved last.`;
  }

  if (printer.role === "KITCHEN" && (printer.stationCode ?? "").trim().length === 0) {
    problems.stationCode =
      "A kitchen printer needs the station code that appears on the ticket — DEFAULT, or UNASSIGNED for items with no station route.";
  }

  if (printer.transport === "TCP") {
    const host = (printer.host ?? "").trim();
    if (host.length === 0) {
      problems.host = "Enter the printer's address on the network, for example 192.168.1.50.";
    } else if (/\s/.test(host)) {
      problems.host = "An address cannot contain spaces. Use the printer's IP address or hostname.";
    }
    const port = printer.port;
    if (port === null || !Number.isInteger(port) || port < 1 || port > 65535) {
      problems.port =
        "A port is a whole number between 1 and 65535. Thermal printers almost always listen on 9100.";
    }
  } else if ((printer.systemPrinterName ?? "").trim().length === 0) {
    problems.systemPrinterName =
      "Choose which printer on the machine this is. The list comes from the print agent running on that machine.";
  }

  if (!Number.isInteger(printer.columns) || printer.columns < 1 || printer.columns > 200) {
    problems.columns =
      "Characters per line must be a whole number between 1 and 200. An 80mm roll is usually 42 or 48.";
  }
  if (!Number.isFinite(printer.widthMm) || printer.widthMm < 20 || printer.widthMm > 120) {
    problems.widthMm = "Paper width must be between 20mm and 120mm. Till rolls are 58mm or 80mm.";
  }

  return problems;
}

/**
 * The options on the USB/system printer picker.
 *
 * <p>The VALUE is the queue name and nothing else — that is the string the spooler is asked for.
 * The LABEL may carry the description and the machine, because those are what a human recognises;
 * storing a label in place of a name is the mistake that produces a configuration reading correctly
 * on screen and failing at the printer.
 *
 * <p>A stored value no agent currently reports is appended rather than dropped. The till it belongs
 * to may be switched off, and a picker that silently loses a working printer because a machine is
 * asleep would be a new instance of the defect this replaced.
 */
function systemPrinterOptions(
  devices: ReturnType<typeof discoveredDevices>,
  stored: string | null,
): { value: string; label: string }[] {
  const options = devices.map((device) => ({
    value: device.name,
    label:
      `${device.name}` +
      (device.description && device.description !== device.name ? ` — ${device.description}` : "") +
      ` · on ${device.agentLabel}` +
      (device.agentConnected ? "" : " (that machine is not answering)") +
      (device.state === "STOPPED" ? " · queue paused" : ""),
  }));
  const value = (stored ?? "").trim();
  if (value.length > 0 && !options.some((o) => o.value === value)) {
    options.push({
      value,
      label: `${value} — saved earlier, not reported by any agent right now`,
    });
  }
  return options;
}

const TONE_CLASS: Record<ReturnType<typeof describeDelivery>["tone"], string> = {
  ok: "border-success/40 bg-success/10 text-success",
  warn: "border-warning/40 bg-warning/10 text-warning",
  bad: "border-destructive/40 bg-destructive/10 text-destructive",
  muted: "border-border bg-muted text-muted-foreground",
};

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
   * The branch's agents, read for ONE reason on this form: the print queues they found on their
   * own machines (S8).
   *
   * <p>Before this, choosing a USB printer meant typing its CUPS destination from memory into a box
   * whose placeholder was somebody else's printer model. A typo there is invisible: the save
   * succeeds, the registry reaches the agent, the job is enqueued, and `lp` fails at the spooler
   * with nobody watching. The machine already knows the answer, so the machine is asked.
   */
  const agents = usePrintAgents(branchId);
  /**
   * What each printer has DONE with the jobs it was given.
   *
   * <p>The panel above this one reports whether a MACHINE is polling; the unrouted-stations alert
   * below reports whether a station has a printer AT ALL. Neither can say that a perfectly
   * configured printer has refused every connection for an hour, which is the state a kitchen
   * actually meets, and which this reads.
   */
  const health = usePrinterHealth(branchId);

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

  /** Every distinct queue any of this branch's agents reported, most recently reported first. */
  const devices = useMemo(() => discoveredDevices(agents.data ?? []), [agents.data]);
  const deviceReason = useMemo(
    () => (devices.length > 0 ? null : noDeviceReason(agents.data ?? [])),
    [devices.length, agents.data],
  );

  const healthByPrinter = useMemo(() => {
    const map = new Map<string, PrinterDelivery>();
    for (const row of health.data?.printers ?? []) map.set(row.printerId, row);
    return map;
  }, [health.data]);

  /**
   * The rows whose most recent job FAILED — the sentence this screen owes a manager.
   *
   * <p>Reported per STATION for a kitchen printer, because a station is the thing a chef is waiting
   * at; a receipt printer is named as the till's.
   */
  const cannotPrint = useMemo(
    () =>
      printers
        .map((printer) => ({ printer, delivery: healthByPrinter.get(printer.id) }))
        .filter((row) => row.delivery?.state === "FAILING"),
    [printers, healthByPrinter],
  );

  const problemsByPrinter = useMemo(
    () => printers.map((printer) => validatePrinter(printer, printers)),
    [printers],
  );
  const hasProblems = problemsByPrinter.some((p) => Object.keys(p).length > 0);

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
    // Belt as well as braces: the button is disabled while anything is wrong, and a keyboard submit
    // or a stale click must not slip a half-configured printer past the same rule.
    if (hasProblems) {
      toast.error("Some printers are not ready to save. Each problem is named under its field.");
      return;
    }
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
          customer&rsquo;s bill when an order is settled; a kitchen printer prints the ticket for
          its station when the order is fired. Both happen on the server, so they do not depend on
          any browser tab being open.
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
            <p className="text-label text-muted-foreground">
              Used only by the Test print button on this screen. Real bills and kitchen tickets
              never go through the browser.
            </p>
          </div>
          <div className="space-y-1">
            <Label>Agent on this computer</Label>
            <div
              className="rounded-lg border p-3 text-label"
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

        {/*
          The station that HAS a printer and still cannot print. Distinct from the unrouted alert
          below it, and deliberately above it: an unrouted station is a configuration somebody has
          not finished, and this is equipment that has stopped working during service.
        */}
        {cannotPrint.length > 0 && (
          <div
            role="alert"
            data-testid="printers-failing"
            className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-small"
          >
            {cannotPrint.map(({ printer, delivery }) => (
              <p key={printer.id} data-testid="printer-cannot-print" data-printer-id={printer.id}>
                <strong>
                  {printer.role === "KITCHEN"
                    ? `${printer.stationCode ?? "This station"} cannot print.`
                    : "The receipt printer cannot print."}
                </strong>{" "}
                {describeDelivery(delivery).detail}
              </p>
            ))}
          </div>
        )}

        {health.isError && (
          <div
            role="alert"
            data-testid="printer-health-unavailable"
            className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-small"
          >
            Whether these printers are printing could not be read just now, so this screen is
            showing their configuration only. It is not a statement that they are working.
          </div>
        )}

        {unrouted.length > 0 && (
          <div
            role="alert"
            data-testid="unrouted-stations"
            className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-small"
          >
            <TriangleAlert className="mt-0.5 size-4 text-warning" aria-hidden="true" />
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
            {printers.map((printer, index) => {
              const problems = problemsByPrinter[index] ?? {};
              const delivery = healthByPrinter.get(printer.id);
              const described = describeDelivery(delivery);
              return (
                <li
                  key={printer.id}
                  className="rounded-lg border p-3"
                  data-testid="printer-row"
                  data-printer-role={printer.role}
                  data-printer-id={printer.id}
                >
                  {/*
                  What this printer has DONE, at the top of its own row. A configuration is a claim
                  about intent; this is the only thing on the screen that is evidence.
                */}
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-label font-medium ${TONE_CLASS[described.tone]}`}
                      data-testid="printer-delivery"
                      data-delivery-state={delivery?.state ?? "UNKNOWN"}
                    >
                      {described.label}
                    </span>
                    <span className="text-label text-muted-foreground">{described.detail}</span>
                  </div>

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
                            stationCode:
                              v === "KITCHEN" ? (printer.stationCode ?? "DEFAULT") : null,
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
                        aria-invalid={problems.id !== undefined}
                        aria-describedby={problems.id ? `name-${printer.id}-error` : undefined}
                      />
                      {problems.id && (
                        <p
                          id={`name-${printer.id}-error`}
                          role="alert"
                          className="text-label text-destructive"
                        >
                          {problems.id}
                        </p>
                      )}
                    </div>

                    {printer.role === "KITCHEN" && (
                      <div className="space-y-1">
                        <Label htmlFor={`station-${printer.id}`}>Station</Label>
                        <Input
                          id={`station-${printer.id}`}
                          value={printer.stationCode ?? ""}
                          onChange={(e) =>
                            patch(index, { stationCode: e.target.value.toUpperCase() })
                          }
                          placeholder="DEFAULT"
                          maxLength={64}
                          list="kitchen-station-codes"
                          aria-invalid={problems.stationCode !== undefined}
                        />
                        {problems.stationCode && (
                          <p role="alert" className="text-label text-destructive">
                            {problems.stationCode}
                          </p>
                        )}
                        {/*
                        UNASSIGNED is not a station anybody creates — it is the code the ticket
                        assembler stamps on a line whose menu item has no station route, which on a
                        menu nobody has routed is EVERY line. A branch that binds printers only to
                        the stations it created therefore gets no paper at all and no error, which
                        is measured fact on this seed data. Naming it here is the difference between
                        a kitchen that prints and one that silently does not.
                      */}
                        <p className="text-label text-muted-foreground">
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
                        onValueChange={(v) =>
                          patch(index, { transport: v as PrinterEntry["transport"] })
                        }
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
                            aria-invalid={problems.host !== undefined}
                          />
                          {problems.host && (
                            <p role="alert" className="text-label text-destructive">
                              {problems.host}
                            </p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`port-${printer.id}`}>Port</Label>
                          <Input
                            id={`port-${printer.id}`}
                            type="number"
                            value={printer.port ?? 9100}
                            onChange={(e) => patch(index, { port: Number(e.target.value) })}
                            aria-invalid={problems.port !== undefined}
                          />
                          {problems.port && (
                            <p role="alert" className="text-label text-destructive">
                              {problems.port}
                            </p>
                          )}
                        </div>
                      </>
                    ) : (
                      /*
                      THE LIST, not a text box (S8).

                      This was an `<Input placeholder="TM_T88VI">`. Configuring the USB printer on a
                      till meant knowing its exact CUPS destination and typing it without a typo,
                      and a typo produced no error on this screen, no error on save, and no paper —
                      `lp -d` fails at the spooler minutes later with nobody watching. The agent on
                      that machine can see its own queues, so it reports them and they are offered
                      here BY NAME.

                      A stored value that no agent currently reports is still offered, marked, and
                      never silently dropped: the till it belongs to may simply be switched off, and
                      a form that quietly erases a working configuration because a machine is asleep
                      is worse than the problem it was built to fix.
                    */
                      <div className="space-y-1 sm:col-span-2">
                        <Label htmlFor={`queue-${printer.id}`}>Printer on the machine</Label>
                        <Select
                          id={`queue-${printer.id}`}
                          data-testid="system-printer-picker"
                          value={printer.systemPrinterName ?? ""}
                          placeholder={
                            devices.length > 0
                              ? "Choose a printer the agent found…"
                              : "No printer has been reported yet"
                          }
                          isLoading={agents.isPending}
                          error={agents.isError}
                          onRetry={() => void agents.refetch()}
                          emptyLabel="No printer has been reported yet"
                          aria-invalid={problems.systemPrinterName !== undefined}
                          options={systemPrinterOptions(devices, printer.systemPrinterName)}
                          onValueChange={(v) => patch(index, { systemPrinterName: v })}
                        />
                        {problems.systemPrinterName && (
                          <p role="alert" className="text-label text-destructive">
                            {problems.systemPrinterName}
                          </p>
                        )}
                        {deviceReason !== null && !agents.isError && (
                          <p
                            data-testid="no-devices-reason"
                            className="text-label text-muted-foreground"
                          >
                            {deviceReason}
                          </p>
                        )}
                        <p className="text-label text-muted-foreground">
                          The queue must be RAW. A queue configured with a driver re-renders the
                          bytes and prints garbage rather than failing.
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
                        aria-invalid={problems.widthMm !== undefined}
                      />
                      {problems.widthMm && (
                        <p role="alert" className="text-label text-destructive">
                          {problems.widthMm}
                        </p>
                      )}
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
                        aria-invalid={problems.columns !== undefined}
                      />
                      {problems.columns ? (
                        <p role="alert" className="text-label text-destructive">
                          {problems.columns}
                        </p>
                      ) : (
                        <p className="text-label text-muted-foreground">
                          {printer.columnsMeasured
                            ? "Measured on paper."
                            : "Not measured. Run a test print and count where the ruler stops."}
                        </p>
                      )}
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
                    <label className="flex items-center gap-2 text-label text-muted-foreground">
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
              );
            })}
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
          <div className="flex flex-col items-end gap-1">
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={save.isPending || draft === null || hasProblems}
              data-testid="save-printers"
            >
              <Save className="size-4" aria-hidden="true" />
              {save.isPending ? "Saving…" : "Save printers"}
            </Button>
            {hasProblems && (
              <p role="alert" data-testid="save-blocked" className="text-label text-destructive">
                Fix the problems named above before saving — a printer saved with a missing address
                or an unrecognised queue accepts every job and prints nothing.
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
