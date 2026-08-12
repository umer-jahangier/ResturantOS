import type { CutMode, PrinterEntry } from "../config.js";
import type { RegistryPrinter } from "./poll.js";

/**
 * The server's printer registry, turned into entries the transports can drive.
 *
 * <h2>Why this exists</h2>
 *
 * <p>A claimed job names a `targetPrinterId` and nothing else. Until the claim response began
 * carrying the registry, the only place that id could be resolved to a host, a port or a spooler
 * queue was `print-agent.config.json` on the till — so a manager who added a printer in the product
 * changed nothing until somebody edited a file on the machine and restarted the agent. That is the
 * exact "configured in the product, inert in reality" shape this repair exists to remove.
 *
 * <h2>Defaults, and the one field that must never get one</h2>
 *
 * <p>`widthMm`, `columns`, `codepage` and `cut` fall back so a registry written by an older UI
 * still renders. <b>`columnsMeasured` never does.</b> Research §7.5 could not establish a canonical
 * column count for any model, so a stored value nobody counted on paper is a DIFFERENT thing from
 * one somebody did, and inferring the second from the first would put the wrong wrap point on a
 * customer's bill while the diagnostic page claimed it was measured.
 */
export function adoptRegistryPrinter(raw: RegistryPrinter): PrinterEntry | null {
  const transport = raw.transport === "SYSTEM" ? "SYSTEM" : raw.transport === "TCP" ? "TCP" : null;
  if (transport === null) return null;
  // A transport that cannot be driven is DROPPED rather than adopted. `loadConfig` refuses to
  // start on one of these because a person is sitting at the machine able to fix it; a registry
  // arriving mid-service is not that situation, and refusing every printer because one of three is
  // half-configured would take the working two down with it.
  if (transport === "TCP" && (raw.host === null || raw.host === "" || raw.port === null)) return null;
  if (transport === "SYSTEM" && (raw.systemPrinterName === null || raw.systemPrinterName === "")) {
    return null;
  }
  return {
    id: raw.id,
    terminalId: null,
    role: raw.role === "KITCHEN" ? "KITCHEN" : "RECEIPT",
    stationCode: raw.stationCode,
    transport,
    host: raw.host,
    port: raw.port,
    systemPrinterName: raw.systemPrinterName,
    widthMm: raw.widthMm ?? 80,
    columns: raw.columns ?? 42,
    columnsMeasured: raw.columnsMeasured === true,
    codepage: raw.codepage ?? "CP437",
    cut: (raw.cut as CutMode | null) ?? "PARTIAL",
    drawerPin: raw.drawerPin,
    drawerPulseMs: raw.drawerPulseMs,
  };
}

/** What {@link applyRegistry} did, so the caller can log a change rather than a heartbeat. */
export interface RegistryApplication {
  adopted: PrinterEntry[];
  /** Ids that named a transport this agent cannot drive, or that were missing an address. */
  rejected: string[];
  changed: boolean;
}

/**
 * REPLACE the agent's printer list with the server's.
 *
 * <p>Replacing rather than merging is deliberate. The branch record is the single source of truth
 * for what this branch prints on; a local leftover that survived a deletion in the UI would be a
 * printer nobody can see on any screen and nobody can stop.
 */
export function applyRegistry(
  current: PrinterEntry[],
  incoming: RegistryPrinter[],
): RegistryApplication {
  const adopted: PrinterEntry[] = [];
  const rejected: string[] = [];
  for (const raw of incoming) {
    const entry = adoptRegistryPrinter(raw);
    if (entry === null) rejected.push(raw.id);
    else adopted.push(entry);
  }
  const before = current.map((p) => `${p.id}@${p.transport}:${p.host ?? p.systemPrinterName ?? ""}:${p.port ?? ""}`);
  const after = adopted.map((p) => `${p.id}@${p.transport}:${p.host ?? p.systemPrinterName ?? ""}:${p.port ?? ""}`);
  return { adopted, rejected, changed: before.join("|") !== after.join("|") };
}
