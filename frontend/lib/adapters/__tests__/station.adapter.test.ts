import { describe, it, expect } from "vitest";

import { apiStationSchema } from "@/lib/api-client/schemas/pos.schema";
import { adaptStation } from "@/lib/adapters/pos.adapter";

/**
 * Station parse behaviours (28-06 task 1).
 *
 * <p>The two tolerance cases are the ones that matter. `stationType` and `displayFamily` landed
 * on `StationDto` in plan 28-02; a browser deployed a few minutes ahead of pos-service — or
 * pointed at an instance still rolling — receives responses without them. Throwing there would
 * blank the one screen whose job is to say which stations exist, so an absent or unrecognised
 * value degrades to KITCHEN, which is what every station in the product already is.
 */

const RAW = {
  id: "5b9f0d4e-0000-4000-8000-000000000001",
  branchId: "b1000001-0000-4000-8000-000000000001",
  code: "BAR",
  name: "Main bar",
  active: true,
  stationType: "BAR",
  displayFamily: "BAR",
};

/** Drop keys from the fixture. A destructure with throwaway bindings trips no-unused-vars. */
function omit<T extends object, K extends keyof T>(source: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...source };
  for (const key of keys) delete copy[key];
  return copy;
}

describe("adaptStation", () => {
  it("parses a station into a model carrying id, code, name, type and active flag", () => {
    const station = adaptStation(apiStationSchema.parse(RAW));

    expect(station.id).toBe(RAW.id);
    expect(station.branchId).toBe(RAW.branchId);
    expect(station.code).toBe("BAR");
    expect(station.name).toBe("Main bar");
    expect(station.stationType).toBe("BAR");
    expect(station.displayFamily).toBe("BAR");
    expect(station.active).toBe(true);
  });

  it("parses a response with NO type field as KITCHEN rather than throwing", () => {
    const withoutType = omit(RAW, "stationType", "displayFamily");

    const station = adaptStation(apiStationSchema.parse(withoutType));

    expect(station.stationType).toBe("KITCHEN");
    expect(station.displayFamily).toBe("KITCHEN");
  });

  it("parses an UNRECOGNISED type as KITCHEN and does not throw", () => {
    const station = adaptStation(
      apiStationSchema.parse({ ...RAW, stationType: "TEPPANYAKI", displayFamily: "TEPPANYAKI" }),
    );

    expect(station.stationType).toBe("KITCHEN");
    expect(station.displayFamily).toBe("KITCHEN");
  });

  it("derives the display family when the server sent a type but no family", () => {
    const noFamily = omit(RAW, "displayFamily");

    // DESSERT is the interesting one: five types, three families — a dessert belongs on the
    // KITCHEN screen, and the mapping is the server's. This fallback exists only for a response
    // that predates `displayFamily`, and it must agree with StationType.displayFamily().
    const station = adaptStation(apiStationSchema.parse({ ...noFamily, stationType: "DESSERT" }));

    expect(station.stationType).toBe("DESSERT");
    expect(station.displayFamily).toBe("KITCHEN");
  });

  it("treats a null active flag as active, so a station is never hidden by an absent field", () => {
    const station = adaptStation(apiStationSchema.parse({ ...RAW, active: undefined }));

    expect(station.active).toBe(true);
  });
});
