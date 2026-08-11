import type { AgentConfig, PrinterEntry } from "../config.js";
import { TransportError, sendOverTcp9100 } from "./tcp9100.js";
import { sendToSystemPrinter, type Spawner } from "./system-printer.js";

export { TransportError } from "./tcp9100.js";

/**
 * Choosing how to reach a printer.
 *
 * <p>An unknown transport value is rejected at CONFIGURATION LOAD (see `config.ts`), not here — a
 * misconfigured printer must fail when somebody configures it, not when a customer is waiting at
 * the counter. This function's own guard is the backstop for a registry that reached the agent by
 * some other route.
 */
export type Sender = (bytes: Uint8Array) => Promise<void>;

export function selectTransport(
  printer: PrinterEntry,
  config: Pick<AgentConfig, "connectTimeoutMs" | "writeTimeoutMs">,
  spawner?: Spawner,
): Sender {
  switch (printer.transport) {
    case "TCP": {
      if (printer.host === null || printer.port === null) {
        throw new TransportError(
          `printer "${printer.id}" uses the TCP transport but has no host or port. This should ` +
            "have been rejected at configuration load.",
        );
      }
      const target = {
        host: printer.host,
        port: printer.port,
        connectTimeoutMs: config.connectTimeoutMs,
        writeTimeoutMs: config.writeTimeoutMs,
      };
      return (bytes) => sendOverTcp9100(bytes, target);
    }
    case "SYSTEM": {
      if (printer.systemPrinterName === null) {
        throw new TransportError(
          `printer "${printer.id}" uses the SYSTEM transport but names no queue. This should have ` +
            "been rejected at configuration load.",
        );
      }
      const target = {
        systemPrinterName: printer.systemPrinterName,
        writeTimeoutMs: config.writeTimeoutMs,
      };
      return (bytes) => sendToSystemPrinter(bytes, target, spawner);
    }
    default: {
      const exhaustive: never = printer.transport;
      throw new TransportError(
        `printer "${printer.id}" declares transport "${String(exhaustive)}", which this agent ` +
          "cannot drive.",
      );
    }
  }
}
