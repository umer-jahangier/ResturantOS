import { describe, it, expect } from "vitest";

import { apiPosTerminalSchema } from "@/lib/api-client/schemas/terminal.schema";
import { adaptPosTerminal } from "@/lib/adapters/terminal.adapter";

/**
 * Terminal parse behaviours (28-09 task 1).
 *
 * <p>The two empty-set cases come first because they are the ones that would do damage. A terminal
 * with no category rows offers the WHOLE menu; read as "offers nothing", a till would show a
 * cashier an empty grid and there would be no error anywhere to explain it.
 */

const RAW = {
  id: "71000001-0000-4000-8000-000000000001",
  branchId: "b1000001-0000-4000-8000-000000000001",
  code: "BAR1",
  name: "Bar till",
  serviceModel: "COUNTER",
  defaultOrderType: "DINE_IN",
  printerRef: null,
  active: true,
  categoryIds: ["c1000001-0000-4000-8000-000000000001"],
  stationIds: ["51000001-0000-4000-8000-000000000002"],
  offersWholeMenu: false,
  firesToAllStations: false,
};

function omit<T extends object, K extends keyof T>(source: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...source };
  for (const key of keys) delete copy[key];
  return copy;
}

describe("adaptPosTerminal", () => {
  it("reads an EMPTY category set as offering the whole menu, through a named property", () => {
    const terminal = adaptPosTerminal(
      apiPosTerminalSchema.parse({ ...RAW, categoryIds: [], offersWholeMenu: true }),
    );

    expect(terminal.offersWholeMenu).toBe(true);
    expect(terminal.categoryIds).toEqual([]);
  });

  it("reads an EMPTY station set as firing to every station", () => {
    const terminal = adaptPosTerminal(
      apiPosTerminalSchema.parse({ ...RAW, stationIds: [], firesToAllStations: true }),
    );

    expect(terminal.firesToAllStations).toBe(true);
  });

  it("derives the scope booleans from the arrays, so a stale flag cannot contradict them", () => {
    // A server that sent `offersWholeMenu: true` alongside a populated list would be sending two
    // answers to one question. The list is the fact; the flag is a summary of it.
    const terminal = adaptPosTerminal(
      apiPosTerminalSchema.parse({ ...RAW, offersWholeMenu: true, firesToAllStations: true }),
    );

    expect(terminal.offersWholeMenu).toBe(false);
    expect(terminal.firesToAllStations).toBe(false);
  });

  it("parses a terminal into a model carrying id, code, name, service model and both sets", () => {
    const terminal = adaptPosTerminal(apiPosTerminalSchema.parse(RAW));

    expect(terminal).toMatchObject({
      id: RAW.id,
      branchId: RAW.branchId,
      code: "BAR1",
      name: "Bar till",
      serviceModel: "COUNTER",
      defaultOrderType: "DINE_IN",
      active: true,
      categoryIds: RAW.categoryIds,
      stationIds: RAW.stationIds,
    });
  });

  it("degrades an unrecognised service model and order type instead of throwing", () => {
    const terminal = adaptPosTerminal(
      apiPosTerminalSchema.parse({ ...RAW, serviceModel: "KIOSK", defaultOrderType: "DRIVE_THRU" }),
    );

    expect(terminal.serviceModel).toBe("COUNTER");
    expect(terminal.defaultOrderType).toBe("DINE_IN");
  });

  it("parses a response missing the fields this client knows about, with safe defaults", () => {
    const sparse = omit(
      RAW,
      "serviceModel",
      "defaultOrderType",
      "printerRef",
      "active",
      "categoryIds",
      "stationIds",
      "offersWholeMenu",
      "firesToAllStations",
    );

    const terminal = adaptPosTerminal(apiPosTerminalSchema.parse(sparse));

    expect(terminal.serviceModel).toBe("COUNTER");
    expect(terminal.active).toBe(true);
    expect(terminal.offersWholeMenu).toBe(true);
    expect(terminal.firesToAllStations).toBe(true);
  });

  it("treats an absent active flag as active, never as retired", () => {
    const terminal = adaptPosTerminal(apiPosTerminalSchema.parse({ ...RAW, active: undefined }));

    expect(terminal.active).toBe(true);
  });
});
