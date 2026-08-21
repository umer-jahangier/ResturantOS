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

/** The state of one print queue, as the machine's own spooler reports it. */
export type AgentDeviceState = "IDLE" | "PRINTING" | "STOPPED" | "UNKNOWN";

/**
 * One print queue the agent found on its own machine (S8).
 *
 * <p>`name` is what goes into `PrinterEntry.systemPrinterName` and what the spooler is asked for.
 * `description` is prose for a human and must never be stored in its place — that is the mistake
 * that produces a configuration which reads correctly on screen and fails at the printer.
 */
export interface AgentDevice {
  name: string;
  description: string | null;
  state: AgentDeviceState;
  isDefault: boolean;
}

export interface PrintAgent {
  agentId: string;
  branchId: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
  /**
   * NULL when this agent has never reported. An EMPTY ARRAY when it reported and found nothing.
   * Collapsing the two would let the settings screen tell a manager "this machine has no printers"
   * about an agent that has never been started.
   */
  devices: AgentDevice[] | null;
  devicesUnavailable: string | null;
  devicesReportedAt: string | null;
}

/** A device offered on the settings screen, carrying which machine saw it. */
export interface DiscoveredDevice extends AgentDevice {
  agentId: string;
  agentLabel: string;
  /** False when the reporting agent has stopped answering — still offered, but said out loud. */
  agentConnected: boolean;
}

/**
 * Every distinct queue name across a branch's agents, newest report first.
 *
 * <h2>Why not just the connected agent's list</h2>
 *
 * <p>A branch with two tills has two agents, and the manager configuring the printers may be
 * sitting at neither of them. Hiding the queues of an agent that is currently off would mean the
 * printer bolted to the till in the other room becomes unconfigurable while that till is asleep —
 * so the entries are all offered, and the ones from an agent that is not answering are LABELLED as
 * such rather than silently dropped.
 *
 * <p>De-duplicated by name, because two agents on the same machine — which is how every re-enrolled
 * till ends up — would otherwise show every queue twice.
 */
export function discoveredDevices(
  agents: PrintAgent[],
  now: number = Date.now(),
): DiscoveredDevice[] {
  const seen = new Map<string, DiscoveredDevice>();
  const ordered = [...agents]
    .filter((a) => a.revokedAt === null)
    .sort(
      (a, b) => Date.parse(b.devicesReportedAt ?? "0") - Date.parse(a.devicesReportedAt ?? "0"),
    );
  for (const agent of ordered) {
    for (const device of agent.devices ?? []) {
      if (seen.has(device.name)) continue;
      seen.set(device.name, {
        ...device,
        agentId: agent.agentId,
        agentLabel: agent.label,
        agentConnected: printAgentLiveness(agent, now) === "CONNECTED",
      });
    }
  }
  return [...seen.values()];
}

/**
 * Why there is nothing to choose from, in words a manager can act on — or null when there is.
 *
 * <p>Four different situations produce an empty dropdown and they need four different sentences.
 * An "unavailable" reason reported by an agent (a Windows host, no CUPS) is the most specific and
 * wins; then "no agent enrolled"; then "enrolled but never reported"; then the genuine "this
 * machine has no print queues at all".
 */
export function noDeviceReason(agents: PrintAgent[]): string | null {
  const live = agents.filter((a) => a.revokedAt === null);
  if (live.length === 0) {
    return "No print agent is enrolled on this branch, so nothing has been able to look for printers. Enrol one above, then run it on the machine the USB printer is plugged into.";
  }
  const reported = live.filter((a) => a.devicesReportedAt !== null);
  if (reported.length === 0) {
    return "No agent has reported its printers yet. Start an agent on the machine the printer is attached to — it sends the list within a few seconds of starting.";
  }
  const unavailable = reported.find((a) => a.devicesUnavailable !== null);
  if (unavailable) {
    return `${unavailable.label}: ${unavailable.devicesUnavailable}`;
  }
  return "The agents on this branch looked and found no print queues on their machines. Attach the printer and install its driver on the machine running the agent, then wait a minute for the next scan.";
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
export type ReceiptDeliveryState = "NO_PRINTER" | "ON_PAPER" | "IN_FLIGHT" | "NO_AGENT" | "REFUSED";

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
 * What a printer has DONE with the jobs it was given (S8), as distinct from what it is configured
 * to be and from whether the machine driving it is awake.
 */
export type PrinterDeliveryState = "NEVER_USED" | "PRINTING" | "WAITING" | "FAILING";

export interface PrinterDelivery {
  printerId: string;
  state: PrinterDeliveryState;
  waiting: number;
  printed: number;
  failed: number;
  lastAttemptAt: string | null;
  lastPrintedAt: string | null;
  lastError: string | null;
}

export interface BranchPrintHealth {
  windowHours: number;
  printers: PrinterDelivery[];
}

/**
 * The sentence for one printer's row.
 *
 * <p>Never claims paper. "Delivered" is the strongest word available, because neither a TCP socket
 * nor a spooler tells anyone that ink reached paper — the agent's own transports say so in their
 * headers, and a UI that upgrades their claim is the comforting lie in a new costume.
 */
export function describeDelivery(
  delivery: PrinterDelivery | undefined,
  now: number = Date.now(),
): { tone: "ok" | "warn" | "bad" | "muted"; label: string; detail: string } {
  if (delivery === undefined || delivery.state === "NEVER_USED") {
    return {
      tone: "muted",
      label: "Not used today",
      detail: "No bill or ticket has been sent to this printer in the last 24 hours.",
    };
  }
  if (delivery.state === "FAILING") {
    // The transport writes its own sentences and most of them end in a full stop. Appending ours
    // to it produced "…on this address.. 1 job is still waiting." on a live screen.
    const error = delivery.lastError === null ? null : delivery.lastError.replace(/[.\s]+$/, "");
    return {
      tone: "bad",
      label: "Cannot print",
      detail:
        `The last job sent to this printer failed ${describeAgo(delivery.lastAttemptAt, now)}` +
        (error ? ` — ${error}` : "") +
        (delivery.waiting > 0
          ? `. ${delivery.waiting} job${delivery.waiting === 1 ? " is" : "s are"} still waiting.`
          : "."),
    };
  }
  if (delivery.state === "WAITING") {
    return {
      tone: "warn",
      label: "Waiting",
      detail: `${delivery.waiting} job${delivery.waiting === 1 ? "" : "s"} queued and not yet delivered. An agent collects them on its next poll.`,
    };
  }
  return {
    tone: "ok",
    label: "Delivered",
    detail: `${delivery.printed} job${delivery.printed === 1 ? "" : "s"} delivered in the last 24 hours, the most recent ${describeAgo(delivery.lastPrintedAt, now)}.`,
  };
}

/** "4 minutes ago" for any timestamp, or "at an unknown time" rather than a fabricated one. */
export function describeAgo(at: string | null, now: number = Date.now()): string {
  if (at === null) return "at an unknown time";
  const when = Date.parse(at);
  if (Number.isNaN(when)) return "at an unknown time";
  const seconds = Math.max(0, Math.round((now - when) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
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
