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
    // READY included so ready-but-not-yet-served tickets stay on the board (they leave only
    // when the order closes → SERVED). SERVED/CANCELLED are excluded server + client side.
    status = "PENDING,COOKING,READY",
  ): Promise<KdsTicket[]> {
    // `size` is NOT optional. KdsController takes a Spring `Pageable`, whose default page size is
    // 20 — so omitting it silently truncated the board. Measured live during the phase-21 rebuild:
    // 20 of 29 tickets returned, and ALL FIVE tickets in the WARN ageing band were among the nine
    // dropped. A kitchen at full service saw twenty tickets with no indication that nine more
    // existed, and the ones it could not see were disproportionately the late ones — because the
    // default ordering put the oldest last.
    //
    // The board is a wall display, not a paged table: it must show everything open for the branch,
    // or it is actively misleading rather than merely incomplete. 500 is far above any realistic
    // simultaneous open-ticket count for one branch while still bounding a runaway response.
    const params: Record<string, string> = { branchId, status, size: "500" };
    if (stationCode) params.stationCode = stationCode;
    const response = await apiClient.get<{ content: unknown[]; totalElements?: number }>(
      "/api/v1/kitchen/kds/tickets",
      { params },
    );
    const rawList = response.data.content ?? [];

    // If the branch ever genuinely exceeds the cap, say so rather than quietly dropping tickets —
    // a silently short board is the defect this fix exists to remove, and re-introducing it at a
    // higher number would be worse for being harder to notice.
    const total = response.data.totalElements;
    if (typeof total === "number" && total > rawList.length) {
      console.error(
        `KDS board truncated: ${rawList.length} of ${total} tickets returned for branch ${branchId}. ` +
          `Raise the page size — the board must show every open ticket.`,
      );
    }
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
    const response = await apiClient.get<unknown[]>("/api/v1/kitchen/kds/stations", {
      params: { branchId },
    });
    const rawList = Array.isArray(response.data) ? response.data : [];
    return rawList.map((item) => adaptKdsStation(apiKdsStationSchema.parse(item)));
  },
};
