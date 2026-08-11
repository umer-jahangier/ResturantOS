import { get, post, put } from "@/lib/api-client/request";
import {
  apiPosTerminalSchema,
  createTerminalInputSchema,
  updateTerminalInputSchema,
  type CreateTerminalInput,
  type UpdateTerminalInput,
} from "@/lib/api-client/schemas/terminal.schema";
import { adaptPosTerminal } from "@/lib/adapters/terminal.adapter";
import type { PosTerminal } from "@/lib/models/terminal.model";

/**
 * Layer-2 repository for the POS terminal catalogue (plan 28-04's endpoints).
 *
 * ```
 * GET    /api/v1/pos/terminals?branchId=&includeInactive=   pos.menu.view | pos.kds.view | pos.terminals.admin
 * GET    /api/v1/pos/terminals/{id}?branchId=               (same)
 * POST   /api/v1/pos/terminals?branchId=                    pos.terminals.admin
 * PUT    /api/v1/pos/terminals/{id}?branchId=               pos.terminals.admin
 * POST   /api/v1/pos/terminals/{id}/deactivate?branchId=    pos.terminals.admin
 * POST   /api/v1/pos/terminals/{id}/reactivate?branchId=    pos.terminals.admin
 * ```
 *
 * <p>`includeInactive` is gated INSIDE the service on the admin permission rather than by a
 * controller annotation — 19b's finding, repeated deliberately in 28-04: annotating the whole
 * method would have forced the weaker permission so a cashier's terminal picker kept working,
 * which leaves the flag itself as an unguarded escalation.
 *
 * <p>There is deliberately no delete: orders will reference a terminal (28-12), so a closed order
 * must keep naming the till it was rung on.
 */
export const TerminalRepository = {
  async list(branchId: string, includeInactive = false): Promise<PosTerminal[]> {
    const query: Record<string, unknown> = { branchId };
    if (includeInactive) query.includeInactive = true;
    const raw = await get<unknown[]>("/api/v1/pos/terminals", query);
    return (Array.isArray(raw) ? raw : []).map((r) => adaptPosTerminal(apiPosTerminalSchema.parse(r)));
  },

  async create(branchId: string, payload: CreateTerminalInput): Promise<PosTerminal> {
    const body = createTerminalInputSchema.parse(payload);
    const raw = await post<typeof body, unknown>(
      `/api/v1/pos/terminals?branchId=${encodeURIComponent(branchId)}`,
      body,
    );
    return adaptPosTerminal(apiPosTerminalSchema.parse(raw));
  },

  async update(id: string, branchId: string, payload: UpdateTerminalInput): Promise<PosTerminal> {
    const body = updateTerminalInputSchema.parse(payload);
    const raw = await put<typeof body, unknown>(
      `/api/v1/pos/terminals/${id}?branchId=${encodeURIComponent(branchId)}`,
      body,
    );
    return adaptPosTerminal(apiPosTerminalSchema.parse(raw));
  },

  /** Retire (`false`) or restore (`true`). Two endpoints, one intention. */
  async setActive(id: string, branchId: string, active: boolean): Promise<PosTerminal> {
    const action = active ? "reactivate" : "deactivate";
    const raw = await post<undefined, unknown>(
      `/api/v1/pos/terminals/${id}/${action}?branchId=${encodeURIComponent(branchId)}`,
    );
    return adaptPosTerminal(apiPosTerminalSchema.parse(raw));
  },
};
