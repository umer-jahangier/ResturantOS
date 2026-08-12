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

/**
 * The branch's agent presence as it rides on an issued print job — the same three facts the
 * Printers screen reads, on a response a CASHIER is entitled to.
 */
export interface PrintAgentPresence {
  /** Enrolled and not revoked. Zero means nothing on this branch can print at all. */
  enrolled: number;
  /** The agent that would take this job: last heard from, or last enrolled if none ever polled. */
  label: string | null;
  lastSeenAt: string | null;
}

/**
 * Whether a bill has reached paper, is going to, or never will.
 *
 * <p>`NO_PRINTER` — the branch has configured no printer for this document, so the browser dialog
 * is the honest and only path (D-26-01). Not a failure.
 * <br>`ON_PAPER` — the agent acknowledged delivery of these bytes to the device. The strongest
 * claim this product is ever allowed to make; see the print-agent README on why it still is not
 * "the customer has their bill".
 * <br>`IN_FLIGHT` — routed, and an agent is polling right now. Paper is coming.
 * <br>`NO_AGENT` — routed, and NOTHING is going to collect it: either no agent is enrolled, or the
 * one that would is not answering. This is the state the bill screen used to render as
 * "Sent to the receipt printer".
 * <br>`REFUSED` — the agent tried and gave up, or the attempt budget is spent.
 */
export type ReceiptDeliveryState =
  | "NO_PRINTER"
  | "ON_PAPER"
  | "IN_FLIGHT"
  | "NO_AGENT"
  | "REFUSED";

export type PrintJobStatus =
  | "ISSUED"
  | "QUEUED"
  | "CLAIMED"
  | "PRINTED"
  | "FAILED"
  | "DEAD_LETTERED";

/** The sentinel pos-service stores when the branch has no printer for a document's routing slot. */
export const UNASSIGNED_TARGET = "unassigned";

/**
 * Decide, from the job's own status and the branch's agent presence, what the screen may claim.
 *
 * <h2>Why the order of these clauses is load-bearing</h2>
 *
 * <p>`PRINTED` wins over agent presence. A job the agent acknowledged half an hour ago is on paper
 * whether or not that machine is answering NOW — demoting it to "no agent" because the till was
 * since switched off would tell a cashier to reprint a bill the customer is already holding.
 *
 * <p>Agent presence beats `QUEUED`. A queued job with nothing polling is not "on its way"; it is a
 * row in a table, and the whole finding this function exists to close is a screen that could not
 * tell those apart.
 */
export function receiptDeliveryState(
  input: { targetPrinterId: string; status: PrintJobStatus; agent: PrintAgentPresence },
  now: number = Date.now(),
): ReceiptDeliveryState {
  if (input.targetPrinterId === UNASSIGNED_TARGET) return "NO_PRINTER";
  if (input.status === "PRINTED") return "ON_PAPER";
  if (input.status === "DEAD_LETTERED" || input.status === "FAILED") return "REFUSED";
  return agentIsAnswering(input.agent, now) ? "IN_FLIGHT" : "NO_AGENT";
}

/** The one recency rule, applied to the presence payload. Never a second definition of "live". */
export function agentIsAnswering(agent: PrintAgentPresence, now: number = Date.now()): boolean {
  if (agent.enrolled === 0 || agent.lastSeenAt === null) return false;
  const seen = Date.parse(agent.lastSeenAt);
  if (Number.isNaN(seen)) return false;
  return now - seen <= AGENT_CONNECTED_WINDOW_MS;
}

/**
 * "4 minutes ago" / "just now" — for a sentence a cashier reads at the counter with a customer
 * waiting. Deliberately coarse: the exact second is on the Printers screen, and precision here
 * would only invite arithmetic.
 */
export function describeLastSeen(lastSeenAt: string | null, now: number = Date.now()): string {
  if (lastSeenAt === null) return "has never answered";
  const seen = Date.parse(lastSeenAt);
  if (Number.isNaN(seen)) return "has never answered";
  const seconds = Math.max(0, Math.round((now - seen) / 1000));
  if (seconds < 45) return "last answered just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `last answered ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `last answered ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `last answered ${days} day${days === 1 ? "" : "s"} ago`;
}
