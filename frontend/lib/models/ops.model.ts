// Domain types for the operator health surface (S1-09).
// Timestamps are Date; the adapter parses the wire's ISO strings.

/**
 * What the gateway's probe last observed.
 *
 * - `UP` — answered `/actuator/health` inside the probe budget, reporting UP.
 * - `DEGRADED` — answered, and reported something other than UP about itself.
 * - `DOWN` — did not answer, refused the connection, or is not registered at all.
 *
 * There is deliberately no `UNKNOWN`: every service the gateway routes to is probed on every
 * sweep, so "we have not looked" is a property of the SNAPSHOT (`checkedAt === null`), never of an
 * individual row. A row that could say "unknown" is a row that could hide an outage.
 */
export type ServiceState = "UP" | "DEGRADED" | "DOWN";

export interface ServiceHealth {
  /** The discovery name the gateway routes to, e.g. `pos-service`. */
  name: string;
  /** The gateway path prefixes this service serves, e.g. `/api/v1/pos/**`. */
  paths: string[];
  state: ServiceState;
  /** One plain sentence naming what the probe saw. Safe to render verbatim. */
  detail: string;
  /**
   * When the gateway last got a healthy answer, or `null` when it has not had one since the
   * gateway itself started. Null is rendered as exactly that — never as "never", which the
   * gateway has no way to know.
   */
  lastReachableAt: Date | null;
  instanceCount: number;
}

export interface FleetHealth {
  /** When the last sweep completed. `null` before the first sweep lands. */
  checkedAt: Date | null;
  services: ServiceHealth[];
}
