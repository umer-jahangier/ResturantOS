import { spawn } from "node:child_process";

import { TransportError } from "./tcp9100.js";

/**
 * The operating system's own raw print queue, for the USB printer bolted to a till.
 *
 * <h2>What a resolved promise means here — read this before trusting it</h2>
 *
 * <p>It means the SPOOLER ACCEPTED THE JOB. That is all it means.
 *
 * <p>It is not evidence that paper moved, that the printer was switched on, that it had paper, or
 * that the job ever left the queue. A spooler accepts jobs for a printer that has been unplugged
 * since Tuesday and holds them indefinitely. This transport is therefore weaker evidence than the
 * TCP one, and even that one only proves bytes reached a socket.
 *
 * <p>Nothing in this package will ever report `PRINTED` on the strength of either.
 *
 * <h2>Why TCP is preferred (research §9.3 decision 5)</h2>
 *
 * <p>Network printers decouple the device from any one machine, let a single per-branch agent
 * serve every printer, and remove Windows driver-claiming from the picture entirely. This
 * transport exists for the one receipt printer physically attached to a till, and is the exception.
 */

/** Injected so the tests can assert behaviour without a printer, or a spooler, attached. */
export type Spawner = typeof spawn;

export interface SystemPrinterTarget {
  systemPrinterName: string;
  writeTimeoutMs: number;
}

export function sendToSystemPrinter(
  bytes: Uint8Array,
  target: SystemPrinterTarget,
  spawner: Spawner = spawn,
): Promise<void> {
  const name = target.systemPrinterName;

  if (process.platform === "win32") {
    // Deliberately not a silent no-op. Windows raw printing needs a different mechanism entirely
    // (a share path, or the print spooler API), and pretending to succeed here would be the worst
    // possible outcome: a till that reports every receipt as accepted and prints none.
    return Promise.reject(
      new TransportError(
        `system printer "${name}": raw printing on Windows is not implemented in this agent. ` +
          "Use the TCP transport (research §9.3 decision 5 prefers it anyway), or attach the " +
          "printer to a machine running a POSIX spooler.",
      ),
    );
  }

  return new Promise<void>((resolve, reject) => {
    // `-o raw` is the important flag: the bytes are ESC/POS and must reach the device untouched.
    // Without it CUPS would try to rasterise them through a driver, which is exactly the
    // "rasterised through a print driver" path D-26-01 rules out.
    const child = spawner("lp", ["-d", name, "-o", "raw"], { stdio: ["pipe", "ignore", "pipe"] });

    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new TransportError(`system printer "${name}": the spooler did not respond in ${target.writeTimeoutMs}ms`));
    }, target.writeTimeoutMs);

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new TransportError(`system printer "${name}": could not run lp`, err));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        // ACCEPTED BY THE SPOOLER. Not printed. See this file's header.
        resolve();
      } else {
        reject(new TransportError(`system printer "${name}": lp exited ${code}. ${stderr.trim()}`));
      }
    });

    child.stdin?.on("error", () => {
      /* the close handler above owns the outcome */
    });
    child.stdin?.end(Buffer.from(bytes));
  });
}
