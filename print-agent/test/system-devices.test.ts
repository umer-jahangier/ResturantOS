import { describe, expect, it } from "vitest";

import {
  parseDefaultDestination,
  parseLpstat,
  scanSystemPrinters,
  type CommandRunner,
} from "../src/devices/system-devices.js";

/**
 * The device scan, against CAPTURED `lpstat` output.
 *
 * <p>The fixture below is verbatim from the machine this was written on — two real destinations,
 * one of them an 80mm USB thermal printer. Parsing is asserted against that rather than against a
 * shape somebody imagined, because the whole value of this file is that the name it extracts is the
 * exact string `lp -d` will accept.
 */
const LPSTAT_L_P = `printer _80Series2 is idle.  enabled since Thu Jun 18 14:45:24 2026
	Form mounted:
	Content types: any
	Printer types: unknown
	Description: 80Series2
	Alerts: offline-report
	Location: Muhammad's MacBook Pro (2)
	Connection: direct
	Interface: /private/etc/cups/ppd/_80Series2.ppd
	On fault: no alert
printer STMicroelectronics_POS80_Printer_USB is idle.  enabled since Mon Aug  3 07:49:19 2026
	Form mounted:
	Content types: any
	Printer types: unknown
	Description: STMicroelectronics POS80 Printer USB
	Alerts: offline-report
	Location: Muhammad's MacBook Pro (2)
	Connection: direct
`;

function runnerFor(map: Record<string, { stdout?: string; stderr?: string; code?: number }>): CommandRunner {
  return async (file, args) => {
    const key = `${file} ${args.join(" ")}`;
    const result = map[key];
    if (result === undefined) {
      return { stdout: "", stderr: "", code: 1 };
    }
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.code ?? 0 };
  };
}

describe("parseLpstat", () => {
  it("takes the NAME from the header line, not the description", () => {
    const devices = parseLpstat(LPSTAT_L_P);
    expect(devices.map((d) => d.name)).toEqual([
      "_80Series2",
      "STMicroelectronics_POS80_Printer_USB",
    ]);
    // The description is prose with spaces in it. Storing it in place of the name would produce a
    // configuration that reads correctly on screen and fails at the spooler.
    expect(devices[1]?.description).toBe("STMicroelectronics POS80 Printer USB");
    expect(devices[1]?.name).not.toContain(" ");
  });

  it("keeps a BUSY queue in the list — it is the one that is definitely working", () => {
    // Captured live on 2026-08-12, mid-proof, while a real receipt was on the printer. The first
    // draft of this parser required " is " after the name and dropped this line, so the till
    // printer disappeared from the settings picker for exactly as long as it was printing.
    const devices = parseLpstat(
      "printer STMicroelectronics_POS80_Printer_USB now printing " +
        "STMicroelectronics_POS80_Printer_USB-78.  enabled since Wed Aug 12 11:41:54 2026\n" +
        "\tDescription: STMicroelectronics POS80 Printer USB\n",
    );
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      name: "STMicroelectronics_POS80_Printer_USB",
      state: "PRINTING",
      description: "STMicroelectronics POS80 Printer USB",
    });
  });

  it("lists a queue whose status line this build has never seen, as UNKNOWN", () => {
    const devices = parseLpstat("printer FUTURE_MODEL is doing something new.\n");
    // Dropping an unrecognised device would make a spooler upgrade silently unconfigure a till.
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ name: "FUTURE_MODEL", state: "UNKNOWN" });
  });

  it("keeps a disabled queue in the list, marked STOPPED", () => {
    const devices = parseLpstat(
      "printer BACK_OFFICE disabled since Mon Aug  3 07:49:19 2026 -\n\treason unknown\n",
    );
    // A paused queue that VANISHED from the list would tell a manager their printer does not exist.
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ name: "BACK_OFFICE", state: "STOPPED" });
  });

  it("reads no devices from empty output rather than inventing one", () => {
    expect(parseLpstat("lpstat: No destinations added.\n")).toEqual([]);
  });
});

describe("parseDefaultDestination", () => {
  it("finds the default", () => {
    expect(parseDefaultDestination("system default destination: TM_T88VI\n")).toBe("TM_T88VI");
  });

  it("returns null when there is none, rather than guessing the first printer", () => {
    expect(parseDefaultDestination("no system default destination\n")).toBeNull();
  });
});

describe("scanSystemPrinters", () => {
  it("lists the machine's queues and marks the default", async () => {
    const scan = await scanSystemPrinters(
      runnerFor({
        "lpstat -l -p": { stdout: LPSTAT_L_P },
        "lpstat -d": { stdout: "system default destination: _80Series2\n" },
      }),
      "darwin",
    );
    expect(scan.unavailable).toBeNull();
    expect(scan.devices.map((d) => d.name)).toEqual([
      "_80Series2",
      "STMicroelectronics_POS80_Printer_USB",
    ]);
    expect(scan.devices[0]?.isDefault).toBe(true);
    expect(scan.devices[1]?.isDefault).toBe(false);
  });

  it("reports an empty machine as an empty LIST, with no reason", async () => {
    const scan = await scanSystemPrinters(
      runnerFor({
        "lpstat -l -p": { stdout: "lpstat: No destinations added.\n", code: 1 },
        "lpstat -d": { stdout: "no system default destination\n" },
      }),
      "linux",
    );
    // "this machine has no printers" is an ANSWER. It must not arrive wearing the same clothes as
    // "the scan could not run", which is why `unavailable` stays null here.
    expect(scan.devices).toEqual([]);
    expect(scan.unavailable).toBeNull();
  });

  it("reports a missing CUPS as a REASON, not as an empty list", async () => {
    const scan = await scanSystemPrinters(
      runnerFor({ "lpstat -l -p": { stderr: "ENOENT", code: 127 } }),
      "linux",
    );
    expect(scan.devices).toEqual([]);
    expect(scan.unavailable).toMatch(/CUPS/);
  });

  it("refuses to list anything on Windows, and says why", async () => {
    let ran = false;
    const scan = await scanSystemPrinters(async () => {
      ran = true;
      return { stdout: "", stderr: "", code: 0 };
    }, "win32");
    // Offering queues this agent would then refuse to print to is worse than offering nothing:
    // `system-printer.ts` rejects raw printing on Windows outright.
    expect(ran).toBe(false);
    expect(scan.devices).toEqual([]);
    expect(scan.unavailable).toMatch(/Windows/);
  });

  it("survives a runner that throws", async () => {
    const scan = await scanSystemPrinters(async () => {
      throw new Error("spawn failed");
    }, "darwin");
    expect(scan.devices).toEqual([]);
    expect(scan.unavailable).toMatch(/spawn failed/);
  });
});
