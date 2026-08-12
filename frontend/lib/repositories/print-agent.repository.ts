import { del, get, post } from "@/lib/api-client/request";
import {
  apiBranchPrintHealthSchema,
  apiEnrolledPrintAgentSchema,
  apiPrintAgentSchema,
  enrolPrintAgentInputSchema,
  type EnrolPrintAgentInput,
} from "@/lib/api-client/schemas/print-agent.schema";
import {
  adaptBranchPrintHealth,
  adaptEnrolledPrintAgent,
  adaptPrintAgent,
} from "@/lib/adapters/print-agent.adapter";
import type {
  BranchPrintHealth,
  EnrolledPrintAgent,
  PrintAgent,
} from "@/lib/models/print-agent.model";

/**
 * The machines allowed to drive a branch's printers (26-11's administrator half).
 *
 * ```
 * POST   /api/v1/pos/print-agents               branch.manage | pos.printers.admin
 * GET    /api/v1/pos/print-agents?branchId=     branch.manage | pos.printers.admin
 * DELETE /api/v1/pos/print-agents/{agentId}     branch.manage | pos.printers.admin
 * ```
 *
 * <p><b>There is no method that re-reads a secret, and there cannot be one.</b> The credential
 * exists in the clear for exactly one HTTP response; a manager who loses it enrols again. Any
 * future "show me the key" affordance on this screen is a bug report, not a feature request.
 *
 * <p>Revoking is a DELETE that deletes nothing — the row is kept with `revokedAt` stamped, so the
 * history of which machine printed what survives the machine being retired.
 */
export const PrintAgentRepository = {
  async list(branchId: string): Promise<PrintAgent[]> {
    const raw = await get<unknown[]>("/api/v1/pos/print-agents", { branchId });
    return (Array.isArray(raw) ? raw : []).map((r) => adaptPrintAgent(apiPrintAgentSchema.parse(r)));
  },

  async enrol(payload: EnrolPrintAgentInput): Promise<EnrolledPrintAgent> {
    const body = enrolPrintAgentInputSchema.parse(payload);
    const raw = await post<typeof body, unknown>("/api/v1/pos/print-agents", body);
    return adaptEnrolledPrintAgent(apiEnrolledPrintAgentSchema.parse(raw));
  },

  async revoke(agentId: string): Promise<PrintAgent> {
    const raw = await del<unknown>(`/api/v1/pos/print-agents/${agentId}`);
    return adaptPrintAgent(apiPrintAgentSchema.parse(raw));
  },

  /**
   * `GET /api/v1/pos/printers/health?branchId=` — pos.printers.admin | branch.manage (S8).
   *
   * <p>What each printer has actually done with the jobs it was given. Deliberately a separate call
   * from {@link list}: agent liveness answers "is the machine awake", this answers "is the printer
   * printing", and the whole point of the pair is that they can disagree.
   */
  async health(branchId: string): Promise<BranchPrintHealth> {
    const raw = await get<unknown>("/api/v1/pos/printers/health", { branchId });
    return adaptBranchPrintHealth(apiBranchPrintHealthSchema.parse(raw));
  },
};
