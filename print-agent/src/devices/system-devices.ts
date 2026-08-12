import { execFile } from "node:child_process";

/**
 * What print queues actually exist on the machine this agent is running on.
 *
 * <h2>Why this file had to exist</h2>
 *
 * <p>The printer registry has always been able to describe a USB printer — {@code transport:
 * "SYSTEM"} plus a {@code systemPrinterName} that {@code system-printer.ts} hands to {@code lp -d}.
 * What nobody could do was find out what to put in that field. The settings screen offered a
 * free-text box with a placeholder of somebody else's printer model, so configuring a USB till
 * printer meant knowing its exact CUPS queue name by heart and typing it without a typo — and a
 * typo is not an error anybody sees. It is a printer that accepts every save, reports every job
 * enqueued, and never prints, because {@code lp -d} fails at the spooler long after the manager
 * has closed the screen.
 *
 * <p>A machine already knows the answer. This asks it.
 *
 * <h2>An empty list and a failed scan are different things</h2>
 *
 * <p>{@link DeviceScan.unavailable} carries the reason a scan produced nothing, and it is NEVER
 * set alongside devices. A UI that cannot tell "this machine has no printers attached" from "the
 * scan could not run" shows an empty dropdown for both, and the manager concludes their printer is
 * broken when the truth is that CUPS is not installed. That is the same shape of defect as an
 * error page that renders as an empty state, which this product has shipped more than once.
 *
 * <h2>Windows</h2>
 *
 * <p>Reported as unavailable, with the reason. Windows raw printing is deliberately unimplemented
 * in {@code system-printer.ts} — offering a list of queues that this agent would then refuse to
 * print to is worse than offering nothing, because the manager would have configured a printer the
 * product knows it cannot drive and been told so by nobody.
 */

export type DeviceState = "IDLE" | "PRINTING" | "STOPPED" | "UNKNOWN";

export interface SystemDevice {
  /** The exact destination name. This is what {@code lp -d} takes; it is not a display label. */
  name: string;
  /** The human description CUPS carries, when it differs usefully from the name. */
  description: string | null;
  state: DeviceState;
  /** True for the machine's default destination, which is only a hint and never a routing rule. */
  isDefault: boolean;
}

export interface DeviceScan {
  devices: SystemDevice[];
  /**
   * Null when the scan RAN. A sentence naming the reason when it could not — never an empty list
   * standing in for a failure.
   */
  unavailable: string | null;
  scannedAt: number;
}

/**
 * Caps, because this list crosses a trust boundary.
 *
 * <p>The scan result is reported to the server on every poll and rendered on a settings screen. A
 * machine with a runaway CUPS configuration — or an agent host somebody else controls — must not
 * be able to write an unbounded blob into a tenant's row or a thousand options into a dropdown.
 */
export const MAX_DEVICES = 50;
export const MAX_NAME_LENGTH = 128;
const MAX_DESCRIPTION_LENGTH = 160;

/** Injected so the tests exercise the parser against captured `lpstat` output, with no spooler. */
export type CommandRunner = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string; code: number }>;

const SCAN_TIMEOUT_MS = 4_000;

const defaultRunner: CommandRunner = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: SCAN_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
        resolve({ stdout: "", stderr: "ENOENT", code: 127 });
        return;
      }
      // A non-zero exit with usable stdout is normal here: `lpstat -p` exits 1 on a machine with
      // no destinations while still printing a perfectly good "no destinations added" line.
      const exitCode = error === null ? 0 : (error as NodeJS.ErrnoException).code;
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        code: typeof exitCode === "number" ? exitCode : error === null ? 0 : 1,
      });
    });
  });

export async function scanSystemPrinters(
  runner: CommandRunner = defaultRunner,
  platform: NodeJS.Platform = process.platform,
): Promise<DeviceScan> {
  const scannedAt = Date.now();

  if (platform === "win32") {
    return {
      devices: [],
      unavailable:
        "This agent is running on Windows, where it cannot send raw ESC/POS to a print queue. " +
        "Attach the printer to the network and add it by address and port, or run the agent on a " +
        "machine with a POSIX spooler.",
      scannedAt,
    };
  }

  let listing: { stdout: string; stderr: string; code: number };
  try {
    listing = await runner("lpstat", ["-l", "-p"]);
  } catch (error) {
    return {
      devices: [],
      unavailable: `The print queues on this machine could not be listed: ${message(error)}`,
      scannedAt,
    };
  }

  if (listing.code === 127 || /ENOENT|not found/i.test(listing.stderr)) {
    return {
      devices: [],
      unavailable:
        "No CUPS installation was found on the machine running this agent (lpstat is not on its " +
        "PATH), so its USB print queues cannot be listed.",
      scannedAt,
    };
  }

  const devices = parseLpstat(listing.stdout);

  // The default destination is a separate question and a failure to answer it is not a failure to
  // list: a machine can have five queues and no default. Never fatal.
  let defaultName: string | null = null;
  try {
    const d = await runner("lpstat", ["-d"]);
    defaultName = parseDefaultDestination(d.stdout);
  } catch {
    defaultName = null;
  }

  const withDefault = devices.map((device) => ({
    ...device,
    isDefault: defaultName !== null && device.name === defaultName,
  }));

  return { devices: withDefault.slice(0, MAX_DEVICES), unavailable: null, scannedAt };
}

/**
 * Parse `lpstat -l -p`.
 *
 * <p>The name is taken from the header line and NOT from the Description, because the header name
 * is the destination `lp -d` accepts and the description is prose a human typed. Confusing the two
 * produces a configuration that looks right on screen and fails at the spooler.
 */
export function parseLpstat(stdout: string): SystemDevice[] {
  const devices: SystemDevice[] = [];
  let current: SystemDevice | null = null;

  for (const rawLine of stdout.split("\n")) {
    /*
     * Every `printer <name> …` line is a device, WHATEVER follows the name.
     *
     * This started out matching `printer (\S+) is (\w+)`, which cost a live proof run: CUPS writes
     * `printer TM_T88VI now printing TM_T88VI-78.` while a job is on it, so the one printer that was
     * definitely working vanished from the picker for as long as it was busy. A printer that
     * disappears from a settings screen at the exact moment it is in use is a worse defect than the
     * free-text box this file replaced. The NAME is taken from position; the STATE is read from
     * whatever the rest of the line says, and an unrecognised phrase is UNKNOWN — never a reason to
     * drop the device.
     */
    const header = /^printer\s+(\S+)\s+(.*)$/.exec(rawLine);
    if (header !== null && header[1] !== undefined) {
      current = {
        name: header[1].slice(0, MAX_NAME_LENGTH),
        description: null,
        state: toState(header[2] ?? ""),
        isDefault: false,
      };
      devices.push(current);
      continue;
    }
    const description = /^\s+Description:\s*(.*)$/.exec(rawLine);
    if (description !== null && current !== null) {
      const text = (description[1] ?? "").trim();
      current.description = text.length === 0 ? null : text.slice(0, MAX_DESCRIPTION_LENGTH);
    }
  }

  return devices;
}

export function parseDefaultDestination(stdout: string): string | null {
  const match = /system default destination:\s*(\S+)/i.exec(stdout);
  return match === null ? null : (match[1] ?? null);
}

/**
 * The rest of the header line, in CUPS's own words:
 *
 * <pre>
 *   is idle.  enabled since …
 *   now printing TM_T88VI-78.  enabled since …
 *   disabled since Mon … -
 *   is stopped.
 * </pre>
 */
function toState(rest: string): DeviceState {
  const lower = rest.toLowerCase();
  if (lower.startsWith("disabled") || lower.includes("is stopped")) return "STOPPED";
  if (lower.includes("now printing") || lower.includes("is printing") || lower.includes("processing")) {
    return "PRINTING";
  }
  if (lower.includes("is idle")) return "IDLE";
  return "UNKNOWN";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
