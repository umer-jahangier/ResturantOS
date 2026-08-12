// Layer-2 adapter: the print-agent wire shape → the domain model.

import type {
  ApiEnrolledPrintAgent,
  ApiPrintAgent,
} from "@/lib/api-client/schemas/print-agent.schema";
import type { EnrolledPrintAgent, PrintAgent } from "@/lib/models/print-agent.model";

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
