/**
 * One row of the tenant's audit trail, as the screen consumes it.
 *
 * <p>Every id is kept alongside its resolved name. The id is the record and the name is decoration:
 * a directory that cannot answer must leave a row that still says who, in the only vocabulary
 * available, rather than a row that says nobody.
 */
export interface AuditEvent {
  id: number;
  /** The instant it happened. Rendered in the BRANCH's zone, never the browser's. */
  occurredAt: Date;
  /** The event type as published, e.g. `ORDER_VOIDED`. */
  action: string;
  /** The leading noun of the action — `ORDER`, `USER`, `TILL`. Null on malformed rows. */
  resourceType: string | null;
  /** Which one — an order id, a till id. Null when the payload named nothing recognisable. */
  resourceId: string | null;
  branchId: string | null;
  actorId: string | null;
  /** The actor's display name, or null. Null means "not resolved", never "nobody". */
  actorName: string | null;
  /** The real platform administrator, when this was done under impersonation. */
  impersonatorId: string | null;
  impersonatorName: string | null;
  /**
   * The free-text reason the actor gave, where the event carries one (a void, a refund).
   * Null when the event type has no reason — not an empty string, which reads as "left blank".
   */
  reason: string | null;
  /**
   * The rest of the recorded payload, already redacted server-side, for the detail view.
   * Empty when the row had no payload or the payload could not be parsed.
   */
  details: Record<string, unknown>;
  /**
   * True when this row HAD a payload and it could not be parsed. Distinct from an empty payload:
   * the screen says "detail could not be read" rather than showing nothing and implying nothing
   * was recorded.
   */
  detailsUnreadable: boolean;
}

/** The filter vocabulary the tenant's own rows contain, for the window being read. */
export interface AuditFacets {
  actions: string[];
  resourceTypes: string[];
  /** First day the vocabulary was read from, `YYYY-MM-DD`. `null` if the server did not say. */
  windowFrom: string | null;
  /** Last day the vocabulary was read from, `YYYY-MM-DD`. `null` if the server did not say. */
  windowTo: string | null;
}

/** What the audit list is being narrowed by. Every field optional; all of them omitted is "everything". */
export interface AuditEventFilters {
  action?: string;
  resourceType?: string;
  /** ISO date `YYYY-MM-DD`, cut on `zone`. */
  from?: string;
  to?: string;
  /** IANA zone id the day boundaries are cut in — the BRANCH's, not the browser's. */
  zone?: string;
  page?: number;
  size?: number;
}
