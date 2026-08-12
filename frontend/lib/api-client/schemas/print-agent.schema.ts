import { z } from "zod";

// Layer-1 (§7.2.5): the wire shape of pos-service's `PrintAgentEnrolmentService` records, served by
// `PrintAgentAdminController` at /api/v1/pos/print-agents. This module is the ONLY place that knows
// it.
//
// A print agent is a MACHINE identity — the computer in the back office that holds the printers'
// addresses and puts bytes on them. It is not a user and it has no password anybody types.

/**
 * Metadata only, and that is enforced by shape rather than by convention: there is no field here
 * that could carry a secret or a hash, because the server never returns one on a read.
 */
export const apiPrintAgentSchema = z.object({
  agentId: z.string().uuid(),
  branchId: z.string().uuid(),
  label: z.string(),
  createdAt: z.string(),
  /** Non-null once somebody revoked it. A revoked agent is kept, never deleted. */
  revokedAt: z.string().nullish(),
  /** Refreshed by the server on every poll — the only evidence the agent is alive. */
  lastSeenAt: z.string().nullish(),
});

/**
 * The enrolment response — the ONE response in this product that contains an agent credential.
 *
 * <p>It is not stored in clear, not returned by any read, not logged and not put in an event. A
 * manager who loses it re-enrols rather than recovering it, and the dialog that shows it has to say
 * so before it can be closed. That sentence is a UI requirement, not a comment.
 */
export const apiEnrolledPrintAgentSchema = apiPrintAgentSchema
  .omit({ branchId: true, revokedAt: true, lastSeenAt: true })
  .extend({
    secret: z.string(),
  });

export const enrolPrintAgentInputSchema = z.object({
  branchId: z.string().uuid(),
  label: z.string().max(120).optional(),
});

export type ApiPrintAgent = z.infer<typeof apiPrintAgentSchema>;
export type ApiEnrolledPrintAgent = z.infer<typeof apiEnrolledPrintAgentSchema>;
export type EnrolPrintAgentInput = z.infer<typeof enrolPrintAgentInputSchema>;
