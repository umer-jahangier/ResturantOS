// Layer-3 domain models for the machines allowed to drive a branch's printers (26-11, S1-06).

/**
 * How alive an agent is, decided from `lastSeenAt` and nothing else.
 *
 * <p>There is no "connected" flag on the server and there must not be one: a socket that is open is
 * not the same thing as a process that is polling, and a boolean written at enrolment would say
 * CONNECTED for ever about a machine that was unplugged in March. The server stamps `lastSeenAt` on
 * every claim poll; the UI reads recency. That is the only honest evidence available.
 */
export type PrintAgentLiveness = "CONNECTED" | "STALE" | "NEVER_STARTED" | "REVOKED";

export interface PrintAgent {
  agentId: string;
  branchId: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
}

/** The one-time credential. Held in memory, shown once, never re-fetchable. */
export interface EnrolledPrintAgent {
  agentId: string;
  label: string;
  createdAt: string;
  secret: string;
}

/**
 * Three poll intervals plus a margin. The agent polls every 3 s by default, so a window of 15 s
 * tolerates one dropped poll and a slow network without reporting a healthy till as offline — and
 * still turns amber inside the time it takes a manager to walk to the printer and look.
 */
export const AGENT_CONNECTED_WINDOW_MS = 15_000;

export function printAgentLiveness(
  agent: PrintAgent,
  now: number = Date.now(),
): PrintAgentLiveness {
  if (agent.revokedAt !== null) return "REVOKED";
  if (agent.lastSeenAt === null) return "NEVER_STARTED";
  const seen = Date.parse(agent.lastSeenAt);
  if (Number.isNaN(seen)) return "NEVER_STARTED";
  return now - seen <= AGENT_CONNECTED_WINDOW_MS ? "CONNECTED" : "STALE";
}
