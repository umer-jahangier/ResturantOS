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
/**
 * One print queue on the machine an agent runs on (S8).
 *
 * <p>`name` is the destination the spooler takes, NOT a display label. The screen may show the
 * description; the value it stores has to be this one or `lp -d` will not find the printer.
 */
export const apiAgentDeviceSchema = z.object({
  name: z.string(),
  description: z.string().nullish(),
  state: z.string().nullish(),
  isDefault: z.boolean().nullish(),
});

export const apiPrintAgentSchema = z.object({
  agentId: z.string().uuid(),
  branchId: z.string().uuid(),
  label: z.string(),
  createdAt: z.string(),
  /** Non-null once somebody revoked it. A revoked agent is kept, never deleted. */
  revokedAt: z.string().nullish(),
  /** Refreshed by the server on every poll — the only evidence the agent is alive. */
  lastSeenAt: z.string().nullish(),
  /**
   * S8 — the print queues this agent last enumerated on its own machine.
   *
   * <p>`nullish` and NOT `.default([])`: absent means the agent has never reported, an empty array
   * means it looked and the machine has no queues, and the screen says a different sentence for
   * each. Defaulting here would erase that distinction one layer below the place it matters.
   */
  devices: z.array(apiAgentDeviceSchema).nullish(),
  /** Why no list could be produced — a Windows host, or no CUPS on PATH. */
  devicesUnavailable: z.string().nullish(),
  devicesReportedAt: z.string().nullish(),
});

/**
 * The enrolment response — the ONE response in this product that contains an agent credential.
 *
 * <p>It is not stored in clear, not returned by any read, not logged and not put in an event. A
 * manager who loses it re-enrols rather than recovering it, and the dialog that shows it has to say
 * so before it can be closed. That sentence is a UI requirement, not a comment.
 */
export const apiEnrolledPrintAgentSchema = apiPrintAgentSchema
  .omit({
    branchId: true,
    revokedAt: true,
    lastSeenAt: true,
    devices: true,
    devicesUnavailable: true,
    devicesReportedAt: true,
  })
  .extend({
    secret: z.string(),
  });

/**
 * S8 — what each of a branch's printers has DONE with the jobs it was given.
 *
 * <p>Served by `PrinterHealthController` at `/api/v1/pos/printers/health`. Distinct from agent
 * liveness on purpose: a polling agent with a dead printer bolted to it reads "Connected", and this
 * is the only thing in the product that can contradict that.
 */
export const apiPrinterDeliverySchema = z.object({
  printerId: z.string(),
  state: z.enum(["NEVER_USED", "PRINTING", "WAITING", "FAILING"]),
  waiting: z.number(),
  printed: z.number(),
  failed: z.number(),
  lastAttemptAt: z.string().nullish(),
  lastPrintedAt: z.string().nullish(),
  /** The transport's own words. Present only while FAILING is still the current story. */
  lastError: z.string().nullish(),
});

export const apiBranchPrintHealthSchema = z.object({
  windowHours: z.number(),
  printers: z.array(apiPrinterDeliverySchema),
});

export const enrolPrintAgentInputSchema = z.object({
  branchId: z.string().uuid(),
  label: z.string().max(120).optional(),
});

export type ApiPrintAgent = z.infer<typeof apiPrintAgentSchema>;
export type ApiAgentDevice = z.infer<typeof apiAgentDeviceSchema>;
export type ApiEnrolledPrintAgent = z.infer<typeof apiEnrolledPrintAgentSchema>;
export type EnrolPrintAgentInput = z.infer<typeof enrolPrintAgentInputSchema>;
export type ApiPrinterDelivery = z.infer<typeof apiPrinterDeliverySchema>;
export type ApiBranchPrintHealth = z.infer<typeof apiBranchPrintHealthSchema>;
