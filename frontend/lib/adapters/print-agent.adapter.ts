// Layer-2 adapter: the print-agent wire shape → the domain model.

import type {
  ApiAgentDevice,
  ApiBranchPrintHealth,
  ApiEnrolledPrintAgent,
  ApiPrintAgent,
} from "@/lib/api-client/schemas/print-agent.schema";
import type {
  AgentDevice,
  AgentDeviceState,
  BranchPrintHealth,
  EnrolledPrintAgent,
  PrintAgent,
} from "@/lib/models/print-agent.model";

const DEVICE_STATES: AgentDeviceState[] = ["IDLE", "PRINTING", "STOPPED", "UNKNOWN"];

function adaptDevice(raw: ApiAgentDevice): AgentDevice {
  const state = (raw.state ?? "UNKNOWN").toUpperCase() as AgentDeviceState;
  return {
    name: raw.name,
    description: raw.description ?? null,
    // An unrecognised state reads as UNKNOWN rather than being dropped: a printer whose state this
    // build has never heard of still has to be selectable, or a spooler upgrade makes a working
    // till unconfigurable.
    state: DEVICE_STATES.includes(state) ? state : "UNKNOWN",
    isDefault: raw.isDefault ?? false,
  };
}

export function adaptPrintAgent(raw: ApiPrintAgent): PrintAgent {
  return {
    agentId: raw.agentId,
    branchId: raw.branchId,
    label: raw.label,
    createdAt: raw.createdAt,
    revokedAt: raw.revokedAt ?? null,
    // NOT defaulted to "now". An agent that has never polled and an agent that polled a second ago
    // are the two states this whole screen exists to tell apart.
    lastSeenAt: raw.lastSeenAt ?? null,
    // `?? null`, NOT `?? []`. An absent list means the agent has never reported; an empty one means
    // it looked and the machine has no queues. The screen says a different sentence for each.
    devices: raw.devices === undefined || raw.devices === null ? null : raw.devices.map(adaptDevice),
    devicesUnavailable: raw.devicesUnavailable ?? null,
    devicesReportedAt: raw.devicesReportedAt ?? null,
  };
}

export function adaptBranchPrintHealth(raw: ApiBranchPrintHealth): BranchPrintHealth {
  return {
    windowHours: raw.windowHours,
    printers: raw.printers.map((p) => ({
      printerId: p.printerId,
      state: p.state,
      waiting: p.waiting,
      printed: p.printed,
      failed: p.failed,
      lastAttemptAt: p.lastAttemptAt ?? null,
      lastPrintedAt: p.lastPrintedAt ?? null,
      lastError: p.lastError ?? null,
    })),
  };
}

export function adaptEnrolledPrintAgent(raw: ApiEnrolledPrintAgent): EnrolledPrintAgent {
  return {
    agentId: raw.agentId,
    label: raw.label,
    createdAt: raw.createdAt,
    secret: raw.secret,
  };
}
