import { apiClient } from "@/lib/api-client/client";
import { apiKdsTicketSchema, apiKdsStationSchema } from "@/lib/api-client/schemas/kds.schema";
import { adaptKdsTicket, adaptKdsStation } from "@/lib/adapters/kds.adapter";
import type { KdsTicket, KdsStation, KdsItemStatus } from "@/lib/models/kds.model";

// Layer-2 KDS repository. Calls the kitchen-service API, parses via Zod,
// adapts to domain models. Never exposes raw API types to Layer-3 or above.

export const KdsRepository = {
  // ── Tickets ────────────────────────────────────────────────────────────────

  async getTickets(
    branchId: string,
    stationCode?: string,
    status = "PENDING,COOKING",
  ): Promise<KdsTicket[]> {
    const params: Record<string, string> = { branchId, status };
    if (stationCode) params.stationCode = stationCode;
    const response = await apiClient.get<{ content: unknown[] }>(
      "/api/v1/kitchen/kds/tickets",
      { params },
    );
    const rawList = response.data.content ?? [];
    return rawList.map((item) => adaptKdsTicket(apiKdsTicketSchema.parse(item)));
  },

  async bumpItem(ticketId: string, itemId: string, branchId: string): Promise<KdsTicket> {
    const response = await apiClient.post<unknown>(
      `/api/v1/kitchen/kds/tickets/${ticketId}/items/${itemId}/bump`,
      {},
      { params: { branchId } },
    );
    return adaptKdsTicket(apiKdsTicketSchema.parse(response.data));
  },

  /**
   * Explicit item-status endpoint (07.3-05, KDS-04) — drives New→Started→Preparing→Ready
   * moves from the item-column board / detail page. Wraps kitchen-service's
   * markItemStatus; response is a bare KdsTicketDto (unwrapped, same convention as
   * bumpItem/recallTicket above).
   */
  async updateItemStatus(
    ticketId: string,
    itemId: string,
    status: KdsItemStatus,
    branchId: string,
  ): Promise<KdsTicket> {
    const response = await apiClient.post<unknown>(
      `/api/v1/kitchen/kds/tickets/${ticketId}/items/${itemId}/status`,
      { status },
      { params: { branchId } },
    );
    return adaptKdsTicket(apiKdsTicketSchema.parse(response.data));
  },

  async recallTicket(ticketId: string, branchId: string): Promise<KdsTicket> {
    const response = await apiClient.post<unknown>(
      `/api/v1/kitchen/kds/tickets/${ticketId}/recall`,
      {},
      { params: { branchId } },
    );
    return adaptKdsTicket(apiKdsTicketSchema.parse(response.data));
  },

  /**
   * Full ticket detail (all revisions, per-item status+revisionNo+firedAt) for the KDS
   * "tap a ticket for full order detail" view (KDS-03). Unlike getTickets/bumpItem/
   * recallTicket above (bare-JSON responses), this endpoint IS wrapped in the
   * ApiResponse envelope — unwrap `.data.data` accordingly.
   */
  async getTicketDetail(ticketId: string, branchId: string): Promise<KdsTicket> {
    const response = await apiClient.get<{ data: unknown }>(
      `/api/v1/kitchen/kds/tickets/${ticketId}`,
      { params: { branchId } },
    );
    return adaptKdsTicket(apiKdsTicketSchema.parse(response.data.data));
  },

  // ── Stations ───────────────────────────────────────────────────────────────

  async getStations(branchId: string): Promise<KdsStation[]> {
    const response = await apiClient.get<unknown[]>(
      "/api/v1/kitchen/kds/stations",
      { params: { branchId } },
    );
    const rawList = Array.isArray(response.data) ? response.data : [];
    return rawList.map((item) => adaptKdsStation(apiKdsStationSchema.parse(item)));
  },
};
