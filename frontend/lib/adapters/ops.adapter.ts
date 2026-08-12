import type { ApiFleetHealth, ApiServiceHealth } from "@/lib/api-client/schemas/ops.schema";
import type { FleetHealth, ServiceHealth, ServiceState } from "@/lib/models/ops.model";

const STATES = new Set<ServiceState>(["UP", "DEGRADED", "DOWN"]);

/**
 * An unrecognised `state` degrades to DEGRADED, never to UP.
 *
 * <p>Every other adapter in this tree degrades an unknown enum to its most harmless value, because
 * the cost of guessing wrong there is a wrong caption. Here the cost of guessing wrong is a green
 * row next to a service that is on fire, so the default is the one that keeps the operator looking.
 * DOWN would be the other defensible choice; DEGRADED is preferred because it says "something
 * about this row is not understood" without asserting an outage that was not measured.
 */
function toState(raw: string | null | undefined): ServiceState {
  const upper = raw?.toUpperCase();
  return upper && STATES.has(upper as ServiceState) ? (upper as ServiceState) : "DEGRADED";
}

/**
 * An unparseable timestamp becomes null rather than an Invalid Date.
 *
 * <p>`new Date("nonsense")` renders as "Invalid Date" in the middle of a sentence about whether the
 * restaurant can take orders. Null has a designed rendering on this screen and Invalid Date does
 * not.
 */
function toDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function adaptServiceHealth(raw: ApiServiceHealth): ServiceHealth {
  return {
    name: raw.name,
    paths: raw.paths ?? [],
    state: toState(raw.state),
    detail: raw.detail ?? "",
    lastReachableAt: toDate(raw.lastReachableAt),
    instanceCount: raw.instanceCount ?? 0,
  };
}

export function adaptFleetHealth(raw: ApiFleetHealth): FleetHealth {
  return {
    checkedAt: toDate(raw.checkedAt),
    services: (raw.services ?? []).map(adaptServiceHealth),
  };
}
